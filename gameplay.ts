// The attackers are hidden hero pawns. Only the stock melee ability deals damage.
import {
  addBot, Buttons, fireInput, heroes, heroNamed, holdModifierState, Layers, log, modifierState, onDamage,
  onDamaged, onFrame, onKill, onMelee, onModifierEvent, onParry, onPlayerJoin, onPlayerLeave, onSpawn, onStart, onWorld, players,
  precache, readField, setRespawnDelay, writeField,
  type Angles, type Connection, type Pawn, type Player, type Vector,
} from 'modlock'
import { apply, arena, set } from 'modlock/console'
import {
  billyParticleResources, caughtInParry, clearCaughtOpponents, clearMeleeParticles, drawLungeDust, lungeDust, meleeCuesEnabled, parriedOrbit, parriedSparks,
  hasParryEffects, placeStunnedOpponent, prepareAttackerCues, recenterStunContact, setStockCueVisibility, stockCuesVisible,
  updateParriedEffects, type ClientAssets, type LungeTrail,
} from './particles'
import { approachOffset, sampleDistance } from './attack-distance'
import { meleeRange } from './melee-range.js'
import { useRangeRingAssets, rangeRingResources } from './range-rings'
import { clearRangePreview, updateRangePreview } from './range-preview'
import { session, type DeathCause, type SessionLimit } from './session'
import { ParryAttempts } from './parry-attempt'
import { stationaryDrain } from './stationary-drain'
import { clearDrainWarning, updateDrainWarning } from './drain-warning'
import { configurePracticeHero, prepareHero, refillHealth, refillMagazine, refreshSessionResources, setDeathAllowed } from './hero-practice'
import { isWaveShotTarget, moveWaves, recenterDistance, registerWaves, resetSoulStats, resolveWaveSouls, securedSouls, stopWaves, updateWaves } from './waves'

const opponentHeroes = ['random', 'random']
const defaultWaves = { troopers: false, trooperCount: 1, trooperActive: false, trooperSpeed: 50,
  camps: false, campTier: 1, campReactive: true }
export const waveSettings = { ...defaultWaves }
const defaultHitLoss = { enabled: false, limit: 3 }
export const hitLossSettings = { ...defaultHitLoss }
export const soulPenaltySettings = { hit: false, unparried: false, whiff: false }
const parry = 'citadel_ability_melee_parry'
const origin = { x: 0, y: 0, z: 8 }
const zero = { x: 0, y: 0, z: 0 }
const level: Angles = { pitch: 0, yaw: 0, roll: 0 }
const respawnSeconds = 1.5
const heavyHoldSeconds = 0.34 // stock citadel_bot_brain_melee_heavy_hold_time is 0.31.
const hiddenStates = [
  'DO_NOT_DRAW_MODEL', 'DO_NOT_DRAW_PARTICLES', 'INVISIBLE_ON_MINIMAP',
  'UNIT_STATUS_HIDDEN', 'FOOTSTEP_SOUNDS_DISABLE', 'MOVEMENT_FOLEY_SOUNDS_DISABLE',
  'TECH_UNTARGETABLE_BY_ENEMIES', 'IGNORE_BULLETS', 'IGNORE_MELEE',
]

interface OpponentCadence {
  hero: string
  nextAt: number
  wait?: { startedAt: number; roll: number }
  // A second pawn can wind up during the first pawn’s native recovery.
  reserveNeeded?: boolean
  activeSwing?: number
  stunned?: { entity: number; caughtAt: number }
}

interface Attacker {
  bot: Player
  number: number
  hero: string
  retiring: boolean
  trail: LungeTrail
  preparedCues?: boolean
  retryCuesAt?: number
  visibleCues?: boolean
  target?: number
  outcome?: 'parried' | 'hit'
  pendingSoulCost?: number
  soulsCharged?: number
  entity: number
  phase: 'parked' | 'idle' | 'charging' | 'swinging'
  facing: Angles
  cadence: OpponentCadence
  releaseAt: number
  settleAt: number
}

let trainee: Player | undefined
let traineeEntity = 0
let second = false
let free = true
let fastStamina = true
let allowDeath = false
let lethalFrame = false
let meleeDistances = { minimum: 50, maximum: 100, bias: 50 }
let meleeIntervals = { minimum: 0, maximum: 100, bias: 50 }
let now = 0
let checkBotsAt = 0
let magazineReadyBy = 0
let practiceOrigin = origin
const attackers: Attacker[] = []

