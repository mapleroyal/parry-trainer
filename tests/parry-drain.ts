// Exercise the trainee's real drain and cast callbacks with synchronized native heavies.
import { addBot, Buttons, holdModifierState, log, onAbilityCast, onFrame, onParry, onSpawn,
  serverCommand, writeField, type Player } from 'modlock'
import { beginTraining, conceal, testSubject } from '../gameplay'
import { session } from '../session'
import { applyConfiguration } from '../trainer-settings'

export default function registerParryDrainProbe(): void {
  let trainee: Player | undefined, left: Player | undefined, right: Player | undefined
  let phase: 'setup' | 'countdown' | 'windup' | 'catch' | 'miss' | 'fatal miss' | 'done' = 'setup'
  let start = -1, windup = -1, now = 0, castAt = -1, costBefore = 0, catches = 0, pressed = false
  let liftAt = -1
  const zero = { x: 0, y: 0, z: 0 }
  function finish(ok: boolean, why: string): void {
    phase = 'done'
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'parry-drain', why, 'catches', catches,
      'deaths', session.deaths, 'damage', session.damageTaken)
    serverCommand('quit')
  }
  onSpawn((p, pawn) => {
    if (p.connection()?.name.startsWith('Trainer opponent ')) holdModifierState(pawn.entity, 'MODIFIER_STATE_MELEE_DISABLED')
  })
  onAbilityCast(cast => {
    if (cast.caster !== trainee?.pawn()?.entity || cast.name !== 'citadel_ability_melee_parry') return
    castAt = now
    costBefore = session.damageTaken
    if (phase === 'catch' || phase === 'fatal miss')
      writeField(cast.caster, 'CBaseEntity', 'm_iHealth', 'int32', 12)
  })
  onParry(event => {
    if (event.parrier !== trainee?.pawn()?.entity) return
    catches++
    if (phase === 'catch' && (session.damageTaken !== costBefore || now - castAt < 0.6))
      finish(false, 'scored drain during the guard before contact, or no measurable lunge')
  })
  onFrame(frame => {
    if (phase === 'done') return
    now = frame.timeSeconds
    if (start < 0) start = now
    if (now - start > 18) { finish(false, 'timeout in ' + phase); return }
    if (!trainee) {
      trainee = addBot({ name: 'Guard trainee', team: 2, hero: 'hero_wraith' })
      if (trainee) testSubject(trainee, undefined, false)
      return
    }
    left ??= addBot({ name: 'Guard left', team: 3, hero: 'hero_wraith' })
    right ??= addBot({ name: 'Guard right', team: 3, hero: 'hero_wraith' })
    const pawn = trainee.pawn(), l = left?.pawn(), r = right?.pawn()
    if (!pawn?.hero || !l?.hero || !r?.hero || !left || !right) return
    if (phase === 'setup') {
      conceal(l.entity); conceal(r.entity)
      applyConfiguration('preset=50,version=5,idle_drain=1,idle_rate=50,fail_on_death=1,penalty_whiff=0')
      if (beginTraining({mode: 'none'})) phase = 'countdown'
      return
    }
    if (phase === 'countdown') {
      if (session.phase !== 'running' || session.damageTaken < 15) return
      windup = now; phase = 'windup'
    }
    if (phase === 'windup' || phase === 'catch') {
      const age = now - windup
      for (const [bot, sign] of [[left, -1], [right, 1]] as const) {
        const facing = { pitch: 0, yaw: sign < 0 ? 0 : 180, roll: 0 }
        if (age === 0) bot.teleport({ x: pawn.position.x + sign * 320, y: pawn.position.y, z: pawn.position.z }, facing, zero)
        bot.drive({ facing, forward: age < .6 ? 1 : 0, left: 0, held: age < .34 ? Buttons.melee : 0n,
          pressed: age === 0 ? Buttons.melee : 0n })
      }
      if (phase === 'windup' && age >= .125) {
        phase = 'catch'
        trainee.press(Buttons.parry)
      }
      if (session.deaths || age > 2) { finish(false, 'low-health guard failed to survive both incoming heavies'); return }
      if (catches !== 2 || session.damageTaken === costBefore) return
      // First ordinary stationary tick after a successful guard cannot include the deferred cost.
      if (session.damageTaken - costBefore > 10) { finish(false, 'caught guard was charged on expiry'); return }
      trainee.heal(pawn.effectiveMaxHealth ?? pawn.maxHealth)
      phase = 'miss'; castAt = -1
      return
    }
    if (!pressed) {
      // The final miss is entirely stationary, after the previous jump lands.
      if (phase === 'fatal miss' && now - liftAt < 1.5) return
      trainee.refreshAbility('citadel_ability_melee_parry')
      pressed = trainee.press(Buttons.parry)
      return
    }
    if (castAt < 0) return
    const age = now - castAt, cost = session.damageTaken - costBefore
    // Put the pawn in real airborne motion before this empty guard expires.
    // Only the earlier standing time is owed, even if still moving at settlement.
    if (phase === 'miss' && age >= .18 && liftAt < 0) {
      if (!trainee.teleport({ ...pawn.position, z: pawn.position.z + 90 }, pawn.eyeAngles, { x: 0, y: 0, z: 480 })) {
        finish(false, 'failed to lift the guarding trainee'); return
      }
      liftAt = now
    }
    if (!cost || age < .05) return
    if (phase === 'miss') {
      const expected = (pawn.effectiveMaxHealth ?? pawn.maxHealth) * .5 * (liftAt - castAt)
      if (age < .2 || Math.abs(pawn.velocity.z) < 2 || Math.abs(cost - expected) > 12 || session.deaths) {
        finish(false, 'moving on empty guard expiry, cost ' + cost + ' expected ' + expected); return
      }
      phase = 'fatal miss'; castAt = -1; pressed = false
    } else finish(age > .2 && session.deaths === 1 && session.reason === 'death' &&
      session.deathCause === 'standing-drain' && cost >= 12 && cost < 18, 'low-HP double catch, partial stillness charged during motion, lethal missed guard')
  })
}
