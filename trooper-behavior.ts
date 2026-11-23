// The stock lane ends at a fixed objective. Here the trainee is the trooper's
// destination until native AI acquires a target and takes over aim and attacks.
import { Layers, modifierState, readField, trace, vector, type Npc, type Pawn, type Vector } from 'modlock'

const runSpeed = 512 // trooper_normal runs at 512, walks at 248 and strafes at 150.

function scaleNativeStep(npc: Npc, previous: Vector | undefined, here: Vector, fraction: number, dt: number): Vector {
  if (!previous || fraction === 1) return here
  const dx = here.x - previous.x, dy = here.y - previous.y
  const distance = Math.hypot(dx, dy)
  // Preserve external displacements and map wraps; only scale ordinary ground AI steps.
  if (!distance || distance > runSpeed * dt + 2) return here
  const next = { x: previous.x + dx * fraction, y: previous.y + dy * fraction, z: here.z }
  const velocity = { x: dx * fraction / dt, y: dy * fraction / dt, z: 0 }
  return npc.move(next, undefined, velocity) ? next : here
}

export function steerActiveTrooper(npc: Npc, target: Pawn, elapsed: number, speedPercent: number, previous?: Vector): Vector | undefined {
  const state = npc.read()
  if (!state || state.health <= 0 || target.health <= 0) return
  const here = state.position
  const flags = readField(npc.entity, 'CBaseEntity', 'm_fFlags', 'uint32')
  if (typeof flags === 'number' && !(flags & 1)) return // Keep airborne and knock-up physics.
  if (modifierState(npc.entity, 'MODIFIER_STATE_IMMOBILIZED') ||
      modifierState(npc.entity, 'MODIFIER_STATE_STUNNED')) return
  const dt = Math.max(0, Math.min(elapsed, 0.06))
  if (!dt) return
  const fraction = speedPercent / 100
  const enemy = readField(npc.entity, 'CNPC_Trooper', 'm_hTargetedEnemy', 'handle')
  if ((typeof enemy === 'number' && enemy !== 0xffffffff && enemy !== 0) ||
      modifierState(target.entity, 'MODIFIER_STATE_INVISIBLE_TO_ENEMY'))
    return scaleNativeStep(npc, previous, here, fraction, dt)

  // The engine can also advance its old lane path between ticks. Continue
  // from the previous steering sample, rebasing after wraps or displacement.
  if (previous && vector.flatDistance(previous, here) > 32) return here
  const from = previous ?? here
  const dx = target.position.x - from.x, dy = target.position.y - from.y
  const distance = Math.hypot(dx, dy)
  if (distance <= 140) return scaleNativeStep(npc, previous, here, fraction, dt)
  const speed = runSpeed * fraction
  const velocity = { x: dx * speed / distance, y: dy * speed / distance, z: 0 }
  const next = { x: from.x + velocity.x * dt, y: from.y + velocity.y * dt, z: here.z }
  const chest = { x: here.x, y: here.y, z: here.z + 32 }
  const ahead = { x: next.x + 14 * dx / distance, y: next.y + 14 * dy / distance, z: chest.z }
  if (trace({ start: chest, end: ahead, layers: Layers.solid, ignore: [npc.entity] }))
    return scaleNativeStep(npc, previous, here, fraction, dt)
  // Npc.move updates the pose and running animation without teleporting the NPC.
  return npc.move(next, vector.level(vector.yawToward(from, target.position)), velocity) ? next : undefined
}
