// The game owns NPC health, damage, bounties and shootable souls. A slot stays
// occupied from spawn through the resolution of the soul earned by that kill.
import {
  entityClass, entityPosition, findEntities, fireInput, ground, holdModifierState, moveEntity, onKill, onMelee,
  onModifierEvent, onStart, readField, spawnNpc, vector, writeField,
  type Npc, type Pawn, type Player, type Vector,
} from 'modlock'
import { set } from 'modlock/console'
import { NeutralCamp } from './camp-spawner'
import { steerActiveTrooper } from './trooper-behavior'

export interface WaveSettings {
  troopers: boolean
  trooperCount: number
  trooperActive: boolean
  trooperSpeed: number
  camps: boolean
  campTier: number
  campReactive: boolean
}
type Source = 'troopers' | 'camps'
interface WaveUnit {
  npc: Npc
  source: Source
  stationary?: boolean
  // Some neutral return-to-camp schedules can move even an immobilized NPC.
  station?: Vector
  lastApproach?: Vector
  death?: { position: Vector, time: number, credited: boolean }
  meleeAt?: number
  retiredAt?: number
  orb?: number
  deadline: number
}

const meters = 39.37007874
const units: WaveUnit[] = []
const stats = { troopers: { kills: 0, secured: 0, missed: 0 }, camps: { kills: 0, secured: 0, missed: 0 } }
let owner = -1, clock = 0, tier = 0, nextSpawn = 0
const claims: number[] = []
interface OrbPlacement { position: Vector, launch: number, deadline: number }
const orbHits = new Map<number, { time: number, placement?: OrbPlacement }>()
let lastBehaviorTick = 0
let camp: NeutralCamp | undefined

function captureCamp(killed?: number): void {
  if (camp?.pending) for (const npc of camp.newMembers(killed)) units.push({ npc, source: 'camps', deadline: 0 })
}

function setStationary(unit: WaveUnit, stationary: boolean): void {
  if (unit.stationary === stationary) {
    if (unit.station) {
      const at = entityPosition(unit.npc.entity)?.position
      const home = unit.station
      if (at && Math.hypot(at.x - home.x, at.y - home.y, at.z - home.z) > 0.25)
        moveEntity(unit.npc.entity, home, undefined, { x: 0, y: 0, z: 0 })
    }
    return
  }
  // Restrict only this unit. The global trooper-force-idle variable also mutes camp AI.
  if (stationary || unit.stationary) {
    for (const state of ['IMMOBILIZED', 'DISARMED', 'SILENCED'])
      holdModifierState(unit.npc.entity, 'MODIFIER_STATE_' + state, stationary)
  }
  unit.station = stationary && unit.source === 'camps' ? entityPosition(unit.npc.entity)?.position : undefined
  unit.stationary = stationary
  unit.lastApproach = undefined
}

export function soulStats() { return stats }
export function securedSouls(): number { return stats.troopers.secured + stats.camps.secured }
export function resetSoulStats(): void {
  for (const tally of [stats.troopers, stats.camps]) tally.kills = tally.secured = tally.missed = 0
}

function release(unit: WaveUnit): void {
  const index = units.indexOf(unit)
  if (index < 0) return
  units.splice(index, 1)
  if (unit.orb) {
    orbHits.delete(unit.orb)
    fireInput(unit.orb, 'Kill')
  }
  // Camp members were created by the native camp, outside Modlock's spawn ownership.
  if (unit.source === 'camps') {
    if (entityPosition(unit.npc.entity)) fireInput(unit.npc.entity, 'Kill')
  } else unit.npc.remove()
}

function bindPendingSouls(candidates: WaveUnit[]): void {
  // Combat can already have produced a soul even though Modlock delivers the
  // kill callback on the next tick. Carry or clear even those fresh bounties.
  for (const unit of candidates) {
    if (unit.death) continue
    if (readField(unit.npc.entity, 'CBaseEntity', 'm_lifeState', 'uint8') !== 0) {
      const position = entityPosition(unit.npc.entity)?.position
      if (position) unit.death = { position, time: clock, credited: false }
    }
  }
  matchOrbs()
}

