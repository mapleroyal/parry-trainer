import { addBot, damage, heroNamed, log, modifierState, onFrame, onMelee, players, readField,
  serverCommand, type Player, type Vector } from 'modlock'
import { setMeleeDistances, setFastStamina, setOpponentHero, setSecondOpponent, testSubject } from '../gameplay'

// The retail Roll binding is +in_innate1. The SDK's Buttons.dash is IN_SPEED.
const rollButton = 1n << 44n

// First drive a controlled head-on dash into a production heavy lunge. Then run
// a free-moving, two-opponent sample to exercise other angles and hero swaps.
export default function registerTrackingProbe(): void {
  let active = true
  let started = -1, spawned = -1, nextDash = 0
  let subject: Player | undefined
  let peakSpeed = 0, headOnSpeed = 0, rollSent = false
  let heavy = 0, moving = 0, movingHits = 0, lights = 0, dashHits = 0
  let swapped = false, swapSeen = false
  let staminaStage = 0, fast = 0, stock = 0
  let sampleAt = 0, trackedTravel = 0
  const chargeStart = new Map<number, Vector>()
  let now = 0, retainedSource = false
  let impact: { who: Player; entity: number; position: Vector; time: number } | undefined
  const scoredHeroes = new Set<number>()
  const abrams = heroNamed('Abrams')!.id

  function finish(ok: boolean): void {
    active = false
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'tracking',
      'native heavy', heavy, 'moving hits/swings', movingHits, moving,
      'controlled mid-dash contact speed', Math.round(headOnSpeed),
      'lights', lights, 'peak speed', Math.round(peakSpeed), 'free-run mid-dash hits', dashHits,
      'target displacement between windup and hit', Math.round(trackedTravel),
      'impact source stayed nearby', retainedSource,
      'swapped hero struck', scoredHeroes.has(abrams), 'stamina fast/stock', fast, stock)
    serverCommand('quit')
  }
  onMelee(swing => {
    if (!active || !subject || swing.attackerPlayer.slot === subject.slot) return
    const target = subject.pawn()
    if (!target?.hero) return
    const speed = Math.hypot(target.velocity.x, target.velocity.y)
    const landed = swing.hits.includes(target.entity)
    if (!headOnSpeed) {
      // Read the stock ground-dash state at the hit. Speed or a recent Roll
      // input alone can't distinguish an active dash from its recovery.
      if (!swing.heavy || !landed || !rollSent || speed <= 480 ||
          !modifierState(target.entity, 'MODIFIER_STATE_GROUND_DASHING')) {
        finish(false)
        return
      }
      headOnSpeed = speed
      setMeleeDistances(0, 100, 50)
      setSecondOpponent(true)
      return
    }
    if (!swing.heavy) { lights++; return }
    heavy++
    if (speed < 160) return
    moving++
    if (!landed) return
    const from = chargeStart.get(swing.attacker)
    if (from) trackedTravel = Math.max(trackedTravel, Math.hypot(target.position.x - from.x, target.position.y - from.y))
    movingHits++
    if (modifierState(target.entity, 'MODIFIER_STATE_GROUND_DASHING')) dashHits++
    const attacker = swing.attackerPlayer.pawn()
    if (attacker?.hero) {
      scoredHeroes.add(attacker.hero)
      if (!impact && !retainedSource) impact = {
        who: swing.attackerPlayer, entity: attacker.entity, position: attacker.position, time: now,
      }
    }
  })
  onFrame(({ timeSeconds: t }) => {
    if (!active) return
    now = t
    if (started < 0) started = t
    if (t - started > 60) { finish(false); return }
    if (!subject) {
      subject = addBot({ name: 'Tracking trainee', team: 2, hero: 'hero_wraith' })
      if (subject) {
        testSubject(subject)
        setMeleeDistances(100, 100, 50)
      }
      return
    }
    const p = subject.pawn()
    if (!p?.hero) return
    if (spawned < 0) spawned = t
    const age = t - spawned
    if (impact && t - impact.time > 0.45) {
      const pawn = impact.who.pawn()
      if (pawn?.entity === impact.entity) {
        const p = impact.position
        retainedSource = Math.hypot(pawn.position.x - p.x, pawn.position.y - p.y, pawn.position.z - p.z) < 300
      }
      impact = undefined
    }
    peakSpeed = Math.max(peakSpeed, Math.hypot(p.velocity.x, p.velocity.y))

    const opponents = players().filter(c => c.name.startsWith('Trainer opponent '))
    for (const c of opponents) {
      const fighter = c.player.pawn()
      const weapon = c.player.abilities().find(a => a.slot === 22)
      if (!fighter?.hero || !weapon) continue
      const state = readField(weapon.entity, 'CCitadel_Ability_HoldMelee', 'm_eCurrentAttackState', 'uint32')
      if (!headOnSpeed) {
        // Close along the lunge axis, then roll through the remaining distance.
        // Use actual separation so the test also works for an elevated windup.
        const dx = fighter.position.x - p.position.x, dy = fighter.position.y - p.position.y
        const lunging = state === 2
        const roll = lunging && !rollSent && Math.hypot(dx, dy) <= 260
        const pressed = roll ? rollButton : 0n
        subject.drive({ facing: { yaw: Math.atan2(dy, dx) * 180 / Math.PI, pitch: 0, roll: 0 },
                        forward: lunging ? 1 : 0, left: 0, pressed, held: pressed })
        if (roll) rollSent = true
        return
      }
      if (state === 1 && !chargeStart.has(fighter.entity)) chargeStart.set(fighter.entity, p.position)
      if (state === 0) chargeStart.delete(fighter.entity)
    }

    if (!headOnSpeed) return

    // Stock stamina also refills rapidly out of combat. Give both measurements
    // the same combat condition instead of relying on a random early swing.
    const attacker = opponents[0]?.player.pawn()
    if (staminaStage === 0 && attacker?.hero) {
      damage({ victim: p.entity, attacker: attacker.entity, amount: 1 })
      if (subject.setStamina(0)) { sampleAt = t + 1.5; staminaStage = 1 }
    }
    if (staminaStage === 1 && t >= sampleAt && attacker?.hero) {
      fast = p.stamina ?? 0
      setFastStamina(false)
      damage({ victim: p.entity, attacker: attacker.entity, amount: 1 })
      if (subject.setStamina(0)) { sampleAt = t + 1.5; staminaStage = 2 }
    }
    if (staminaStage === 2 && t >= sampleAt) {
      stock = p.stamina ?? 0
      setFastStamina(true)
      staminaStage = 3
      nextDash = t + 1
    }
    let pressed = 0n
    if (staminaStage === 3 && t >= nextDash) {
      nextDash = t + 2.4
      pressed = rollButton
    }
    subject.drive({ facing: { yaw: age * 39, pitch: 0, roll: 0 },
                     forward: 1, left: 0, held: pressed, pressed })
    if (!swapped && moving >= 3) swapped = setOpponentHero(1, 'hero_atlas')
    if (swapped && !swapSeen) {
      swapSeen = players().some(c => c.name === 'Trainer opponent 2' && c.player.pawn()?.hero === abrams)
    }
    if (moving >= 10 && swapSeen && scoredHeroes.has(abrams)) {
      finish(trackedTravel >= 100 && peakSpeed > 480 &&
             retainedSource && lights === 0 && fast > stock && staminaStage === 3)
    }
  })
}
