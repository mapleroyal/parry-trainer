import type { Pawn } from 'modlock'
import { session } from './session'
import { meleeRange } from './melee-range.js'
import { clearRangeRings, drawRangeRings } from './range-rings'

const handles = ['min', 'favored', 'max']
let preview: { active: number; radii: number[]; expires: number } | undefined

export function clearRangePreview(): void {
  if (!preview) return
  preview = undefined
  clearRangeRings()
}

export function setRangePreview(args: string, now: number): void {
  if (args === 'off') { clearRangePreview(); return }
  const match = /^(inspect|min|favored|max) (\d{1,3}) (\d{1,3}) (\d{1,3})$/.exec(args)
  if (!match || (match[1] === 'inspect' && sessionActive())) return
  const minimum = Number(match[2]), maximum = Number(match[3]), bias = Number(match[4])
  if (maximum > 100 || minimum > maximum || bias > 100) return
  const favored = meleeRange.favored(minimum, maximum, bias)
  // A held gesture refreshes this deadline even while the pointer is still.
  // If the HUD disappears without sending a release, the rings clear themselves.
  preview = { active: handles.indexOf(match[1]), expires: now + 1.5,
    radii: [meleeRange.units(minimum), meleeRange.units(favored), meleeRange.units(maximum)] }
}

function sessionActive(): boolean {
  return session.phase === 'running' || session.phase === 'countdown'
}

export function updateRangePreview(pawn: Pawn | undefined, now: number): void {
  if (!preview) return
  if (now >= preview.expires || !pawn?.hero || pawn.health <= 0 || (preview.active < 0 && sessionActive())) { clearRangePreview(); return }
  drawRangeRings(pawn, preview.radii, preview.active)
}