export const activeTrainee = () => trainee
export const simulationTime = () => now
export function setDeathEnabled(enabled: boolean): void {
  allowDeath = enabled
  setDeathAllowed(enabled)
}

export function setFailOnDeath(enabled: boolean): void {
  session.failOnDeath = enabled
}

export function setSecondOpponent(enabled: boolean): void {
  second = enabled
  checkBotsAt = 0
}

export function setOpponentHero(index: 0 | 1, name: string): boolean {
  const choice = name === 'random' ? name : heroNamed(name)?.name
  if (!choice || (index !== 0 && index !== 1)) return false
  if (session.phase === 'running' && opponentHeroes[index] !== choice) session.rulesChanged = true
  opponentHeroes[index] = choice
  checkBotsAt = 0
  return true
}

export function setFastStamina(enabled: boolean): void {
  fastStamina = enabled
  set('citadel_rapid_stamina_regen', enabled)
}

export function setMeleeDistances(minimum: number, maximum: number, bias: number): void {
  if (minimum >= 0 && minimum <= maximum && maximum <= 100 && bias >= 0 && bias <= 100) {
    meleeDistances = { minimum, maximum, bias }
  }
}

export function setFreeParry(enabled: boolean): void {
  free = enabled
  // This is the control used by the retail Sandbox No Cooldown checkbox.
  // Use a one-tick cap and also clear a parry already cooling down. Normal
  // activation, active time, whiff recovery, and parry feedback remain native.
  set('citadel_ability_cooldown_max', enabled ? 0.01 : 0)
  if (enabled && trainee?.pawn()?.hero) trainee.refreshAbility(parry)
}

// A headless test may supply a real, human-controlled-equivalent target bot.
export function testSubject(bot: Player, spawn = origin, begin = true): void {
  stationaryDrain.reset()
  trainee = bot
  traineeEntity = 0
  practiceOrigin = spawn
  // Legacy combat probes compare the same known melee weapon on both pawns.
  opponentHeroes.fill('hero_wraith')
  if (begin) session.begin({ mode: 'none' }, now, hitLossSettings.enabled ? hitLossSettings.limit : 0)
}

function nextWindup(wait: { startedAt: number; roll: number }): number {
  const { minimum, maximum, bias } = meleeIntervals
  return wait.startedAt + meleeRange.interval(minimum, maximum, bias, wait.roll)
}

// The stock weapon remains locked for roughly 1.56 s from a Wraith windup.
// Prepare a matching pawn for a tight roll while there is still time to seat it.
// The weapon’s actual state and deadline decide which pawn gets to swing.
function updateWait(cadence: OpponentCadence): void {
  if (!cadence.wait) return
  cadence.nextAt = nextWindup(cadence.wait)
  if (cadence.nextAt - cadence.wait.startedAt < 1.8 && !cadence.reserveNeeded) {
    cadence.reserveNeeded = true
    checkBotsAt = 0
  }
}

function scheduleWindup(cadence: OpponentCadence): void {
  cadence.wait = { startedAt: now, roll: Math.random() }
  updateWait(cadence)
}

export function setMeleeIntervals(minimum: number, maximum: number, bias: number): void {
  if (meleeIntervals.minimum === minimum && meleeIntervals.maximum === maximum && meleeIntervals.bias === bias) return
  meleeIntervals = { minimum, maximum, bias }
  // Preserve elapsed time and each opponent's independent roll when editing a live wait.
  for (const cadence of new Set(attackers.map(a => a.cadence))) updateWait(cadence)
}

function parking(number: number): Vector {
  return { x: practiceOrigin.x + 6900, y: practiceOrigin.y + 200 * number, z: practiceOrigin.z }
}

function controls(bot: Player, facing: Angles, held = 0n, pressed = 0n, forward = 0): boolean {
  return bot.drive({ facing, forward, left: 0, held, pressed })
}

