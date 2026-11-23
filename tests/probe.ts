// A headless match with a bot as the trainee. Never drives a human player's inputs.
import { addBot, Buttons, Layers, log, modifierState, onDamaged, onFrame, onMelee,
  onParry, players, serverCommand, trace, type Pawn, type Player } from 'modlock'
import { setFreeParry, setSecondOpponent, testSubject } from '../gameplay'

function heroTrace(pawn: Pawn, ignore: number[] = [], layers = Layers.hero | Layers.player | Layers.hitbox): number | undefined {
  const { x, y, z } = pawn.position
  return trace({
    start: { x: x - 46, y, z: z + 42 }, end: { x: x + 46, y, z: z + 42 },
    layers, ignore,
  })?.entity
}

export default function registerProbe(): void {
  let active = true
  let started = -1
  let now = 0
  let nextTry = 0
  let subject: Player | undefined
  let floorVerified = false
  let movedAcrossEdge = false
  let wrapped = false
  let screened = false
  let traceChecked = false
  let swingShapeVerified = false
  let shortRecovery = false
  let shortAtStartup = false
  let cooldownVerified = false
  let heavies = 0, lights = 0, hits = 0, catches = 0, missed = 0
  let priorWindup = 0, longestWait = 0, wasCharging = false
  let second = false, removing = false
  const attackers = new Set<number>()
  let previousReport = -1

  function finish(pass: boolean, message: string): void {
    active = false
    log(pass ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', message, 'heavies', heavies,
      'light', lights, 'damage', hits, 'parries', catches, 'misses', missed,
      'longest solo gap', longestWait, 'floor', floorVerified, 'wrapped', wrapped,
      'ghost shape at rest/attacking', screened, swingShapeVerified,
      'practice default/stock/practice cooldown', shortAtStartup, cooldownVerified, shortRecovery)
    serverCommand('quit')
  }

  onMelee(swing => {
    if (!active || !subject || swing.attackerPlayer.slot === subject.slot) return
    if (!swing.heavy) { lights++; return }
    attackers.add(swing.attackerPlayer.slot)
    const target = subject.pawn()?.entity
    if (wrapped && !second && target && !swing.hits.includes(target)) missed++
    heavies++
    log('probe: heavy', swing.attackerPlayer.slot, 'hit count', swing.hits.length)
  })
  onDamaged(hit => {
    if (active && subject && hit.victim === subject.pawn()?.entity && hit.healthLost > 0)
      hits++
  })
  onParry(result => {
    if (active && subject && result.player.slot === subject.slot) catches++
  })
  onFrame(frame => {
    if (!active) return
    now = frame.timeSeconds
    if (started < 0) started = now
    if (now - started > 106) { finish(false, 'timed out'); return }
    if (!subject) {
      if (now < nextTry) return
      nextTry = now + 1
      subject = addBot({ name: 'Probe trainee', team: 2, hero: 'hero_wraith' })
      if (subject) testSubject(subject)
      return
    }
    const pawn = subject.pawn()
    if (!pawn || !pawn.hero) return
    const others = players().filter(c => c.bot && c.player.slot !== subject!.slot)
    // Distances and travel times vary. The six-second interval governs when
    // the opponent begins the next windup, which the trainee can hear.
    if (!second && others.length === 1) {
      const charging = Boolean((others[0].player.buttons() ?? 0n) & Buttons.melee)
      if (charging && !wasCharging) {
        if (priorWindup > 0) longestWait = Math.max(now - priorWindup, longestWait)
        priorWindup = now
      }
      wasCharging = charging
    }
    const report = Math.floor((now - started) / 10)
    if (report !== previousReport) {
      previousReport = report
      log('probe: trainee z', pawn.position.z, 'opponents', others.length, 'damage', hits, 'parries', catches)
    }
    if (!floorVerified && now - started > 0.8 && Math.abs(pawn.position.z) < 3) {
      floorVerified = true
      // Test diagonal floating-origin wrap during a jump. Leave room below the
      // trainee so preserving the upward velocity can be observed.
      movedAcrossEdge = subject.teleport({ x: 4420, y: -4470, z: 104 }, pawn.eyeAngles,
                                         { x: 12, y: -25, z: 190 })
      return
    }
    if (movedAcrossEdge && !wrapped && Math.hypot(pawn.position.x, pawn.position.y) < 32 &&
        pawn.position.z > 95 && pawn.velocity.z > 0) {
      wrapped = true
      subject.teleport({ x: 0, y: 0, z: 4 }, pawn.eyeAngles, { x: 0, y: 0, z: 0 })
      subject.press(Buttons.parry)
    }
    if (wrapped && !cooldownVerified && !second) {
      const parry = subject.abilities().find(a => a.name === 'citadel_ability_melee_parry')
      if (!shortAtStartup && parry && parry.cooldownStart >= started && parry.cooldownEnd > parry.cooldownStart) {
        shortAtStartup = parry.cooldownEnd - parry.cooldownStart < 0.2
        if (shortAtStartup) {
          setFreeParry(false)
          nextTry = now + 1
        }
      } else if (shortAtStartup) {
        cooldownVerified = parry !== undefined && parry.cooldownEnd - now > 0.5
        if (!cooldownVerified && now >= nextTry) {
          subject.press(Buttons.parry)
          nextTry = now + 1
        }
      }
    }
    if (wrapped && !traceChecked && others.length && heroTrace(pawn) === pawn.entity) {
      const other = others[0].player.pawn()
      if (other && modifierState(other.entity, 'MODIFIER_STATE_DO_NOT_DRAW_MODEL') &&
          modifierState(other.entity, 'MODIFIER_STATE_FOOTSTEP_SOUNDS_DISABLE') &&
          modifierState(other.entity, 'MODIFIER_STATE_MOVEMENT_FOLEY_SOUNDS_DISABLE')) {
        const layers = [Layers.player, Layers.hero, Layers.hitbox, Layers.solid]
        const inspect = (p: Pawn, ignore: number[]) => layers.map(mask =>
          heroTrace(p, ignore, mask) === p.entity ? 'hit' : 'clear').join('/')
        log('probe: trace player/hero/hitbox/solid trainee', inspect(pawn, []),
            'opponent', inspect(other, [pawn.entity]))
        screened = heroTrace(other, [pawn.entity]) !== other.entity
        traceChecked = true
      }
    }
    if (screened && !swingShapeVerified && others.length) {
      const actor = others[0].player.pawn()
      if (actor && Math.hypot(actor.position.x - pawn.position.x, actor.position.y - pawn.position.y) < 220) {
        if (heroTrace(actor, [pawn.entity]) === actor.entity) {
          finish(false, 'opponent became solid during its windup')
          return
        }
        swingShapeVerified = true
      }
    }
    if (second && !removing && !shortRecovery) {
      const parry = subject.abilities().find(a => a.name === 'citadel_ability_melee_parry')
      if (parry && parry.cooldownStart >= started && parry.cooldownEnd > parry.cooldownStart)
        shortRecovery = parry.cooldownEnd - parry.cooldownStart < 0.2
    }
    if (heavies >= 12 && hits > 0 && !second) {
      second = true
      setFreeParry(true)
      setSecondOpponent(true)
    }
    if (second && now >= nextTry) {
      subject.press(Buttons.parry)
      nextTry = now + 0.33
    }
    if (shortRecovery && catches > 0 && attackers.size >= 2 && !removing) {
      removing = true
      setSecondOpponent(false)
      setFreeParry(false)
    }
    if (removing && others.length === 1) {
      finish(floorVerified && wrapped && screened && swingShapeVerified && shortAtStartup && cooldownVerified && shortRecovery && !lights && !missed &&
        longestWait > 0 && longestWait <= 6.12, 'second opponent attacked and was removed')
    }
  })
}
