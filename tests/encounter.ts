import {
  addBot, Buttons, log, onDamaged, onFrame, onMelee, players,
  serverCommand, type Player,
} from 'modlock'
import { setDeathEnabled, setMeleeDistances, testSubject } from '../gameplay'
import { session } from '../session'

export default function registerEncounterProbe(): void {
  let active = true
  let trainee: Player | undefined
  let started = -1, deathAt = -1
  let landed = 0, damageEvents = 0, deadFrames = 0, swingsWhileDead = 0
  let bloodletting = false, wasCharging = false, sawDead = false
  const respawnTimes: number[] = []

  function finish(ok: boolean, reason: string): void {
    active = false
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'encounter', reason,
      'contacts', landed, 'damage events', damageEvents, 'scored', session.hits,
      'respawn seconds', respawnTimes.join(', '), 'dead frames', deadFrames, 'swings while dead', swingsWhileDead)
    serverCommand('quit')
  }
  onMelee(swing => {
    if (!active || !trainee || swing.attackerPlayer.slot === trainee.slot) return
    if (deathAt >= 0) swingsWhileDead++
    const pawn = trainee.pawn()
    if (swing.heavy && pawn?.hero && swing.hits.includes(pawn.entity)) landed++
  })
  onDamaged(hit => {
    if (active && deathAt < 0 && hit.healthLost > 0 && hit.victim === trainee?.pawn()?.entity && hit.attacker !== hit.victim)
      damageEvents++
  })
  onFrame(({ timeSeconds: now }) => {
    if (!active) return
    if (started < 0) started = now
    if (now - started > 55) { finish(false, 'timeout'); return }
    if (!trainee) {
      trainee = addBot({ name: 'Encounter trainee', hero: 'hero_shiv', team: 2 })
      if (trainee) {
        testSubject(trainee)
        setMeleeDistances(0, 0, 50)
        setDeathEnabled(true)
      }
      return
    }
    const pawn = trainee.pawn()
    if (!pawn?.hero || pawn.health <= 0) {
      if (deathAt >= 0) { deadFrames++; sawDead = true }
      return
    }
    if (!bloodletting) {
      bloodletting = trainee.trainAbility(2)
      if (!bloodletting) return
    }
    if (deathAt >= 0) {
      if (!sawDead) return
      const elapsed = now - deathAt
      respawnTimes.push(elapsed)
      // The observer first sees a death and the revived pawn on server ticks.
      if (swingsWhileDead || elapsed < 1.5 || elapsed > 1.65 || session.phase !== 'running') {
        finish(false, 'invalid respawn or interrupted session'); return
      }
      sawDead = false
      deathAt = -1
      wasCharging = false
      return
    }
    if (respawnTimes.length === 2 && landed >= 4) {
      finish(session.hits === landed, 'resumed native heavies after two fixed respawns'); return
    }
    const attacker = players().find(c => c.name === 'Trainer opponent 1')?.player
    const charging = Boolean((attacker?.buttons() ?? 0n) & Buttons.melee)
    const beganWindup = charging && !wasCharging
    wasCharging = charging
    if (respawnTimes.length >= 2 || landed < 2 + respawnTimes.length || !beganWindup) return
    if (session.hits !== landed || (!respawnTimes.length && damageEvents <= landed)) {
      finish(false, 'Bloodletting scoring'); return
    }
    if (!trainee.kill()) { finish(false, 'unable to kill trainee in windup'); return }
    deathAt = now
  })
}
