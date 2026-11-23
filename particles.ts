// All opponents use native melee. Only the standalone installation has private ability variants.
import { after, createParticle, entityPosition, fireInput, holdModifierState, log, readModifierField, readField,
  type Ability, type Player, type Vector, type WorldObject } from 'modlock'

export type ClientAssets = 'stock' | 'private'

const quiet = 'parry_trainer_quiet_'
const innateSprint = 'citadel_ability_sprint'
// A stock continuous dash dust emitter. It only needs CP0, the world position.
// The ordinary melee swing smoke is a single burst; heavy-air has no swing smoke.
export const lungeDust = 'particles/abilities/shiv/shiv_dash_dust.vpcf'
let show = false

export interface LungeTrail {
  weapon: number
  cloud?: WorldObject
}

export const meleeCuesEnabled = () => show

export function setMeleeCues(enabled: boolean): void {
  show = enabled
}

export function prepareAttackerCues(bot: Player, assets: ClientAssets): LungeTrail | undefined {
  const abilities = bot.abilities()
  // ESlot_Weapon_Melee from ECitadelAbilitySlots.
  const melee = abilities.find(a => a.slot === 22)
  if (!melee) return
  // A Hyperline client owns stock abilities. Waiting for a private replacement
  // here would silently prevent the default (effects-off) opponent from punching.
  if (assets === 'stock') return { weapon: melee.entity }
  const sprint = abilities.find(a => a.name === innateSprint || a.name === quiet + innateSprint)
  if (sprint && !selectCues(bot, sprint)) return
  const weapon = selectCues(bot, melee)
  if (weapon) return { weapon }
}

function selectCues(bot: Player, ability: Ability): number | undefined {
  const stock = ability.name.startsWith(quiet) ? ability.name.slice(quiet.length) : ability.name
  const wanted = show ? stock : quiet + stock
  if (wanted === ability.name) return ability.entity
  if (!bot.replaceAbility(ability.slot, wanted, true)) {
    log('Parry Trainer: could not select opponent ability ' + wanted)
    return
  }
  // replaceAbility creates a fresh entity handle.
  return bot.abilities().find(a => a.slot === ability.slot)?.entity
}

export function drawLungeDust(trail: LungeTrail | undefined, feet: Vector): void {
  if (!trail) return
  const state = show && readField(trail.weapon, 'CCitadel_Ability_HoldMelee', 'm_eCurrentAttackState', 'uint32')
  // EMeleeHold_AttackState: ground dash, air dash, slide dash.
  if (state !== 2 && state !== 3 && state !== 5) {
    if (trail.cloud) {
      trail.cloud.remove()
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
  const cloud = createParticle({ resource: lungeDust, position })
  if (!cloud) return
  trail.cloud = cloud
  // Also clean up if the opponent leaves or dies in the middle of a dash.
  after(0.8, () => {
    if (trail.cloud === cloud) {
      cloud.remove()
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
  sparks?: WorldObject
  orbit?: WorldObject
}
const caught = new Map<number, CaughtOpponent>()

// These states belong only to the attacking pawn. Keeping the stock weapon
// and sprint equipped preserves the engine's directional sound and hit test.
// Stock clients also choose some transient effects locally from ability VData.
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