function cancel(disabled: WaveUnit[]): void {
  if (!disabled.length) return
  bindPendingSouls(disabled)
  for (const unit of disabled) release(unit)
}

function clearCamp(): void {
  captureCamp()
  cancel(units.filter(u => u.source === 'camps'))
  camp?.remove()
  camp = undefined
}

export function stopWaves(): void {
  clearCamp()
  lastBehaviorTick = 0
  cancel(units.slice())
  owner = -1
  claims.length = 0
  orbHits.clear()
  tier = 0
  nextSpawn = 0
}

// The player returns to the origin at this distance. Keep the closest copy of
// each wave inside the same square, leaving floor around it for the formation.
export const recenterDistance = 4096
function waveOffset(anchor: Vector, dx: number, dy: number): Vector {
  const width = 2 * recenterDistance
  return { x: -dx - width * Math.round((anchor.x - dx) / width),
    y: -dy - width * Math.round((anchor.y - dy) / width), z: 0 }
}

export function moveWaves(dx: number, dy: number): void {
  captureCamp()
  bindPendingSouls(units)
  const center = camp?.center
  const campOffset = center && waveOffset(center, dx, dy)
  if (campOffset) camp?.move(campOffset)
  for (const unit of units) {
    const npc = unit.death ? undefined : unit.npc.read()
    const anchor = unit.death?.position ?? npc?.position
    if (!anchor) continue
    const offset = unit.source === 'camps' && campOffset ? campOffset : waveOffset(anchor, dx, dy)
    if (unit.station) unit.station = vector.add(unit.station, offset)
    if (unit.lastApproach) unit.lastApproach = vector.add(unit.lastApproach, offset)
    if (unit.death) unit.death.position = vector.add(unit.death.position, offset)
    else if (npc) {
      unit.npc.move(vector.add(npc.position, offset), npc.facing)
      if (unit.source === 'camps') {
        const home = readField(unit.npc.entity, 'CNPC_TrooperNeutral', 'm_vecSpawnOrigin', 'vector')
        if (home && typeof home === 'object')
          writeField(unit.npc.entity, 'CNPC_TrooperNeutral', 'm_vecSpawnOrigin', 'vector', vector.add(home, offset))
      }
    }
    const orb = unit.orb && entityPosition(unit.orb)
    if (orb && unit.orb) moveEntity(unit.orb, vector.add(orb.position, offset), orb.facing, orb.velocity)
  }
}

export function registerWaves(): void {
  onStart(() => {
    set('citadel_trooper_force_idle', false)
    // The retail default pays jungle kills entirely at death. Route half of the
    // same bounty into the game's normal shootable orb for the securing drill.
    set('citadel_neutral_gold_ratio', 0.5)
  })
  onKill(event => {
    captureCamp(event.victim)
    const unit = units.find(u => u.npc.entity === event.victim)
    if (!unit) return
    const credited = event.attackerPlayer.slot === owner
    if (credited && !unit.death?.credited) stats[unit.source].kills++
    if (unit.death) { unit.death.credited ||= credited; return }
    const position = entityPosition(event.victim)?.position
    if (!position) { release(unit); return }
    unit.death = { position, time: clock, credited }
    // An entire shootable lifetime can pass between frame callbacks. Capture
    // the launch while processing the native death, including simultaneous kills.
    bindPendingSouls(units)
  })
  onMelee(event => {
    if (event.attackerPlayer.slot !== owner) return
    for (const unit of units) {
      if (event.hits.includes(unit.npc.entity)) unit.meleeAt = clock
    }
    for (const target of event.hits) recordOrbHit(target)
  })
  // OrbClaimed reports the shooter but omits the orb's handle in this build.
  // BulletHit supplies that handle, also when two different bounties settle together.
  for (const name of ['MODIFIER_EVENT_BULLET_HIT', 'MODIFIER_EVENT_ABILITY_AS_BULLET_HIT']) {
    onModifierEvent(name, event => {
      if (owner < 0 || event.player.slot !== owner || !event.target) return
      recordOrbHit(event.target)
    })
  }
  onModifierEvent('MODIFIER_EVENT_ORB_CLAIMED', event => {
    if (units.length && owner >= 0 && event.player.slot === owner) claims.push(clock)
  })
}

