// Reserve unused retail weapon records for bots. The caster remains the chosen
// hero. A future, unaudited weapon keeps its native attacks and cues.
import variants from './quiet-melee.json'

const quietByWeapon = new Map<string, string>()
for (const variant of variants) {
  for (const weapon of variant.weapons) quietByWeapon.set(weapon, variant.entry)
}

export function quietMeleeFor(stock: string): string | undefined {
  return quietByWeapon.get(stock)
}

// Billy alone has different native ground and air slowdown curves with no
// equivalent unused record. Both cue settings must keep this stock weapon.
export const billyMelee = 'ability_melee_punkgoat'
export const billyMeleeEffects = {
  attachment: 'melee_fx',
  charge: 'particles/abilities/melee/melee_heavy_activate_charge.vpcf',
  attack: 'particles/abilities/melee/melee_heavy_activate.vpcf',
  groundSwing: 'particles/abilities/melee_swing_heavy.vpcf',
}
