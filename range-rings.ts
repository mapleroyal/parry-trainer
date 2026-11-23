import { createParticle, entityPosition, fireInput, writeField, type Pawn, type Vector, type WorldObject } from 'modlock'
import { meleeRange } from './melee-range.js'

const ringNames = ['melee_range_ring.vpcf', 'melee_range_digit.vpcf'] as const
export let rangeRingResources = ringNames.map(name => 'particles/parry_trainer/' + name)
export function useRangeRingAssets(assets: 'stock' | 'private'): void {
  const directory = assets === 'stock' ? '{addon}' : 'parry_trainer'
  rangeRingResources = ringNames.map(name => 'particles/' + directory + '/' + name)
}
const blue = 0x468dffff, numBlue = 0x163968ff, amber = 0xffbe65ff
const floorZ = 1
type Ring = { object?: WorldObject; digits: WorldObject[]; radius: number; text: string }
const rings: Ring[] = Array.from({ length: 3 }, () => ({ digits: [], radius: -1, text: '' }))
let center: WorldObject | undefined
let lastX = NaN, lastY = NaN, lastYaw = NaN, selected = -2

function remove(effect: WorldObject | undefined): void {
  if (!effect) return
  const entity = effect.entity()
  if (entity !== undefined) fireInput(entity, 'DestroyImmediately')
  effect.remove()
}

function clear(ring: Ring): void {
  remove(ring.object)
  for (const d of ring.digits) remove(d)
  ring.object = undefined
  ring.digits.length = 0
  ring.radius = -1
  ring.text = ''
}

export function clearRangeRings(): void {
  for (const ring of rings) clear(ring)
  center?.remove()
  center = undefined
  lastX = lastY = lastYaw = NaN
  selected = -2
}

// The live input updates already-visible particles. Keep the same value in
// their networked spawn data for an observer entering the PTS later.
function resize(effect: WorldObject, radius: number): boolean {
  const entity = effect.entity()
  const cp = { x: radius, y: radius, z: 0 }
  return entity !== undefined && fireInput(entity, 'SetDataControlPointY', { number: radius }) &&
    writeField(entity, 'CParticleSystem', 'm_vecDataCPValue', 'vector', cp)
}

function marker(resource: string, position: Vector, color: number, frame: number, radius: number, parent: number): WorldObject | undefined {
  return createParticle({ resource, position, parent, color, tintPoint: 4,
    point: { index: 1, position: { x: frame, y: radius, z: 0 } } })
}

function glyphSize(radius: number): number { return Math.min(8, Math.max(2, radius / 5)) }

function drawDigits(ring: Ring, position: Vector, radius: number, active: boolean, yaw: number, parent: number): boolean {
  // The game's number sheet contains bare digits. Keep useful fractions at
  // melee distances, especially the 0.25 m minimum, without trailing zeroes.
  const text = String(parseFloat(meleeRange.formatUnits(radius)))
  const size = glyphSize(radius)
  const advance = size * 1.12 // Retail C_OP_MovementMaintainOffset spacing.
  const width = (text.length - (text.includes('.') ? 0.62 : 0)) * advance
  // Stock digits sit on a single ray that turns with the body as it turns.
  const radians = yaw * Math.PI / 180
  const dx = Math.cos(radians), dy = Math.sin(radians)
  let slot = 0, complete = true, offset = -width / 2
  for (const ch of text) {
    const dot = ch === '.', step = (dot ? 0.38 : 1) * advance
    const lateral = offset + step / 2
    const point = { x: position.x + radius * dx + lateral * dy,
      y: position.y + radius * dy - lateral * dx, z: floorZ + size * (dot ? 0.40 : 1.05) }
    // Each digit is one native, screen-facing atlas sprite on the arc.
    // The character and the world size select a particular glyph sprite.
    if (ring.digits[slot] && (ring.text[slot] !== ch || size !== glyphSize(ring.radius))) {
      remove(ring.digits[slot])
      delete ring.digits[slot]
    }
    if (ring.digits[slot]) ring.digits[slot].move(point)
    else {
      const glyph = marker(rangeRingResources[1], point, active ? amber : numBlue,
        dot ? 18 : 10 + Number(ch), (dot ? 0.24 : 1) * size, parent)
      if (glyph) ring.digits[slot] = glyph
      else complete = false
    }
    offset += step
    slot++
  }
  while (ring.digits.length > slot) remove(ring.digits.pop())
  ring.text = text
  return complete
}

export function drawRangeRings(pawn: Pawn, radii: readonly number[], active: number): void {
  if (selected !== active) { clearRangeRings(); selected = active }
  const { x, y } = pawn.position
  const position = { x, y, z: floorZ }
  center ??= createParticle({ resource: rangeRingResources[0], position, inactive: true })
  const parent = center?.entity()
  if (!center || parent === undefined) return
  const yaw = entityPosition(pawn.entity)?.facing.yaw ?? pawn.eyeAngles.yaw
  if (lastX !== x || lastY !== y || lastYaw !== yaw) center.move(position, { yaw, pitch: 0, roll: 0 })
  lastYaw = yaw
  lastX = x
  lastY = y
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i], radius = radii[i]
    if (i !== active && (radius === radii[active] || radii.indexOf(radius) < i)) { clear(ring); continue }
    if (radius === ring.radius && ring.object) continue
    if (ring.object && !resize(ring.object, radius)) {
      remove(ring.object)
      ring.object = undefined
    }
    if (!ring.object) ring.object = marker(rangeRingResources[0], position, i === active ? amber : blue, radius, radius, parent)
    ring.radius = drawDigits(ring, position, radius, i === active, yaw, parent) ? radius : -1
  }
}