export function conceal(entity: number): void {
  for (const state of hiddenStates) holdModifierState(entity, 'MODIFIER_STATE_' + state)
  // Exclude other hero hulls but keep world/floor physics and outgoing melee queries.
  const field = 'm_Collision.m_collisionAttribute.m_nInteractsExclude'
  const mask = readField(entity, 'CBaseModelEntity', field, 'uint64')
  if (typeof mask === 'bigint') {
    writeField(entity, 'CBaseModelEntity', field, 'uint64', mask | Layers.hero | Layers.player)
  }
  // Traces originate without a player collision group. Remove the hero's
  // own query layers too, then refresh its native collision shape.
  writeField(entity, 'CBaseModelEntity', 'm_Collision.m_collisionAttribute.m_nInteractsAs', 'uint64', 0n)
  // FSOLID_NOT_SOLID removes this body's blocking shape from movement traces.
  const flags = readField(entity, 'CBaseModelEntity', 'm_Collision.m_usSolidFlags', 'uint8')
  if (typeof flags === 'number') {
    writeField(entity, 'CBaseModelEntity', 'm_Collision.m_usSolidFlags', 'uint8', flags | 4)
  }
  fireInput(entity, 'SetScale', { number: 1 })
  fireInput(entity, 'DisableShadow')
}

function park(attacker: Attacker): void {
  if (attacker.cadence.activeSwing === attacker.entity) attacker.cadence.activeSwing = undefined
  controls(attacker.bot, level)
  attacker.bot.teleport(parking(attacker.number), level, zero)
  attacker.phase = 'parked'
  attacker.target = undefined
}

function populate(team: number): void {
  if (now < checkBotsAt) return
  checkBotsAt = now + 0.5
  const count = second ? 2 : 1
  for (const attacker of attackers) {
    if (!attacker.retiring && (attacker.number >= count || attacker.hero !== opponentHeroes[attacker.number])) {
      // Modlock bot heroes are fixed at AddBot time. Retire this connection
      // before replacing it; a delayed leave mustn't remove its successor.
      park(attacker)
      attacker.retiring = attacker.bot.removeBot()
    }
  }
  for (let i = 0; i < count; i++) {
    const group = attackers.filter(a => a.number === i)
    if (group.some(a => a.retiring)) continue
    const existing = group[0]?.cadence
    if (group.length >= (existing?.reserveNeeded ? 2 : 1)) continue
    const hero = opponentHeroes[i]
    const cadence = existing ?? {
      hero: hero === 'random' ? heroes[Math.floor(Math.random() * heroes.length)].name : hero, nextAt: now,
    }
    const bot = addBot({
      name: 'Trainer opponent ' + (i + 1) + (group.length ? ' reserve' : ''), hero: cadence.hero,
      team: team === 2 ? 3 : 2, position: parking(i),
    })
    if (!bot) break
    attackers.push({
      bot, number: i, hero, cadence, retiring: false, entity: 0, phase: 'parked', facing: level,
      releaseAt: 0, settleAt: 0, trail: {},
    })
  }
}

function applyStockCues(attacker: Attacker, windingUp: boolean): void {
  const visible = stockCuesVisible(attacker.entity, windingUp)
  if (visible === attacker.visibleCues) return
  setStockCueVisibility(attacker.entity, visible)
  attacker.visibleCues = visible
}

function attack(attacker: Attacker, target: Pawn, assets: ClientAssets): void {
  const azimuth = Math.random() * 2 * Math.PI
  const distance = sampleDistance(meleeDistances)
  const floor = practiceOrigin.z - 8
  const elevation = Math.random() < 0.55 ? 0 : Math.random() * 2 - 1
  const offset = approachOffset(distance, azimuth, elevation, target.position.z - floor, target.velocity.z)
  const position = {
    x: target.position.x + offset.x,
    y: target.position.y + offset.y,
    z: target.position.z + offset.z,
  }
  const facing = {
    pitch: Math.atan2(offset.z, Math.hypot(offset.x, offset.y)) * 180 / Math.PI,
    yaw: Math.atan2(-offset.y, -offset.x) * 180 / Math.PI, roll: 0,
  }
  const velocity = { x: 0, y: 0, z: offset.verticalSpeed }
  // If the engine is swapping this hero, retry shortly rather than making
  // the same failed placement on every frame.
  attacker.cadence.wait = undefined
  attacker.cadence.nextAt = now + 0.2
  if (!attacker.bot.teleport(position, facing, velocity)) return
  if (assets === 'stock') applyStockCues(attacker, true)
  if (!controls(attacker.bot, facing, Buttons.melee, Buttons.melee, Math.hypot(offset.x, offset.y) > 42 ? 1 : 0)) {
    park(attacker)
    return
  }
  attacker.facing = facing
  attacker.phase = 'charging'
  attacker.target = target.entity
  attacker.outcome = undefined
  attacker.pendingSoulCost = attacker.soulsCharged = undefined
  attacker.releaseAt = now + heavyHoldSeconds
  attacker.settleAt = now + 1.45
  attacker.cadence.activeSwing = attacker.entity
  scheduleWindup(attacker.cadence)
}

