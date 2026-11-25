// Check stock gunfire at spawn, while strafing, and across the horizontal arena and its floor.
import { addBot, Buttons, createModel, Layers, log, onDamage, onFrame, onModifierEvent, onStart, precache,
  serverCommand, trace, vector, writeField, type Player, type Vector, type WorldObject } from 'modlock'

const crate = 'models/props_gameplay/wooden_crate_01.vmdl'
const bulletSpeed = 22500 // Wraith's stock primary, Source units per second.
const bearings = [0, 45, 90, 135, 180, 225, 270, 315]
type Stage = 'air' | 'up' | 'near' | 'far' | 'shallow' | 'steep'

export default function register(): void {
  let shooter: Player | undefined, witness: WorldObject | undefined
  let start = -1, ready = -1, now = 0, quitAt = -1, done = false
  let stage: Stage = 'air', airShots = 0, airTravel = 0
  let fired = -1, removed = -1, hitEntity = false, hitWitness = false
  let aimPoint: Vector | undefined, expectedFloorFlight = 0, shallowFlight = 0, attempts = 0
  function finish(ok: boolean, detail: string): void {
    done = true
    log('PARRY TRAINER PROBE ' + (ok ? 'PASS' : 'FAIL'), 'open-arena', detail)
  }
  function arm(): void {
    fired = removed = -1
    hitEntity = hitWitness = false
    ready = now + 0.25
  }
  onStart(() => precache({ resources: [crate], heroes: ['hero_wraith'] }))
  for (const kind of ['CREATED', 'HIT', 'REMOVED']) onModifierEvent('MODIFIER_EVENT_BULLET_' + kind, e => {
    if (done || e.caster !== shooter?.pawn()?.entity) return
    if (kind === 'CREATED' && fired < 0) fired = now
    if (kind === 'HIT' && e.target) hitEntity = true
    if (kind === 'REMOVED' && fired >= 0 && removed < 0) removed = now
  })
  onDamage(hit => {
    if (!done && witness && hit.victim === witness.entity() && hit.attacker === shooter?.pawn()?.entity) {
      hitWitness = true
      return { block: true }
    }
  })
  onFrame(({ timeSeconds }) => {
    now = timeSeconds
    if (done) {
      if (quitAt < 0) {
        witness?.remove()
        shooter?.removeBot()
        quitAt = now + 0.4
      } else if (now >= quitAt) serverCommand('quit')
      return
    }
    if (start < 0) start = now
    if (now - start > 24) { finish(false, 'timed out at ' + stage + ', bearing ' + airShots); return }
    shooter ??= addBot({ name: 'Arena tester', team: 2, hero: 'hero_wraith' })
    const pawn = shooter?.pawn()
    if (!shooter || !pawn?.hero) return
    if (ready < 0) {
      shooter.teleport({ x: 0, y: 0, z: 3 }, vector.level(0))
      arm()
      return
    }
    if (removed >= 0) {
      const flight = removed - fired
      if (stage === 'up') {
        if (hitEntity || flight < 0.28 || flight > 0.35) { finish(false, 'upward shot obstructed'); return }
        stage = 'near'
      } else if (stage === 'air') {
        if (hitEntity || flight < 0.28 || flight > 0.35) {
          finish(false, 'short or obstructed air shot at ' + bearings[airShots] + ' degrees, flight=' + flight); return
        }
        airTravel = Math.max(airTravel, Math.hypot(pawn.position.x, pawn.position.y))
        airShots++
        if (airShots === bearings.length) {
          if (airTravel < 100) { finish(false, 'shooter did not leave spawn while firing'); return }
          stage = 'up'
        }
      } else if (stage === 'shallow' || stage === 'steep') {
        // A world impact can report a null target. Compare its flight time with
        // the ray to the floor and verify that it did not reach the buried prop.
        log(stage, 'floor at metres', (expectedFloorFlight * bulletSpeed * 0.0254).toFixed(2),
          'stock bullet flight', flight, 'seconds; buried witness hit', hitWitness)
        if (hitWitness || Math.abs(flight - expectedFloorFlight) >= 0.035) {
          finish(false, stage + ' shot failed to stop at the floor'); return
        }
        if (stage === 'steep') {
          finish(flight < shallowFlight - 0.025 && pawn.position.z >= -2 && pawn.position.z < 5,
            'eight level bearings, upward miss, strafed ' + Math.round(airTravel) + ' units; ' +
            '9 m and 112 m targets hit; downward shots stopped at shallow and steep floor intersections')
          return
        }
        shallowFlight = flight
        stage = 'steep'
      } else if (hitWitness) {
        stage = stage === 'near' ? 'far' : 'shallow'
        attempts = 0
      } else if (++attempts >= 6) {
        finish(false, 'rounds failed to reach ' + stage + ' witness'); return
      }
      aimPoint = undefined
      arm()
    }

    if (stage !== 'air' && stage !== 'up' && !aimPoint) {
      const eye = pawn.eyePosition
      if (stage === 'near') aimPoint = { x: eye.x - 360, y: eye.y, z: eye.z }
      else if (stage === 'far') aimPoint = { x: eye.x, y: eye.y + 4400, z: eye.z }
      else aimPoint = { x: eye.x + (stage === 'steep' ? eye.z + 110 : 4300), y: eye.y, z: -110 }
      const origin = { ...aimPoint, z: aimPoint.z - 64 }
      if (!witness) {
        witness = createModel({ resource: crate, position: origin, scale: 2, solid: true })
        const id = witness?.entity()
        if (!id || !writeField(id, 'CBaseEntity', 'm_bTakesDamage', 'bool', true)) {
          finish(false, 'could not prepare impact witness'); return
        }
      } else if (!witness.move(origin)) { finish(false, 'could not move impact witness'); return }
    }
    const eye = pawn.eyePosition
    const facing = aimPoint ? vector.aimAt(eye, aimPoint) :
      stage === 'up' ? { yaw: 0, pitch: -45, roll: 0 } : vector.level(bearings[airShots])
    const fire = now >= ready && fired < 0
    if (fire && (stage === 'shallow' || stage === 'steep')) {
      const hit = trace({ start: eye, end: aimPoint!, layers: Layers.solid, ignore: [pawn.entity] })
      if (!hit || Math.abs(hit.position.z) > 0.5 || hit.normal.z < 0.99) {
        finish(false, 'ray to submerged witness did not reach the flat floor'); return
      }
      expectedFloorFlight = vector.distance(eye, hit.position) / bulletSpeed
      if (stage === 'steep' ? expectedFloorFlight >= 0.01 : expectedFloorFlight < 0.045 || expectedFloorFlight > 0.15) {
        finish(false, 'unexpected eye-to-floor distance'); return
      }
    }
    const keys = fire ? Buttons.attack : 0n
    // Fire the first level shot from rest, then turn and strafe through seven
    // other headings. Stop before the measured witness and floor shots.
    shooter.drive({ facing, forward: 0, left: stage === 'air' && airShots > 0 ? 1 : 0, held: keys, pressed: keys })
  })
}
