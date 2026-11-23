import { meleeRange } from './melee-range.js'

// Distances are percentages of the usable melee reach. Bias is a percentage of
// the chosen interval, so it keeps its relative position when a bound moves.
interface MeleeDistances { minimum: number; maximum: number; bias: number }

export function sampleDistance({ minimum, maximum, bias }: MeleeDistances, random = Math.random): number {
  if (minimum === maximum) return meleeRange.units(minimum)
  return meleeRange.units(meleeRange.samplePercent(minimum, maximum, bias, random()))
}

export function approachOffset(distance: number, azimuth: number, elevation: number,
                               heightAboveFloor: number, targetVerticalSpeed = 0) {
  // Airborne windups lose forward travel. At long range, use a grounded
  // attacker or approach a descending trainee from below. An ascending
  // trainee can instead be intercepted by a descending opponent from above.
  const height = Math.max(0, heightAboveFloor)
  const maxHeight = Math.min(88, distance * 0.97, Math.sqrt(distance * distance - 64))
  let z = Math.max(-height, elevation * maxHeight)
  let verticalSpeed = targetVerticalSpeed
  if (distance > 458) {
    if (height > 1 && targetVerticalSpeed > 0) {
      z = distance * 0.8
      // The native dash damps existing vertical speed during its windup.
      verticalSpeed = targetVerticalSpeed - 900
    } else z = height < 1 ? 0 : -Math.min(height, distance * 0.8)
  }
  if (height + z < 4) verticalSpeed = 0
  const horizontal = Math.sqrt(distance * distance - z * z)

  // Native hit tests reach a little farther against a corner of the trainee's
  // hull. All headings hit through 521 units. Gradually narrow each quadrant
  // to its diagonal over the last 8.4 units while keeping the rolled distance.
  const allHeadings = 521
  if (distance > allHeadings) {
    const diagonal = (Math.floor(azimuth / (Math.PI / 2)) + 0.5) * Math.PI / 2
    azimuth += (diagonal - azimuth) * (distance - allHeadings) / (meleeRange.farthest - allHeadings)
  }
  return { x: horizontal * Math.cos(azimuth), y: horizontal * Math.sin(azimuth), z, verticalSpeed }
}
