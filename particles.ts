import { after, createParticle, entityPosition, fireInput, holdModifierState, log, readModifierField, readField,
  type Ability, type ParticleOptions, type Pawn, type Player, type Vector, type WorldObject } from 'modlock'
import { billyMelee, billyMeleeEffects, quietMeleeFor } from './native/quiet-melee'

export type ClientAssets = 'stock' | 'private'

const quiet = 'parry_trainer_quiet_'
const innateSprint = 'citadel_ability_sprint'
// A stock continuous dash dust emitter. It only needs CP0, the world position.
// The ordinary melee swing smoke is a single burst; heavy-air has no swing smoke.
export const lungeDust = 'particles/abilities/shiv/shiv_dash_dust.vpcf'
let show = false
const optionalParticles = new Set<WorldObject>()

function startCue(options: ParticleOptions): WorldObject | undefined {
  const effect = createParticle(options)
  if (effect) optionalParticles.add(effect)
  return effect
}

function endCue(effect: WorldObject | undefined): void {
  if (!effect || !optionalParticles.delete(effect)) return
  const entity = effect.entity()
  if (entity) fireInput(entity, 'DestroyImmediately')
  effect.remove()
}

export interface LungeTrail {
  stockMelee?: string
  weapon?: number
  cloud?: WorldObject
  drawBilly?: boolean
  hand?: WorldObject
  charge?: WorldObject
  previousState?: number
}

export const billyParticleResources = [billyMeleeEffects.charge, billyMeleeEffects.attack, billyMeleeEffects.groundSwing]

export const meleeCuesEnabled = () => show

export function clearMeleeParticles(): void {
  for (const effect of optionalParticles) endCue(effect)
}

export function setMeleeCues(enabled: boolean): void {
  show = enabled
  if (!enabled) clearMeleeParticles()
}

export function prepareAttackerCues(bot: Player, entity: number, assets: ClientAssets, trail: LungeTrail): boolean {
  const abilities = bot.abilities()
  // ESlot_Weapon_Melee from ECitadelAbilitySlots.
  const melee = abilities.find(a => a.slot === 22)
  if (!melee) return false
  trail.stockMelee ??= melee.name
  let wanted = trail.stockMelee
  if (assets === 'stock') {
    // Native heavy movement and the passive sprint emitter are independent.
    // The latter draws white streaks even on a pawn with hidden particles.
    holdModifierState(entity, 'MODIFIER_STATE_SPRINT_DISABLED', !show)
    trail.drawBilly = show && wanted === billyMelee
    if (!show) wanted = quietMeleeFor(wanted) ?? wanted
  } else {
    const sprint = abilities.find(a => a.slot === 18)
    if (sprint && !equip(bot, sprint, show ? innateSprint : quiet + innateSprint)) return false
    if (!show) wanted = quiet + wanted
  }
  trail.weapon = equip(bot, melee, wanted)
  return trail.weapon !== undefined
}

function equip(bot: Player, ability: Ability, wanted: string): number | undefined {
  if (wanted === ability.name) return ability.entity
  if (!bot.replaceAbility(ability.slot, wanted, true)) {
    log('Parry Trainer: could not select opponent ability ' + wanted)
    return
  }
  // replaceAbility creates a fresh entity handle.
  return bot.abilities().find(a => a.slot === ability.slot)?.entity
}

// Billy's charge-slowdown curve has no spare stock equivalent. His bot keeps
// its own weapon in both modes. The human client's own punch is predicted.
function drawBillyWeapon(trail: LungeTrail, state: number, feet: Vector, pawn: number): void {
  const effects = billyMeleeEffects
  if (state >= 1 && state <= 3 && !trail.hand &&
      readField(trail.weapon!, 'CCitadel_Ability_HoldMelee', 'm_bCreatedChargeEffects', 'bool')) {
    // The stock charge reads the bat from control point 1. Anchor it to
    // the actual animated melee attachment, independently of the model's visibility.
    const hand = startCue({ resource: effects.charge, position: feet, parent: pawn, inactive: true })
    const target = hand?.entity()
    if (target && fireInput(target, 'SetParentAttachment', { text: effects.attachment })) {
      trail.hand = hand
      trail.charge = startCue({ resource: effects.charge, position: feet, parent: pawn,
        anchors: [{ index: 1, entity: target }] })
      const charge = trail.charge
      after(1.5, () => {
        if (trail.charge === charge) {
          endCue(charge)
          trail.charge = undefined
        }
        if (trail.hand === hand) trail.hand = undefined
        endCue(hand)
      })
    } else endCue(hand)
  }
  if (state === 4 && trail.previousState !== 4) {
    const attack = readField(trail.weapon!, 'CCitadel_Ability_HoldMelee', 'm_eCurrentAttackType', 'uint32')
    const hand = trail.hand?.entity()
    endCue(trail.charge)
    trail.charge = undefined
    if (attack === 2 || attack === 3) {
      const flash = startCue({ resource: effects.attack, position: feet, parent: pawn,
        anchors: hand ? [{ index: 1, entity: hand }] : undefined })
      const swing = attack === 2 ? startCue({ resource: effects.groundSwing, position: feet, parent: pawn }) : undefined
      after(0.6, () => { endCue(flash); endCue(swing) })
    }
  }
  trail.previousState = state
}

