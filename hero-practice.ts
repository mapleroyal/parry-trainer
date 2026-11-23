// The Hideout uses these variables for its shop and the Sandbox "No death" checkbox.
import { readField, sequence, writeField, type Pawn, type Player, type Timer } from 'modlock'
import { apply, run, set } from 'modlock/console'

const primary = 'CCitadel_Ability_PrimaryWeapon'
let seat: { slot: number; generation: number } | undefined
let refill: Timer | undefined

export function configurePracticeHero(): void {
  apply({ buddha: true, citadel_hero_testing_enabled: true, citadel_hero_testing_infinite_money: true })
}

export function setDeathAllowed(allowed: boolean): void {
  set('buddha', !allowed)
}

export function refillHealth(player: Player, pawn: Pawn): void {
  const maximum = pawn.effectiveMaxHealth ?? pawn.maxHealth
  if (pawn.health < maximum) player.heal(maximum - pawn.health)
}

export function refreshSessionResources(player: Player, pawn: Pawn): void {
  refillHealth(player, pawn)
  // Refresher uses each signature ability's native charge cap. Its stamina grant
  // briefly exceeds the equipped maximum until the next tick, so normalize it now.
  player.giveModifier('citadel_hero_refresh', 0.03)
  player.restoreStamina()
  // Active items and utility abilities keep independent timers.
  for (const ability of player.abilities()) {
    if (ability.cooldownEnd > 0 || ability.rechargeEnd > 0)
      player.setAbility({ ability: ability.name, cooldownEnd: 0, rechargeEnd: 0 })
  }
}

export function prepareHero(player: Player): void {
  const pawn = player.pawn()
  if (!pawn?.hero || pawn.health <= 0) return
  if (seat?.slot !== player.slot || seat.generation !== pawn.generation) {
    seat = { slot: player.slot, generation: pawn.generation }
    run('citadel_unlock_flex_slots', String(pawn.team))
  }
  // Keep B in purchase mode everywhere, including after wrapping the arena.
  writeField(pawn.entity, 'CCitadelPlayerPawn', 'm_bInItemShopZone', 'bool', true)
  refill?.cancel()
  refill = sequence(attempt => {
    if (player.pawn()?.entity !== pawn.entity) return
    if (!refillMagazine(player) && attempt < 24) return 0.03
  })
}

// False means an empty magazine is waiting for its first native reload step.
// An unavailable weapon can still appear on a later frame during spawn.
export function refillMagazine(player: Player): boolean | undefined {
  const gun = player.abilities().find(a => a.slot === 21)?.entity
  if (!gun) return
  const clip = readField(gun, primary, 'm_iClip', 'int32')
  const fraction = readField(gun, primary, 'm_flAmmoFrac', 'float32')
  if (typeof clip !== 'number' || typeof fraction !== 'number') return
  if (clip < 0 || (clip > 0 && fraction >= 1 && !readField(gun, primary, 'm_bInReload', 'bool'))) return true
  writeField(gun, primary, 'm_flNextPrimaryAttack', 'float32', 0)
  writeField(gun, primary, 'm_flNextAttackDelayEndTime', 'float32', 0)
  if (clip > 0 && fraction > 0) {
    // A loaded round exposes the actual capacity, including item bonuses.
    if (fraction < 1) writeField(gun, primary, 'm_iClip', 'int32', Math.round(clip / fraction))
    writeField(gun, primary, 'm_bInReload', 'bool', false)
    return true
  }
  writeField(gun, primary, 'm_bInReload', 'bool', true)
  return false
}
