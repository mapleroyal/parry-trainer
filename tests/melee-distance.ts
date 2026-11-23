// Observe both pawns at the start of each real heavy windup while changing
// the distance controls between attacks in the same session.
import { addBot, Buttons, log, onFrame, onMelee, players, serverCommand, type Player } from 'modlock'
import { beginTraining, testSubject } from '../gameplay'
import { meleeRange } from '../melee-range.js'
import { changeSetting } from '../trainer-settings'

export default function registerDistanceProbe(): void {
  const bands = [[100, 100], [100, 100], [28, 36], [0, 0]]
  const starts: number[] = []
  let lastFrameDistance = 0, movedBeyondRange = false
  let trainee: Player | undefined
  let stage = 0, started = -1, running = false, wasCharging = false, done = false

  function finish(ok: boolean, detail: string): void {
    done = true
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'melee-distance', detail,
      'windup distances (units)', starts.map(d => d.toFixed(1)).join(', '))
    serverCommand('quit')
  }

  onMelee(swing => {
    if (done || !trainee || swing.attackerPlayer.slot === trainee.slot) return
    const target = trainee.pawn()
    const shouldHit = stage !== 1
    if (!target || !swing.heavy || swing.hits.includes(target.entity) !== shouldHit || starts.length !== stage + 1) {
      finish(false, 'unexpected native contact at stage ' + stage + ', measured ' + starts[stage] + ' units'); return
    }
    stage++
    if (stage === bands.length) { finish(true, 'maximum hit, just beyond missed, custom range and point blank hit'); return }
    const [minimum, maximum] = bands[stage]
    if (!changeSetting('melee_min', String(minimum)) || !changeSetting('melee_max', String(maximum))) {
      finish(false, 'could not edit the live distance limits')
    }
  })

  onFrame(({ timeSeconds: now }) => {
    if (done) return
    if (started < 0) started = now
    if (now - started > 38) { finish(false, 'timed out'); return }
    if (!trainee) {
      trainee = addBot({ name: 'Distance trainee', team: 2, hero: 'hero_wraith' })
      if (trainee) testSubject(trainee, undefined, false)
      return
    }
    const target = trainee.pawn()
    if (!target?.hero) return
    if (!running) {
      if (!changeSetting('preset', '0') || !changeSetting('effects', '0') || !changeSetting('hero1', 'hero_wraith')) {
        finish(false, 'could not select Easiest with a Wraith opponent'); return
      }
      running = beginTraining({ mode: 'none' })
      return
    }
    const attacker = players().find(c => c.name === 'Trainer opponent 1')?.player
    const fighter = attacker?.pawn()
    if (!attacker || !fighter?.hero) return
    const charging = Boolean((attacker.buttons() ?? 0n) & Buttons.melee)
    const p = fighter.position, t = target.position
    const distance = Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z)
    if (stage === 1 && !movedBeyondRange && Math.abs(distance - meleeRange.farthest) < 0.01) {
      // The game has placed the attacker and queued the heavy. Move the test
      // subject 0.1 unit along that ray before the first movement tick.
      const extra = 0.1 / distance
      const beyond = { x: t.x + (t.x - p.x) * extra, y: t.y + (t.y - p.y) * extra, z: t.z }
      if (!trainee.teleport(beyond, target.eyeAngles, { x: 0, y: 0, z: 0 })) {
        finish(false, 'could not place target outside stock reach'); return
      }
      const moved = trainee.pawn()!.position
      lastFrameDistance = Math.hypot(p.x - moved.x, p.y - moved.y, p.z - moved.z)
      movedBeyondRange = true
      return
    }
    if (charging && !wasCharging) {
      const [minimum, maximum] = bands[stage]
      // By the time the queued input is visible, the attacker has moved. The
      // previous frame captured both pawns immediately after dispatch instead.
      const extra = stage === 1 ? 0.1 : 0
      if (lastFrameDistance < meleeRange.units(minimum) + extra - 0.01 ||
          lastFrameDistance > meleeRange.units(maximum) + extra + 0.01) {
        finish(false, 'attacker started outside the configured range'); return
      }
      starts.push(lastFrameDistance)
    }
    lastFrameDistance = distance
    wasCharging = charging
  })
}
