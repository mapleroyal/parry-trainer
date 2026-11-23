// Exercise the camp's own retaliation and prove the two behavior changes act on
// the same live neutral, including after the floating arena origin moves.
import { addBot, damage, entityPosition, findEntities, log, onDamaged, onFrame,
  serverCommand, type Player, type Vector } from 'modlock'
import { moveWaves, resolveWaveSouls, stopWaves, updateWaves, type WaveSettings } from '../waves'

export default function registerCreepBehaviorProbe(): void {
  const settings: WaveSettings = { camps: true, campReactive: true, campTier: 1,
    troopers: false, trooperCount: 1, trooperActive: false, trooperSpeed: 50 }
  let active = true, stage = 0, start = -1, changed = 0
  let subject: Player | undefined, target = 0, hits = 0, priorHits = 0
  let members = new Set<number>(), nextShot = 0
  let stationary: Vector | undefined
  function finish(pass: boolean, detail: string): void {
    active = false
    stopWaves()
    log(pass ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'creep behavior', detail, 'stage', stage, 'native hits', hits)
    serverCommand('quit')
  }
  onDamaged(event => {
    if (active && members.has(event.attacker) && event.victim === subject?.pawn()?.entity && event.healthLost > 0) hits++
  })
  onFrame(({ timeSeconds: now }) => {
    if (!active) return
    if (start < 0) start = now
    if (now - start > 30) { finish(false, 'timed out'); return }
    subject ??= addBot({ name: 'Neutral trainee', hero: 'hero_wraith', team: 2 })
    const p = subject?.pawn()
    if (!p?.hero || !subject) return
    resolveWaveSouls(now)
    updateWaves(subject, now, settings)
    if (stage === 0) {
      members = new Set(findEntities('npc_trooper_neutral'))
      target = members.values().next().value ?? 0
      const at = target && entityPosition(target)?.position
      if (!at) return
      // Include native camp and spawn markers in the same recenter as the player.
      moveWaves(270, -430)
      const moved = entityPosition(target)?.position
      if (!moved || Math.abs(at.x - moved.x - 270) > 1 || Math.abs(at.y - moved.y + 430) > 1) {
        finish(false, 'neutral did not wrap'); return
      }
      const center = entityPosition(findEntities('info_neutral_trooper_camp')[0])?.position
      if (!center) { finish(false, 'missing camp controller'); return }
      subject.teleport({ x: (center.x + moved.x) / 2, y: (center.y + moved.y) / 2, z: moved.z + 4 }, p.eyeAngles)
      changed = now
      stage++
    } else if (stage === 1 && now - changed > 2.0) {
      if (hits) { finish(false, 'unprovoked neutral attacked'); return }
      stage++
    } else if ((stage === 2 || stage === 6) && hits === priorHits && now >= nextShot) {
      // The native squad can absorb a single point and go back to sleep.
      // Keep peppering the same member until one of them returns fire.
      damage({ victim: target, attacker: p.entity, amount: 1 })
      nextShot = now + 0.35
    } else if (stage === 2 && hits) {
      settings.campReactive = false
      changed = now
      stage++
    } else if (stage === 3 && now - changed > 1.3) {
      // Allow a projectile sent before the toggle to finish.
      priorHits = hits
      stationary = entityPosition(target)?.position
      damage({ victim: target, attacker: p.entity, amount: 1 })
      changed = now
      stage++
    } else if (stage === 4 && now - changed > 2.2) {
      const at = entityPosition(target)?.position
      if (!at || !stationary || hits !== priorHits || Math.hypot(at.x - stationary.x, at.y - stationary.y) > 3) {
        finish(false, 'stationary neutral moved or attacked'); return
      }
      settings.campReactive = true
      changed = now
      stage++
    } else if (stage === 5 && now - changed > 0.3) {
      damage({ victim: target, attacker: p.entity, amount: 1 })
      stage++
    } else if (stage === 6 && hits > priorHits) {
      settings.camps = false
      stage++
      changed = now
    } else if (stage === 7 && now - changed > 1) {
      if (findEntities('npc_trooper_neutral').length) { finish(false, 'living camp after toggle'); return }
      // Stop on the frame that requests the next native spawn, before its
      // members have been adopted by the trainer.
      settings.camps = true
      updateWaves(subject, now, settings)
      stopWaves()
      settings.camps = false
      changed = now
      stage++
    } else if (stage === 8 && now - changed > 1) {
      const cleared = ['npc_trooper_neutral', 'info_neutral_trooper_camp', 'info_neutral_trooper_spawn']
        .every(kind => !findEntities(kind).length)
      finish(cleared, 'unprovoked, retaliated, stationary, retaliated again, cleared including pending spawn')
    }
  })
}