export function isWaveShotTarget(target: number): boolean {
  if (!target || !units.length) return false
  // An orb can be claimed and removed on its hit frame, or hit before a wave
  // slot binds the new orb. Check the recorded handles before the live entity.
  return units.some(u => u.npc.entity === target || u.orb === target) ||
    orbHits.has(target) || entityClass(target)?.designerName === 'item_xp'
}

function recordOrbHit(target: number): void {
  if (owner < 0 || !units.length) return
  if (units.some(u => u.orb === target)) orbHits.set(target, { time: clock })
  else if (entityClass(target)?.designerName === 'item_xp') {
    // Preserve this hit's launch data even if the entity is removed before its kill is delivered.
    const placement = orbHits.get(target)?.placement ?? readOrbPlacement(target)
    orbHits.set(target, { time: clock, placement })
  }
}

function spawnTrooper(target: Pawn, stationary: boolean): void {
  const floor = ground(spawnCenter(target), { above: 128, below: 32768 })
  if (!floor) return
  const yaw = Math.atan2(target.position.y - floor.y, target.position.x - floor.x) * 180 / Math.PI
  const npc = spawnNpc({ className: 'npc_trooper', unit: 'trooper_normal', lane: 1, team: target.team === 2 ? 3 : 2,
    position: { ...floor, z: floor.z + 4 }, facing: { pitch: 0, yaw, roll: 0 } })
  if (npc) {
    const unit: WaveUnit = { npc, source: 'troopers', deadline: 0 }
    setStationary(unit, stationary)
    units.push(unit)
  }
}

function spawnCenter(target: Pawn): Vector {
  // In an empty arena there are no landmarks to help find a wave behind you.
  const angle = (target.eyeAngles.yaw + (Math.random() * 2 - 1) * 55) * Math.PI / 180
  const radius = (20 + Math.random() * 30) * meters
  return { x: target.position.x + Math.cos(angle) * radius,
    y: target.position.y + Math.sin(angle) * radius, z: target.position.z }
}

function readOrbPlacement(orb: number): OrbPlacement | undefined {
  const launch = readField(orb, 'CItemXP', 'm_timeLaunch', 'float32')
  const position = entityPosition(orb)?.position
  if (position && typeof launch === 'number') return { position, launch,
    deadline: Number(readField(orb, 'CItemXP', 'm_flEndAttackableTime', 'float32') ?? clock) }
}

function matchOrbs(): void {
  const pending = units.filter(u => u.death && !u.orb)
  if (!pending.length) return
  const paired = new Set(units.map(u => u.orb))
  const available = new Map<number, OrbPlacement>()
  for (const [orb, hit] of orbHits)
    if (hit.placement && !paired.has(orb)) available.set(orb, hit.placement)
  for (const orb of findEntities('item_xp')) {
    if (paired.has(orb) || available.has(orb) || readField(orb, 'CBaseEntity', 'm_lifeState', 'uint8') !== 0) continue
    const placement = readOrbPlacement(orb)
    if (placement) available.set(orb, placement)
  }
  const matches: { unit: WaveUnit, orb: number, distance: number, deadline: number }[] = []
  for (const [orb, { position, launch, deadline }] of available) {
    for (const unit of pending) {
      const death = unit.death!
      if (launch < death.time - 0.08 || launch > death.time + 0.7) continue
      const distance = vector.flatDistance(position, death.position)
      if (distance <= 160) matches.push({ unit, orb, distance, deadline })
    }
  }
  // Pair simultaneous kills closest first. A soul can belong to exactly one slot.
  matches.sort((a, b) => a.distance - b.distance)
  for (const { unit, orb, deadline } of matches) {
    if (unit.orb || paired.has(orb)) continue
    unit.orb = orb
    unit.deadline = deadline
    paired.add(orb)
  }
}

function takeClaim(unit: WaveUnit): boolean {
  // Both callbacks can arrive before the next frame updates the simulation clock.
  const index = claims.findIndex(at => at >= unit.death!.time - 0.08)
  if (index < 0) return false
  claims.splice(index, 1)
  return true
}

