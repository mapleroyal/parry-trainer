// The arena floor must support heroes while a real projectile can fly through it.
import { addBot, Buttons, createModel, Layers, log, onDamage, onFrame, onModifierEvent, onStart, precache,
  serverCommand, trace, vector, writeField, type Player, type WorldObject } from 'modlock'

const crate = 'models/props_gameplay/wooden_crate_01.vmdl'
const farTarget = { x: 4400, y: 0, z: 90 }
const lowTarget = { x: 650, y: 0, z: -150 }

export default function register(): void {
  let shooter: Player | undefined, target: WorldObject | undefined, targetId: number | undefined
  let since = -1, ready = -1, now = 0, done = false, stage = 0
  let fired = -1, removed = -1, touched = false, lowerWitness = false
  let quitAt = -1
  function finish(ok: boolean, why: string): void {
    done = true
    log('PARRY TRAINER PROBE ' + (ok ? 'PASS' : 'FAIL'), 'open-arena', why)
  }
  onStart(() => precache({ resources: [crate], heroes: ['hero_wraith'] }))
  for (const kind of ['CREATED', 'HIT', 'REMOVED']) onModifierEvent('MODIFIER_EVENT_BULLET_' + kind, event => {
    if (stage !== 0 || event.caster !== shooter?.pawn()?.entity) return
    if (kind === 'CREATED' && fired < 0) fired = now
    if (kind === 'HIT') touched = true
    if (kind === 'REMOVED' && removed < 0) removed = now
  })
  onDamage(hit => {
    if (!done && hit.victim === targetId && hit.attacker === shooter?.pawn()?.entity) {
      const pawn = shooter!.pawn()!
      if (stage === 1) {
        stage = 2
        lowerWitness = true
      } else if (stage === 2) {
        finish(pawn.position.z >= -2 && pawn.position.z <= 10,
          'level air miss cleared; 112 m distant and below-floor witnesses hit by live rounds; standing z=' + pawn.position.z)
      }
      return { block: true }
    }
  })
  onFrame(({ timeSeconds }) => {
    now = timeSeconds
    if (done) {
      // The engine may still be applying a hit when finish runs. Retire the
      // witnesses on a subsequent frame and let the bot disconnect before quit.
      if (quitAt < 0) {
        target?.remove()
        shooter?.removeBot()
        quitAt = now + 0.4
      } else if (now >= quitAt) serverCommand('quit')
      return
    }
    if (lowerWitness) {
      lowerWitness = false
      target?.move({ ...lowTarget, z: lowTarget.z - 64 })
      ready = now + 0.4
    }
    if (since < 0) since = now
    if (now - since > 15) { finish(false, 'waiting for stage ' + stage + ' fired=' + fired + ' removed=' + removed); return }
    shooter ??= addBot({ name: 'Arena tester', team: 2, hero: 'hero_wraith' })
    const pawn = shooter?.pawn()
    if (!shooter || !pawn?.hero) return
    if (ready < 0) {
      const start = { x: 0, y: 0, z: 75 }
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4
        const end = { x: 7000 * Math.cos(angle), y: 7000 * Math.sin(angle), z: start.z }
        if (trace({ start, end, layers: Layers.solid | Layers.hitbox, ignore: [pawn.entity] })) {
          finish(false, 'level shot obstructed, bearing ' + i * 45); return
        }
      }
      const floor = trace({ start: { x: 250, y: 0, z: 200 }, end: { x: 250, y: 0, z: -200 },
        layers: Layers.solid | Layers.playerClip })
      if (!floor || Math.abs(floor.position.z) > 0.5) { finish(false, 'missing movement floor'); return }
      target = createModel({ resource: crate, position: { ...farTarget, z: farTarget.z - 64 }, scale: 2, solid: true })
      targetId = target?.entity()
      if (!targetId || !writeField(targetId, 'CBaseEntity', 'm_bTakesDamage', 'bool', true)) {
        finish(false, 'failed to prepare projectile witness'); return
      }
      shooter.teleport({ x: 0, y: 0, z: 3 }, vector.level(0))
      ready = now + 0.4
    }
    if (now < ready) return
    if (stage === 0 && removed >= 0) {
      const life = removed - fired
      if (touched || life < 0.12) { finish(false, 'early or solid open-air endpoint: ' + life); return }
      log('unobstructed Wraith miss, seconds in flight', life)
      stage = 1
    }
    const shoot = stage !== 0 || fired < 0
    const facing = stage === 0 ? vector.level(95) : vector.aimAt(pawn.eyePosition, stage === 1 ? farTarget : lowTarget)
    shooter.drive({ facing, forward: 0, left: 0, held: shoot ? Buttons.attack : 0n, pressed: shoot ? Buttons.attack : 0n })
  })
}
