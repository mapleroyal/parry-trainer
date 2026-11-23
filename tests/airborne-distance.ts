// Hold each flight state until the opponent starts its native windup, then
// let both pawns travel freely. At the outer reach a poorly placed attacker
// can pass above a falling player or underneath a rising one.
import { addBot, Buttons, log, onFrame, onMelee, players, serverCommand, type Player } from 'modlock'
import { setMeleeDistances, testSubject } from '../gameplay'

export default function registerAirborneProbe(): void {
  const flight = [
    { height: 80, speed: 0 }, { height: 120, speed: 420 },
    { height: 700, speed: -200 }, { height: 700, speed: 400 },
  ]
  let target: Player | undefined, began = -1, stage = 0, released = false, done = false

  function finish(ok: boolean, reason: string): void {
    done = true
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'airborne-distance', reason)
    serverCommand('quit')
  }

  onMelee(swing => {
    if (done || !target || swing.attackerPlayer.slot === target.slot) return
    const pawn = target.pawn(), { height, speed } = flight[stage]
    if (!released || !pawn || !swing.heavy || !swing.hits.includes(pawn.entity)) {
      finish(false, 'miss from flight state ' + height + ' units, ' + speed + ' units/s')
      return
    }
    released = false
    if (++stage === flight.length) finish(true, 'maximum-distance native hits on rising, falling and jump-apex targets')
  })

  onFrame(({ timeSeconds }) => {
    if (done) return
    if (began < 0) began = timeSeconds
    if (timeSeconds - began > 45) { finish(false, 'timed out at flight state ' + stage); return }
    if (!target) {
      target = addBot({ name: 'Airborne trainee', team: 2, hero: 'hero_wraith' })
      if (target) {
        testSubject(target)
        setMeleeDistances(100, 100, 50)
      }
      return
    }
    const pawn = target.pawn()
    if (!pawn?.hero || released) return
    const attacker = players().find(p => p.name === 'Trainer opponent 1')?.player
    // The previous punch has already released melee by the time onMelee fires.
    if ((attacker?.buttons() ?? 0n) & Buttons.melee) { released = true; return }
    const { height, speed } = flight[stage]
    target.teleport({ x: 0, y: 0, z: height }, pawn.eyeAngles, { x: 0, y: 0, z: speed })
  })
}
