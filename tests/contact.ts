// Run on a headless server with --arg contact. All three participants are real bot heroes.
// First show that a regular enemy in our line of fire catches the rounds. Then conceal that
// same enemy and repeat the identical shot into the enemy behind it.
import { addBot, Buttons, log, onDamaged, onFrame, serverCommand, type Player } from 'modlock'
import { conceal } from '../gameplay'

type Trial = 'clear shot' | 'ordinary blocker' | 'concealed blocker' | 'clear walk' | 'walk through opponent'
const trials: Trial[] = ['clear shot', 'ordinary blocker', 'concealed blocker', 'clear walk', 'walk through opponent']
const east = { pitch: 0, yaw: 0, roll: 0 }
const zero = { x: 0, y: 0, z: 0 }
const at = (x: number, y = 0) => ({ x, y, z: 2 })
const shooting = (trial: Trial) => trial === 'clear shot' || trial === 'ordinary blocker' || trial === 'concealed blocker'

function drive(bot: Player, forward = 0, held = 0n): boolean {
  return bot.drive({ facing: east, forward, left: 0, held, pressed: held })
}

export default function registerContactProbe(): void {
  let active = true
  let start = -1
  let readyAt = -1
  let shooter: Player | undefined, opponent: Player | undefined, witness: Player | undefined
  let trialIndex = -1
  let trialStart = 0
  let inputSent = false
  let shooterId = 0, opponentId = 0, witnessId = 0
  let frontHits = 0, rearHits = 0, closest = Infinity
  let clearWalk = 0
  let passed = true

  function finish(ok: boolean, detail: string): void {
    active = false
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'contact', detail)
    serverCommand('quit')
  }

  onDamaged(hit => {
    if (!active || hit.attacker !== shooterId || !inputSent || hit.healthLost <= 0) return
    if (hit.victim === opponentId) frontHits++
    if (hit.victim === witnessId) rearHits++
  })
  onFrame(frame => {
    if (!active) return
    const now = frame.timeSeconds
    if (start < 0) start = now
    if (now - start > 45) { finish(false, 'timeout or missing hero'); return }
    shooter ??= addBot({ name: 'Contact trainee', team: 2, hero: 'hero_wraith' })
    opponent ??= addBot({ name: 'Contact opponent', team: 3, hero: 'hero_wraith' })
    witness ??= addBot({ name: 'Contact witness', team: 3, hero: 'hero_wraith' })
    if (!shooter || !opponent || !witness) return
    const pawn = shooter.pawn(), blocker = opponent.pawn(), target = witness.pawn()
    if (!pawn?.hero || !blocker?.hero || !target?.hero) return
    // Let match-intro respawns and weapon deploy finish before placing the measurement.
    if (readyAt < 0) readyAt = now + 6
    if (now < readyAt) return

    if (trialIndex < 0 || trialStart === 0) {
      if (++trialIndex === trials.length) { finish(passed, 'native gunfire and movement'); return }
      const trial = trials[trialIndex]
      drive(shooter); drive(opponent); drive(witness)
      const isWalking = !shooting(trial)
      shooter.teleport(at(isWalking ? -100 : -180), east, zero)
      opponent.teleport(at(0, trial === 'clear shot' || trial === 'clear walk' ? 512 : 0), east, zero)
      witness.teleport(at(160, isWalking ? -512 : 0), east, zero)
      if (trial === 'concealed blocker' || trial === 'walk through opponent') conceal(blocker.entity)
      shooterId = pawn.entity; opponentId = blocker.entity; witnessId = target.entity
      inputSent = false; frontHits = 0; rearHits = 0; closest = Infinity
      trialStart = now
      return
    }

    const age = now - trialStart
    const trial = trials[trialIndex]
    if (!inputSent && age >= 0.45) {
      if (!drive(shooter, shooting(trial) ? 0 : 1, shooting(trial) ? Buttons.attack : 0n)) {
        finish(false, 'bot drive rejected'); return
      }
      inputSent = true
    }
    if (!inputSent) return
    const clearance = Math.hypot(blocker.position.x - pawn.position.x, blocker.position.y - pawn.position.y)
    closest = Math.min(closest, clearance)
    // Stop firing before the end so real projectiles have time to hit the witness.
    if (shooting(trial) && age >= 1.30) drive(shooter)
    if (age < (shooting(trial) ? 1.70 : 1.55)) return

    let ok: boolean
    if (trial === 'clear shot') ok = rearHits > 0 && frontHits === 0
    else if (trial === 'ordinary blocker') ok = frontHits > 0 && rearHits === 0
    else if (trial === 'concealed blocker') ok = rearHits > 0 && frontHits === 0
    else if (trial === 'clear walk') {
      clearWalk = pawn.position.x + 100
      ok = clearWalk > 180
    } else {
      const traveled = pawn.position.x + 100
      ok = closest < 10 && traveled >= clearWalk * 0.90 && Math.abs(pawn.position.y) < 8
    }
    log('contact:', trial, ok ? 'PASS' : 'FAIL', 'front hits', frontHits, 'rear hits', rearHits,
        'walk end x', Math.round(pawn.position.x), 'closest XY', Math.round(closest))
    passed = passed && ok
    drive(shooter)
    trialStart = 0
  })
}