function settleSouls(): void {
  if (!units.length) {
    claims.length = 0
    orbHits.clear()
    return
  }
  if (!claims.length && !orbHits.size && !units.some(unit => unit.death)) return
  matchOrbs()
  // A melee kill pays immediately without launching an orb.
  for (const unit of units.slice()) {
    if (!unit.orb && unit.death?.credited && unit.meleeAt !== undefined &&
        Math.abs(unit.meleeAt - unit.death.time) < 0.08 && takeClaim(unit)) {
      stats[unit.source].secured++
      release(unit)
    }
  }
  const resolved = units.filter(unit => unit.orb &&
    readField(unit.orb, 'CBaseEntity', 'm_lifeState', 'uint8') !== 0)
  const retiredOrbs = new Set(resolved.map(unit => unit.orb))
  const waitingHits = [...orbHits.keys()].filter(orb => !retiredOrbs.has(orb)).length
  resolved.sort((a, b) => (orbHits.get(b.orb!)?.time ?? -1) - (orbHits.get(a.orb!)?.time ?? -1) || b.deadline - a.deadline)
  for (const unit of resolved) {
    const orb = unit.orb!
    unit.retiredAt ??= clock
    // The claim and the spent entity need not arrive in the same poll. Give
    // unconfirmed retirements a few ticks before charging a miss.
    const confirmedHit = orbHits.has(orb)
    const gracePassed = clock - unit.retiredAt >= 0.1
    if ((confirmedHit || (gracePassed && claims.length > waitingHits)) && takeClaim(unit))
      stats[unit.source].secured++
    else if (gracePassed) stats[unit.source].missed++
    else continue
    orbHits.delete(orb)
    unit.orb = undefined
    release(unit)
  }
  // If both the victim's orb and its hit target had already been removed,
  // a native claim can still settle the only outstanding credited kill.
  const candidates = units.filter(unit => unit.orb || unit.death?.credited)
  for (const unit of units.slice()) {
    if (!unit.death || unit.orb || clock - unit.death.time < 0.75) continue
    if (candidates.length === 1 && candidates[0] === unit && takeClaim(unit))
      stats[unit.source].secured++
    release(unit)
  }
  while (claims.length && clock - claims[0] > 0.75) claims.shift()
  for (const [orb, hit] of orbHits)
    if (clock - hit.time > 0.75 && !units.some(unit => unit.orb === orb)) orbHits.delete(orb)
}

// Resolve the previous tick's combat before checking the run's finish condition.
export function resolveWaveSouls(now: number): void {
  clock = now
  captureCamp()
  settleSouls()
}

export function updateWaves(player: Player, now: number, config: WaveSettings): void {
  owner = player.slot
  clock = now
  const elapsed = now - lastBehaviorTick
  lastBehaviorTick = now
  captureCamp()
  if (camp && (!config.camps || tier !== config.campTier || (camp.pending && now >= camp.deadline)))
    clearCamp()
  tier = config.campTier
  const limit = config.troopers ? config.trooperCount : 0
  const lanes = units.filter(u => u.source === 'troopers')
  cancel(lanes.slice(limit))
  if (!limit && !config.camps) return
  const pawn = player.pawn()
  for (const unit of units) {
    if (unit.death) continue
    const lane = unit.source === 'troopers'
    setStationary(unit, !(lane ? config.trooperActive : config.campReactive))
    if (lane && config.trooperActive && pawn?.hero && pawn.health > 0)
      unit.lastApproach = steerActiveTrooper(unit.npc, pawn, elapsed, config.trooperSpeed, unit.lastApproach)
  }
  if (now < nextSpawn || !pawn?.hero || pawn.health <= 0) return
  nextSpawn = now + 0.15
  for (let slot = lanes.length; slot < limit; slot++) spawnTrooper(pawn, !config.trooperActive)
  if (config.camps && !camp?.pending && !units.some(u => u.source === 'camps')) {
    camp?.remove()
    camp = NeutralCamp.spawn(spawnCenter(pawn), tier, now)
  }
}