function advance(attacker: Attacker, target: Pawn, assets: ClientAssets): void {
  if (attacker.retiring) return
  const pawn = attacker.bot.pawn()
  if (!pawn?.hero || pawn.health <= 0) return
  if (pawn.entity !== attacker.entity) {
    park(attacker)
    attacker.entity = pawn.entity
    attacker.preparedCues = undefined
    attacker.trail = {}
    attacker.retryCuesAt = undefined
    attacker.visibleCues = undefined
    conceal(pawn.entity)
    if (!attacker.cadence.wait) scheduleWindup(attacker.cadence)
  }
  if (assets === 'stock') {
    placeStunnedOpponent(attacker.bot, pawn, target, practiceOrigin)
    applyStockCues(attacker, attacker.phase === 'charging' || attacker.phase === 'swinging')
  }
  if (attacker.phase === 'parked' || attacker.phase === 'idle') {
    // Replacing the melee weapon on the same tick as pressing melee costs a
    // tick of movement. Equip the selected cues before the windup begins.
    if (!attacker.trail.weapon || attacker.preparedCues !== meleeCuesEnabled()) {
      if (attacker.retryCuesAt && now < attacker.retryCuesAt) return
      if (prepareAttackerCues(attacker.bot, pawn.entity, assets, attacker.trail))
        attacker.preparedCues = meleeCuesEnabled()
      else attacker.retryCuesAt = now + 1
      return
    }
    const cadence = attacker.cadence
    if (now < cadence.nextAt || cadence.activeSwing) return
    if (cadence.stunned) {
      if (now - cadence.stunned.caughtAt < 0.1 || modifierState(cadence.stunned.entity, 'MODIFIER_STATE_STUNNED')) return
      cadence.stunned = undefined
    }
    // The native stun gates both pawns. Its fading visuals belong only to the
    // pawn that was parried, so the reserve can take the next scheduled punch.
    if (assets === 'stock' && hasParryEffects(pawn.entity)) return
    const weapon = attacker.trail.weapon
    const recovery = readField(weapon, 'CCitadel_Ability_Melee_Base', 'm_flNextAttackAllowedTime', 'float32')
    if ((typeof recovery === 'number' && now < recovery) ||
        readField(weapon, 'CCitadel_Ability_HoldMelee', 'm_eCurrentAttackState', 'uint32') !== 0 ||
        modifierState(pawn.entity, 'MODIFIER_STATE_STUNNED')) return
    attack(attacker, target, assets)
    return
  }
  drawLungeDust(attacker.trail, pawn.position, pawn.entity)
  if (now >= attacker.settleAt) {
    // Stay at the native lunge endpoint, so windup, impact and parry sounds
    // decay at the correct place. This pawn remains invisible and non-solid.
    controls(attacker.bot, attacker.facing)
    attacker.phase = 'idle'
    if (attacker.cadence.activeSwing === attacker.entity) attacker.cadence.activeSwing = undefined
    return
  }
  // Keep looking at the moving opponent during windup and lunge, like turning
  // the camera while holding melee. Apply a short lead to a moving target.
  // Deadlock still handles turn limits, dash movement and the actual hit test.
  const lead = 0.06
  const dx = target.position.x + target.velocity.x * lead - pawn.position.x
  const dy = target.position.y + target.velocity.y * lead - pawn.position.y
  const dz = target.position.z + target.velocity.z * lead - pawn.position.z
  const range = Math.hypot(dx, dy)
  if (range > 2) attacker.facing.yaw = Math.atan2(dy, dx) * 180 / Math.PI
  attacker.facing.pitch = -Math.atan2(dz, Math.max(1, range)) * 180 / Math.PI
  if (now >= attacker.releaseAt) attacker.phase = 'swinging'
  controls(attacker.bot, attacker.facing, attacker.phase === 'charging' ? Buttons.melee : 0n,
           0n, range > 42 ? 1 : 0)
}

