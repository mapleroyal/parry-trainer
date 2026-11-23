import { addBot, entityPosition, findEntities, log, onFrame, readField, serverCommand, type Player } from 'modlock'
import { testSubject } from '../gameplay'
import { meleeRange } from '../melee-range.js'
import { setRangePreview } from '../range-preview'
import { rangeRingResources } from '../range-rings'
import { session } from '../session'
import { settingsSnapshot } from '../trainer-settings'

export default function registerRangePreviewProbe(): void {
  const steps = [
    { send: 'min 80 20 50', radii: [] },
    { send: 'favored 20 80 50', radii: [20, 50, 80] },
    { send: 'favored 20 80 25', radii: [20, 35, 80], keepEntities: true },
    { send: 'max 100 100 50', radii: [100] },
    { send: 'off', radii: [] },
    { send: 'inspect 0 80 50', radii: [0, 40, 80] },
    { send: 'inspect 1 80 50', radii: [1, 40.5, 80], keepEntities: true },
    { begin: true, radii: [] }, // Starting a session clears a held Extra Info inspection.
    { send: 'inspect 0 80 50', radii: [] },
    { finish: true, send: 'inspect 0 80 50', radii: [0, 40, 80] },
    { send: 'min 0 80 50', radii: [0, 40, 80] },
    { radii: [], wait: 1.7 }, // Lost release: let the last heartbeat expire.
  ]
  let target: Player | undefined, originalSettings = '', previousIds = ''
  let stage = 0, verifyAt = -1, started = -1, done = false

  function finish(ok: boolean, detail: string): void {
    done = true
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'range-preview', detail)
    serverCommand('quit')
  }

  onFrame(({ timeSeconds: now }) => {
    if (done) return
    if (started < 0) started = now
    if (now - started > 20) { finish(false, 'timed out at stage ' + stage); return }
    if (!target) {
      target = addBot({ name: 'Range preview trainee', team: 2, hero: 'hero_wraith' })
      if (target) testSubject(target, undefined, false)
      return
    }
    const pawn = target.pawn()
    if (!pawn?.hero) return
    const step = steps[stage]
    if (verifyAt < 0) {
      if (stage === 0) originalSettings = settingsSnapshot()
      if (step.begin) session.begin({ mode: 'none' }, now)
      if (step.finish) session.finish('stopped', now)
      if (step.keepEntities) target.teleport({ x: 220, y: -130, z: 80 }, { yaw: 60 * stage, pitch: 0, roll: 0 }, { x: 0, y: 0, z: 0 })
      if (step.send) setRangePreview(step.send, now)
      verifyAt = now + (step.wait ?? 0.15)
      return
    }
    if (now < verifyAt) return
    const particles = findEntities('info_particle_system')
    function visible(resource: string): number[] {
      // Modlock resolves the content digest before the entity reaches the engine.
      const suffix = resource.split('{addon}')[1]
      return particles.filter(entity => {
        const effect = readField(entity, 'CParticleSystem', 'm_iszEffectName', 'string')
        const matches = suffix ? typeof effect === 'string' && effect.startsWith('particles/parry-trainer-') && effect.endsWith(suffix) : effect === resource
        return matches && readField(entity, 'CParticleSystem', 'm_bActive', 'bool') === true
      }).sort((a, b) => a - b)
    }
    const ids = visible(rangeRingResources[0])
    const actual = ids.map(entity => {
      const cp = readField(entity, 'CParticleSystem', 'm_vecDataCPValue', 'vector')
      return typeof cp === 'object' && cp ? cp.y : NaN
    }).sort((a, b) => a - b)
    const match = actual.length === step.radii.length &&
      step.radii.every((p, i) => Math.abs(actual[i] - meleeRange.units(p)) < 0.01)
    const labels = visible(rangeRingResources[1]).map(id => {
      const pos = entityPosition(id)?.position
      const cp = readField(id, 'CParticleSystem', 'm_vecDataCPValue', 'vector')
      if (!pos || !cp || typeof cp !== 'object') return undefined
      return { x: pos.x - pawn.position.x, y: pos.y - pawn.position.y, frame: cp.x, size: cp.y }
    })
    const expected = actual.map(r => String(parseFloat(meleeRange.formatUnits(r))))
    const yaw = (entityPosition(pawn.entity)?.facing.yaw ?? pawn.eyeAngles.yaw) * Math.PI / 180
    const dx = Math.cos(yaw), dy = Math.sin(yaw)
    const labeled = labels.length === expected.reduce((sum, str) => sum + str.length, 0) &&
      actual.every((r, i) => {
        const group = labels.flatMap(g => g && Math.abs(g.x * dx + g.y * dy - r) < 0.1
          ? [{ ...g, lateral: g.x * dy - g.y * dx }] : []).sort((a, b) => a.lateral - b.lateral)
        const largest = Math.max(...group.map(g => g.size))
        return Math.abs(largest - Math.min(8, Math.max(2, r / 5))) < 0.01 &&
          group.map(g => g.size < largest / 2 ? '.' : String(g.frame - 10)).join('') === expected[i]
      })
    const followed = !step.keepEntities || ids.every(entity => {
      const p = entityPosition(entity)?.position
      return p && Math.hypot(p.x - pawn.position.x, p.y - pawn.position.y) < 1 && p.z < pawn.position.z
    })
    if (!match || !labeled || !followed || (step.keepEntities && ids.join() !== previousIds) || settingsSnapshot() !== originalSettings) {
      finish(false, 'stage ' + stage + ' live radii ' + actual.join(', ') + ' glyphs ' + labels.length); return
    }
    previousIds = ids.join()
    verifyAt = -1
    if (++stage === steps.length) finish(true, 'live resize, labeled arcs, inspection gating, coincident handles, release and timeout')
  })
}
