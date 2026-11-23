import { addBot, Buttons, entityPosition, findEntities, log, modifiers, modifierState, onDamaged,
  onFrame, onMelee, onParry, players, readField, serverCommand, type Player } from 'modlock'
import { setMeleeDistances, setFreeParry, testSubject } from '../gameplay'
import { setMeleeCues, setParriedEffects, type ClientAssets } from '../particles'

const victimEffects = new Set(['particles/abilities/melee/melee_parry_debuff.vpcf',
  'particles/modifiers/stunned.vpcf'])
const parry = 'citadel_ability_melee_parry'

export default function registerParriedProbe(assets: ClientAssets = 'private'): void {
  let active = true, now = 0, start = -1, whiffAt = -1, checkCooldown = 0
  let cooldownEnd = 0, parryEntity = 0
  let hits = 0, heavies = 0, lights = 0, catches = 0
  let subject: Player | undefined
  let phase = -1, caughtAt = -1, nextPress = 0, sawStun = false
  const observedEffects = new Set<string>()
  let checkRemoval = false, enableAfterRecovery = false, reportedModifier = false
  const expected = [false, true, false]

  function finish(ok: boolean, why: string): void {
    active = false
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'parried', why, 'heavies', heavies,
      'damage hits', hits, 'native parries', catches, 'light swings', lights)
    serverCommand('quit')
  }
  onDamaged(hit => {
    if (active && subject && hit.victim === subject.pawn()?.entity && hit.healthLost > 0) hits++
  })
  onMelee(swing => {
    if (!active || swing.attackerPlayer.slot === subject?.slot) return
    if (swing.heavy) heavies++
    else lights++
  })
  onParry(result => {
    if (!active || phase < 0 || caughtAt >= 0 || result.player.slot !== subject?.slot) return
    catches++
    caughtAt = now
    sawStun = false
    observedEffects.clear()
  })
  onFrame(({ timeSeconds: time }) => {
    if (!active) return
    now = time
    if (start < 0) {
      start = now
      setMeleeDistances(0, 0, 50)
      setFreeParry(false)
      setParriedEffects(false)
      setMeleeCues(false)
    }
    if (now - start > 40) { finish(false, 'timeout in phase ' + phase); return }
    if (!subject) {
      subject = addBot({ name: 'Parried test trainee', team: 2, hero: 'hero_wraith' })
      if (subject) testSubject(subject, { x: 512, y: -384, z: 8 })
      return
    }
    const opponent = players().find(c => c.name === 'Trainer opponent 1')?.player
    const target = opponent?.pawn()
    const ability = subject.abilities().find(a => a.name === parry)
    if (!ability || !opponent || !target?.hero || !subject.pawn()?.hero) return
    const markers = findEntities('info_particle_system').flatMap(entity => {
      const name = readField(entity, 'CParticleSystem', 'm_iszEffectName', 'string')
      if (typeof name === 'string' && victimEffects.has(name) &&
          readField(entity, 'CParticleSystem', 'm_bActive', 'bool') === true) return [{ entity, name }]
      return []
    })

    if (phase < 0) {
      // Toggle both directions during a real missed parry's stock cooldown.
      // The toggle must preserve the native ability, its deadline and the whiff.
      if (markers.length) { finish(false, 'victim marker during setup or missed parry'); return }
      if (whiffAt < 0) {
        if (subject.press(Buttons.parry)) whiffAt = now
        return
      }
      if (!checkCooldown) {
        if (ability.cooldownStart < whiffAt - 0.1 || ability.cooldownEnd < now + 1) return
        parryEntity = ability.entity
        cooldownEnd = ability.cooldownEnd
        setParriedEffects(true)
        checkCooldown = 1
        return
      }
      if (checkCooldown < 3) {
        if (ability.entity !== parryEntity || Math.abs(ability.cooldownEnd - cooldownEnd) > 0.01) {
          finish(false, 'visual toggle reset the ability or its cooldown'); return
        }
        setParriedEffects(false)
        checkCooldown++
        return
      }
      if (!hits) return
      setFreeParry(true)
      phase = 0
    }
    if (ability.entity !== parryEntity) { finish(false, 'native parry was replaced'); return }
    if (checkRemoval && markers.length) { finish(false, 'disabled marker persisted'); return }
    checkRemoval = false
    if (enableAfterRecovery) {
      // Switching on while the prior opponent is still parried would correctly
      // show their current stun. Wait so the next native catch is independent.
      if (modifierState(target.entity, 'MODIFIER_STATE_STUNNED')) return
      setParriedEffects(true)
      enableAfterRecovery = false
    }
    const weapon = opponent.abilities().find(a => a.slot === 22)
    if (!weapon) return
    if (caughtAt < 0) {
      if (markers.length) { finish(false, 'marker before successful parry'); return }
      const state = readField(weapon.entity, 'CCitadel_Ability_HoldMelee', 'm_eCurrentAttackState', 'uint32')
      if ((state === 2 || state === 3 || state === 5) && now >= nextPress) {
        if (subject.press(Buttons.parry)) nextPress = now + 0.9
      }
      return
    }
    sawStun ||= modifierState(target.entity, 'MODIFIER_STATE_STUNNED') === true
    if (sawStun && !reportedModifier) {
      const statuses = modifiers(target.entity).filter(m => /parr|stun/i.test(m.name + m.className))
      log('parried: native status', statuses.map(m => m.name + '/' + m.className).join(','))
      reportedModifier = true
    }
    for (const marker of markers) {
      const pos = entityPosition(marker.entity)?.position
      if (pos && Math.hypot(pos.x - target.position.x, pos.y - target.position.y,
          pos.z - target.position.z) < 140) observedEffects.add(marker.name)
    }
    if (now - caughtAt < 0.30) return
    const wanted = assets === 'private' && expected[phase] ? victimEffects.size : 0
    if (!sawStun || observedEffects.size !== wanted || (!wanted && markers.length)) {
      finish(false, 'phase ' + phase + ' stun=' + sawStun + ' victim effects=' + [...observedEffects]); return
    }
    if (assets === 'stock' && (modifierState(target.entity, 'MODIFIER_STATE_INVISIBLE_TO_ENEMY') === expected[phase] ||
        modifierState(target.entity, 'MODIFIER_STATE_DO_NOT_DRAW_PARTICLES') === expected[phase])) {
      finish(false, 'incorrect opponent visibility states during parry ' + (phase + 1))
      return
    }
    if (weapon.name.startsWith('parry_trainer_quiet_') !== (assets === 'private' && phase < 2)) {
      finish(false, 'opponent melee cues followed the parried toggle'); return
    }
    log('parried: native stun, victim effect count', observedEffects.size, 'on swing', phase + 1)
    if (++phase === expected.length) {
      finish(catches === 3 && heavies >= 4 && !lights, 'off/on/off, original ability and cooldown'); return
    }
    // Keep melee cues off for the visible stun; turn them on for the last hidden stun.
    setMeleeCues(phase === 2)
    if (expected[phase]) enableAfterRecovery = true
    else setParriedEffects(false)
    checkRemoval = phase === 2
    caughtAt = -1
  })
}
