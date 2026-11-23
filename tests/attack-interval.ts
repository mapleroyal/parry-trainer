import { addBot, Buttons, log, modifierState, onFrame, onMelee, onParry, players, readField, serverCommand, type Player } from 'modlock'
import { presetFormatVersion } from '../difficulty-settings.js'
import { setMeleeDistances, testSubject } from '../gameplay'
import { session } from '../session'
import { applyConfiguration, changeSetting } from '../trainer-settings'

// Count the stock weapon entering its charging state, then confirm every native
// swing. A button press rejected during post-hit recovery does not count.
export default function registerIntervalProbe(): void {
  let trainee: Player | undefined, start = -1, lastSolo = 0, phase = 0, changed = false, done = false
  let totalHeavies = 0, caught: number | undefined, caughtAt = 0, clock = 0, observedStun = false
  const charging = new Set<number>(), awaitingSwing = new Set<number>()
  const starts = new Map<number, number[]>()

  function finish(pass: boolean, reason: string): void {
    if (done) return
    done = true
    log(pass ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'attack-interval', reason)
    serverCommand('quit')
  }
  onMelee(swing => {
    if (done || swing.attackerPlayer.slot === trainee?.slot) return
    if (!swing.heavy || !awaitingSwing.delete(swing.attackerPlayer.slot)) {
      finish(false, 'light or unpaired native melee'); return
    }
    totalHeavies++
  })
  onParry(event => {
    if (phase === 4 && event.player.slot === trainee?.slot) {
      caught = event.attacker
      caughtAt = clock
    }
  })
  onFrame(({ timeSeconds: now }) => {
    if (done) return
    clock = now
    if (start < 0) start = now
    if (now - start > 43) { finish(false, 'timed out in phase ' + phase); return }
    if (!trainee) {
      trainee = addBot({ name: 'Interval trainee', hero: 'hero_wraith', team: 2 })
      if (trainee) {
        applyConfiguration('preset=50,version=' + presetFormatVersion + ',interval_min=100,idle_drain=0')
        testSubject(trainee)
      }
      return
    }
    const stunned = caught !== undefined && modifierState(caught, 'MODIFIER_STATE_STUNNED')
    observedStun ||= stunned
    for (const { name, player } of players()) {
      const match = /^Trainer opponent ([12])(?: reserve)?$/.exec(name)
      if (!match) continue
      if (phase === 0 && name.endsWith(' reserve')) { finish(false, 'unused pawn for a six-second wait'); return }
      if (!player.pawn()?.hero) continue
      const number = Number(match[1])
      const weapon = player.abilities().find(a => a.slot === 22)
      if (!weapon) continue
      const state = readField(weapon.entity, 'CCitadel_Ability_HoldMelee', 'm_eCurrentAttackState', 'uint32')
      if (phase === 4 && number === 1 && !caught && (state === 2 || state === 3)) trainee.press(Buttons.parry)
      if (state !== 1) { charging.delete(player.slot); continue }
      if (charging.has(player.slot)) continue
      charging.add(player.slot)
      if (awaitingSwing.has(player.slot)) { finish(false, 'previous windup did not produce a heavy'); return }
      awaitingSwing.add(player.slot)
      if (phase < 3) {
        const gap = now - lastSolo
        if ((phase === 1 && Math.abs(gap - 1) > 0.12) || (phase === 2 && Math.abs(gap - 6) > 0.12)) {
          finish(false, 'native windup gap ' + gap + ' in phase ' + phase); return
        }
        lastSolo = now
        changed = false
        if (++phase === 3) {
          changeSetting('interval_min', '0')
          changeSetting('interval_max', '0')
          changeSetting('hero2', 'hero_atlas')
          changeSetting('second', '1')
        }
      } else if (phase === 3) {
        const times = starts.get(number) ?? []
        const previous = times[times.length - 1]
        if (previous !== undefined && Math.abs(now - previous - 1) > 0.12) {
          finish(false, 'unexpected native interval for opponent ' + number + ': ' + (now - previous)); return
        }
        times.push(now)
        starts.set(number, times)
      } else if (number === 1 && caught !== undefined) {
        if (!observedStun || stunned || now - caughtAt < 1) { finish(false, 'opponent wound up during its parry stun'); return }
        finish(session.heavy === totalHeavies && session.parries === 1,
          'six-second and repeated one-second native heavy windups, per-opponent scheduling, score and parry recovery')
        return
      }
    }
    if (!changed && (phase === 1 || phase === 2) && now - lastSolo > 0.7) {
      if (phase === 1) {
        changeSetting('interval_min', '0')
        changeSetting('interval_max', '0')
      } else {
        changeSetting('interval_max', '100')
        changeSetting('interval_min', '100')
      }
      changed = true
    }
    if (phase === 3 && starts.size === 2 && [...starts.values()].every(times => times.length >= 5)) {
      phase = 4
      changeSetting('second', '0')
      setMeleeDistances(0, 0, 50)
    }
  })
}