function recenter(pawn: Pawn): Pawn {
  const dx = pawn.position.x - practiceOrigin.x
  const dy = pawn.position.y - practiceOrigin.y
  if (Math.abs(dx) < recenterDistance && Math.abs(dy) < recenterDistance) return pawn
  const position = { ...practiceOrigin, z: pawn.position.z }
  if (!trainee?.teleport(position, pawn.eyeAngles, pawn.velocity)) return pawn
  moveWaves(dx, dy)
  for (const attacker of attackers) {
    if (recenterStunContact(attacker.entity, dx, dy) || attacker.phase === 'parked') continue
    const fighter = attacker.bot.pawn()
    if (fighter) attacker.bot.teleport({
      x: fighter.position.x - dx, y: fighter.position.y - dy, z: fighter.position.z,
    }, fighter.eyeAngles, fighter.velocity)
  }
  return { ...pawn, position }
}

function retireAttackers(): void {
  clearMeleeParticles()
  clearCaughtOpponents()
  for (const a of attackers) {
    if (!a.retiring) {
      park(a)
      a.retiring = a.bot.removeBot()
    }
  }
  checkBotsAt = 0
}

function clearEncounter(): void {
  stationaryDrain.reset()
  retireAttackers()
  stopWaves()
}

export function beginTraining(limit: SessionLimit): boolean {
  const pawn = trainee?.pawn()
  if (limit.mode === 'goal' && limit.souls > 0 && !waveSettings.troopers && !waveSettings.camps) return false
  if (!trainee || !pawn?.hero || pawn.health <= 0) return false
  if (!session.begin(limit, now, hitLossSettings.enabled ? hitLossSettings.limit : 0)) return false
  refreshSessionResources(trainee, pawn)
  refillMagazine(trainee)
  stationaryDrain.reset()
  resetSoulStats()
  return true
}

export function stopTraining(): void {
  session.finish('stopped', now)
  clearEncounter()
}

export function resetTraining(): void {
  clearRangePreview()
  lethalFrame = false
  session.reset()
  clearEncounter()
  resetSoulStats()
  Object.assign(waveSettings, defaultWaves)
  Object.assign(hitLossSettings, defaultHitLoss)
  Object.assign(soulPenaltySettings, { hit: false, unparried: false, whiff: false })
  opponentHeroes.fill('random')
  second = false
  traineeEntity = 0
  practiceOrigin = origin
}

function recordTraineeDeath(cause: DeathCause): void {
  // Schedule in the same clock domain as the score. Native pawn respawn
  // timestamps use a different time origin on listen and dedicated clients.
  if (session.recordDeath(cause, now + respawnSeconds) && session.failOnDeath) lethalFrame = true
}