export function drawLungeDust(trail: LungeTrail | undefined, feet: Vector, pawn: number): void {
  if (!trail?.weapon) return
  const state = show && readField(trail.weapon, 'CCitadel_Ability_HoldMelee', 'm_eCurrentAttackState', 'uint32')
  if (trail.drawBilly && typeof state === 'number') drawBillyWeapon(trail, state, feet, pawn)
  // EMeleeHold_AttackState: ground dash, air dash, slide dash.
  if (state !== 2 && state !== 3 && state !== 5) {
    if (trail.cloud) {
      endCue(trail.cloud)
      trail.cloud = undefined
    }
    return
  }
  const position = { x: feet.x, y: feet.y, z: feet.z + 8 }
  if (trail.cloud) {
    trail.cloud.move(position)
    return
  }
  // A world emitter moves along the simulated pawn trajectory. Leaving it
  // unparented keeps it visible while the pawn's own particles are hidden.
  const cloud = startCue({ resource: lungeDust, position })
  if (!cloud) return
  trail.cloud = cloud
  // Also clean up if the opponent leaves or dies in the middle of a dash.
  after(0.8, () => {
    if (trail.cloud === cloud) {
      endCue(cloud)
      trail.cloud = undefined
    }
  })
}

// The private parry-victim VData omits its own sparks and the inherited stun
// orbit. The defender's activation, success flash and the stun itself stay native.
export const parriedSparks = 'particles/abilities/melee/melee_parry_debuff.vpcf'
export const parriedOrbit = 'particles/modifiers/stunned.vpcf'
const parryStun = 'citadel_ability_melee_parry/modifier_citadel_parried_stun'
let showParried = false
interface CaughtOpponent {
  graceUntil: number
  contact?: Vector
  sparks?: WorldObject
  orbit?: WorldObject
}
const caught = new Map<number, CaughtOpponent>()

// The stun switch takes priority once the defender catches the attack.
export function stockCuesVisible(entity: number, windingUp: boolean): boolean {
  return caught.has(entity) ? showParried : windingUp && show
}

export function setStockCueVisibility(entity: number, visible: boolean): void {
  holdModifierState(entity, 'MODIFIER_STATE_DO_NOT_DRAW_PARTICLES', !visible)
  holdModifierState(entity, 'MODIFIER_STATE_INVISIBLE_TO_ENEMY', !visible)
}

function removeStunGraphics(victim: CaughtOpponent, immediately: boolean): void {
  for (const effect of [victim.sparks, victim.orbit]) {
    if (!effect) continue
    const handle = immediately && effect.entity()
    if (handle) fireInput(handle, 'DestroyImmediately')
    effect.remove()
  }
  victim.orbit = undefined
  victim.sparks = undefined
}

export function setParriedEffects(enabled: boolean): void {
  showParried = enabled
  if (!enabled) for (const victim of caught.values()) removeStunGraphics(victim, true)
}

export function caughtInParry(entity: number, now: number): void {
  // The event and the first replicated stun update can straddle a server tick.
  const victim = caught.get(entity) ?? { graceUntil: 0 }
  victim.graceUntil = now + 0.1
  caught.set(entity, victim)
}

// Retail starts victim-side particles on the client even on a hidden pawn.
// Let the native stun run on the same bot, in an unused corner behind the camera.
// Keep it at the trainee's height so looking down from the air can't reveal it.
export function placeStunnedOpponent(bot: Player, pawn: Pawn, trainee: Pawn, arena: Vector): void {
  const victim = caught.get(pawn.entity)
  if (!victim) return
  const zero = { x: 0, y: 0, z: 0 }
  if (showParried) {
    if (victim.contact && bot.teleport(victim.contact, pawn.eyeAngles, zero)) victim.contact = undefined
    return
  }
  victim.contact ??= { ...pawn.position }
  const yaw = trainee.cameraAngles.yaw * Math.PI / 180
  const forwardX = Math.cos(yaw), forwardY = Math.sin(yaw)
  const depth = (pawn.position.x - trainee.position.x) * forwardX + (pawn.position.y - trainee.position.y) * forwardY
  if (depth < -2400 && Math.abs(pawn.position.z - trainee.position.z) < 256) return
  const x = arena.x + (forwardX >= 0 ? -7400 : 7400)
  const y = arena.y + (forwardY >= 0 ? -7400 : 7400)
  bot.teleport({ x, y, z: trainee.position.z }, pawn.eyeAngles, zero)
}

export function recenterStunContact(entity: number, dx: number, dy: number): boolean {
  const victim = caught.get(entity)
  if (!victim?.contact) return false
  const { x, y, z } = victim.contact
  victim.contact = { x: x - dx, y: y - dy, z }
  return true
}

export function clearCaughtOpponents(): void {
  for (const victim of caught.values()) removeStunGraphics(victim, true)
  caught.clear()
}

export function updateParriedEffects(now: number, assets: ClientAssets): void {
  for (const [entity, victim] of caught) {
    if (readModifierField(entity, parryStun, 'CBaseModifier', 'm_bDisabled', 'bool') !== false) {
      if (now < victim.graceUntil) continue
      removeStunGraphics(victim, false)
      caught.delete(entity)
      continue
    }
    // The stock client already owns both stun effects on the native modifier.
    if (assets === 'stock' || !showParried || (victim.sparks && victim.orbit)) continue
    const position = entityPosition(entity)?.position
    if (!position) continue
    const attachment = { position, parent: entity, anchors: [{ index: 0, entity }] }
    victim.sparks ??= createParticle({ resource: parriedSparks, ...attachment })
    // stunned.vpcf scales orbit height by 140 * CP2.x. Set a normal hero scale.
    victim.orbit ??= createParticle({ resource: parriedOrbit, ...attachment,
      point: { index: 2, position: { x: 1, y: 0, z: 0 } } })
  }
}