export function startGameplay(assets: ClientAssets = 'private', lifecycle?: {
  joined(connection: Connection): void
  left(connection: Connection): void
}): void {
  useRangeRingAssets(assets)
  const waiting = new Map<number, Connection>()
  function seatTrainee(connection: Connection): void {
    trainee = connection.player
    traineeEntity = 0
    practiceOrigin = origin
    trainee.seat({ hero: 'any', team: 2 })
    lifecycle?.joined(connection)
  }
  registerWaves()
  onModifierEvent('MODIFIER_EVENT_BULLET_CREATED', event => {
    if (traineeEntity && event.caster === traineeEntity) session.bulletFired()
  })
  onModifierEvent('MODIFIER_EVENT_BULLET_HIT', event => {
    if (traineeEntity && event.caster === traineeEntity && session.phase === 'running' && isWaveShotTarget(event.target))
      session.bulletHitTarget()
  })
  onModifierEvent('MODIFIER_EVENT_BULLET_REMOVED', event => {
    if (traineeEntity && event.caster === traineeEntity) session.bulletRemoved()
  })
  const parryAttempts = new ParryAttempts(
    () => session.phase === 'running' ? session.runId : undefined,
    () => traineeEntity,
    () => soulPenaltySettings.whiff,
  )
  onStart(() => {
    precache({ resources: [lungeDust, ...billyParticleResources, parriedOrbit, parriedSparks, ...rangeRingResources] })
    setRespawnDelay(respawnSeconds)
    // The stock death HUD reads the game's scheduled deadline on the dead pawn.
    set('citadel_player_spawn_time_max_respawn_time', respawnSeconds)
    set('citadel_ability_cooldown_max', free ? 0.01 : 0)
    set('citadel_rapid_stamina_regen', fastStamina)
    apply({ ...arena, citadel_allow_duplicate_heroes: true, citadel_bot_test_mode: true,
      citadel_bot_brain_disable_movement: true, citadel_bot_brain_disable_attacks: true })
    configurePracticeHero()
  })
  onWorld(() => {
    clearDrainWarning()
    clearRangePreview()
    clearMeleeParticles()
    clearCaughtOpponents()
    // A map change removes the bots; a mod reload can leave old ones behind.
    for (const c of players()) {
      if (c.bot && /^Trainer opponent [12]( reserve)?$/.test(c.name)) c.player.removeBot()
    }
    attackers.length = 0
    session.setBulletOwner(0)
    traineeEntity = 0
    checkBotsAt = 0
  })
  onPlayerJoin(({ connection }) => {
    if (connection.bot) return
    if (assets === 'stock' && trainee) {
      waiting.set(connection.player.slot, connection)
      connection.player.spectate()
      connection.player.chat('This is a solo trainer. You can watch, or start your own lobby to practice.')
      return
    }
    seatTrainee(connection)
  })
  if (assets === 'stock') onSpawn(player => {
    if (waiting.has(player.slot)) player.spectate()
  })
  onPlayerLeave(({ connection, disconnected }) => {
    const player = connection.player
    waiting.delete(player.slot)
    if (trainee?.slot === player.slot) {
      lifecycle?.left(connection)
      clearDrainWarning()
      trainee = undefined
      resetTraining()
      // A mod unload also emits leaves; only a real disconnect frees the seat.
      const next = disconnected && waiting.values().next().value
      if (next) {
        waiting.delete(next.player.slot)
        seatTrainee(next)
      }
    } else {
      const i = attackers.findIndex(a => a.bot.slot === player.slot)
      if (i >= 0) {
        const [a] = attackers.splice(i, 1)
        if (a.cadence.activeSwing === a.entity) a.cadence.activeSwing = undefined
      }
    }
  })
  onParry(result => {
    const a = attackers.find(a => a.entity === result.attacker)
    if (session.phase !== 'running' || !a || a.target !== result.parrier || a.outcome === 'parried') return
    // Native melee contact and parry notifications can arrive in either order.
    if (a.outcome === 'hit') session.hits--
    a.pendingSoulCost = undefined
    if (a.soulsCharged) session.soulsDeducted -= a.soulsCharged
    a.outcome = 'parried'
    a.cadence.stunned = { entity: result.attacker, caughtAt: now }
    caughtInParry(result.attacker, now)
    if (assets === 'stock') {
      a.cadence.reserveNeeded = true
      checkBotsAt = 0
      const attacker = a.bot.pawn(), defender = trainee?.pawn()
      if (attacker && defender) placeStunnedOpponent(a.bot, attacker, defender, practiceOrigin)
      applyStockCues(a, false)
    }
    session.parries++
  })
  onDamage(hit => {
    if (traineeEntity && hit.victim === traineeEntity && session.phase !== 'running') return { block: true }
    // A hidden sparring partner can overlap a camp during its lunge. Only the
    // trainee takes that melee, so it cannot kill a creep or provoke the camp.
    const damagesOther = hit.victim !== traineeEntity && hit.attacker !== 0
    if (attackers.some(a => a.entity === hit.victim || (damagesOther && a.entity === hit.attacker))) return { block: true }
  })
  onDamaged(hit => {
    if (session.phase === 'running' && traineeEntity && hit.victim === traineeEntity)
      session.damageTaken += Math.max(0, Math.min(hit.healthBefore, hit.healthLost))
  })
  onKill(event => {
    if (session.phase !== 'running' || !traineeEntity || event.victim !== traineeEntity) return
    recordTraineeDeath('other')
  })
  // Let the completed swing finish its native follow-through, then stop driving.
  onMelee(swing => {
    const a = attackers.find(a => a.entity === swing.attacker)
    if (!a) return
    if (a.cadence.activeSwing === a.entity) a.cadence.activeSwing = undefined
    if (session.phase === 'running' && swing.heavy && a.target !== undefined) {
      session.heavy++
      if (!a.outcome && swing.hits.includes(a.target)) {
        a.outcome = 'hit'
        session.hits++
      }
      if (a.outcome !== 'parried')
        a.pendingSoulCost = Number(soulPenaltySettings.unparried) + Number(soulPenaltySettings.hit && a.outcome === 'hit')
    }
    if (!swing.heavy) log('Parry Trainer: unexpected light swing observed')
    // At short intervals, hand control back once the completed swing has
    // registered so its cosmetic follow-through cannot postpone the next windup.
    a.settleAt = Math.min(a.settleAt, now + 0.15)
  })
  onFrame(frame => {
    now = frame.timeSeconds
    const wasRunning = session.phase === 'running'
    const pawn = trainee?.pawn()
    updateRangePreview(pawn, now)
    const emptyParries = parryAttempts.update(pawn)
    if (wasRunning) {
      resolveWaveSouls(now)
      const collected = securedSouls()
      if (emptyParries) session.deductSouls(collected, emptyParries)
      // Native swing and parry callbacks can arrive in either order. Settle
      // the completed swings and pickups together before checking a soul goal.
      for (const attacker of attackers) {
        if (attacker.pendingSoulCost) attacker.soulsCharged = session.deductSouls(collected, attacker.pendingSoulCost)
        attacker.pendingSoulCost = undefined
      }
    }
    // Charge stillness before recentering. The native kill notification may arrive
    // on the next tick, so settle a lethal drain against this tick's finish targets.
    let drainKilled = false
    let drained = 0
    if (wasRunning && !lethalFrame && !session.settlingHit && trainee && pawn?.hero && pawn.entity === traineeEntity && pawn.health > 0) {
      drained = stationaryDrain.tick(trainee, pawn, now, parryAttempts.guard)
      session.damageTaken += drained
      drainKilled = drained === pawn.health
      // The native kill arrives next frame, after this life has left scored play.
      if (drainKilled) recordTraineeDeath('standing-drain')
    }
    updateDrainWarning(trainee, now, drained > 0)
    if (session.phase === 'countdown' && session.remaining(now) === 0 && trainee && pawn?.hero && pawn.health > 0) {
      if (refillMagazine(trainee) === false) {
        // A tube-fed gun may need a native reload step to reveal its capacity.
        if (!magazineReadyBy) magazineReadyBy = now + 0.75
        if (now < magazineReadyBy) return
        prepareHero(trainee)
      }
      // Countdown movement, casts and shopping can spend resources or raise their maximum.
      refreshSessionResources(trainee, pawn)
    }
    magazineReadyBy = 0
    session.tick(now, securedSouls(), lethalFrame)
    lethalFrame = false
    if (wasRunning && session.phase === 'finished') {
      clearEncounter()
      return
    }
    if (session.settlingHit) return
    updateParriedEffects(now, assets)
    if (!trainee) return
    if (drainKilled || !pawn?.hero || pawn.health <= 0) {
      if (traineeEntity) {
        stationaryDrain.reset()
        session.setBulletOwner(0)
        retireAttackers()
      }
      traineeEntity = 0
      if (session.phase === 'running') updateWaves(trainee, now, waveSettings)
      return
    }
    if (pawn.entity !== traineeEntity) {
      session.recordRespawn()
      stationaryDrain.reset()
      if (!trainee.teleport(practiceOrigin, pawn.eyeAngles, zero)) return
      traineeEntity = pawn.entity
      session.setBulletOwner(pawn.entity)
      // Native respawns can return a partially filled bar, including on builds with bonus health.
      refillHealth(trainee, pawn)
      prepareHero(trainee)
      return
    }
    const target = recenter(pawn)
    if (session.phase !== 'running') return
    if (!allowDeath && !stationaryDrain.enabled && target.health < target.maxHealth / 2)
      trainee.heal(target.maxHealth - target.health)
    updateWaves(trainee, now, waveSettings)
    populate(target.team)
    for (const a of attackers) advance(a, target, assets)
  })
}
