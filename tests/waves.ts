// Live exercise of the game's NPCs, bullets, soul claims and expiries.
import { addBot, Buttons, entityPosition, findEntities, ground, killEntity, log, Npc, onFrame, onModifierEvent,
  readField, serverCommand, type Pawn, type Player, type Vector } from 'modlock'
import { moveWaves, resetSoulStats, resolveWaveSouls, soulStats, stopWaves, updateWaves, type WaveSettings } from '../waves'

const forward = { pitch: 0, yaw: 0, roll: 0 }
const alive = (name: string) => findEntities(name).filter(id =>
  readField(id, 'CBaseEntity', 'm_lifeState', 'uint8') === 0)
const xyDistance = (a: Vector, b: Vector) => Math.hypot(a.x - b.x, a.y - b.y)

function shootOrb(player: Player, pawn: Pawn, orb: number): void {
  const position = entityPosition(orb)?.position
  if (!position) return
  const eye = pawn.eyePosition
  const dx = position.x - eye.x, dy = position.y - eye.y
  player.drive({ facing: {
    yaw: Math.atan2(dy, dx) * 180 / Math.PI,
    pitch: -Math.atan2(position.z - eye.z, Math.hypot(dx, dy)) * 180 / Math.PI,
    roll: 0,
  }, forward: 0, left: 0, held: Buttons.attack, pressed: Buttons.attack })
}

export default function registerWaveProbe(): void {
  let active = true, started = -1
  let phase: 'spawn' | 'shoot lane' | 'expire camp' | 'mixed kills' | 'shoot camp' | 'tier 3' | 'cleanup' = 'spawn'
  let subject: Player | undefined, oldCamp: number[] = [], campCenter: Vector | undefined
  let campClaimed = false
  const config: WaveSettings = { troopers: true, trooperCount: 4, trooperActive: false, trooperSpeed: 50, camps: true, campTier: 1, campReactive: false }

  function finish(ok: boolean, detail: string): void {
    active = false
    stopWaves()
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'waves', detail, JSON.stringify(soulStats()))
    serverCommand('quit')
  }
  onModifierEvent('MODIFIER_EVENT_ORB_CLAIMED', event => {
    if (active && phase === 'shoot camp' && event.player.slot === subject?.slot) campClaimed = true
  })
  onFrame(({ timeSeconds: now }) => {
    if (!active) return
    subject ??= addBot({ hero: 'hero_wraith', team: 2, name: 'Soul trainee' })
    const pawn = subject?.pawn()
    if (!subject || !pawn?.hero) return
    if (started < 0) {
      started = now
      resetSoulStats()
      subject.teleport({ x: 0, y: 0, z: 4 }, forward)
    }
    if (now - started > 45) { finish(false, 'timeout in ' + phase); return }
    if (now - started < 3) return
    // Let the engine create and retire the shot camp orb between two score polls.
    if (phase !== 'shoot camp' || campClaimed) resolveWaveSouls(now)
    updateWaves(subject, now, config)
    const lane = alive('npc_trooper'), camp = alive('npc_trooper_neutral'), orbs = alive('item_xp')
    const score = soulStats()

    if (phase === 'spawn' && lane.length === 4 && camp.length >= 2) {
      for (const id of lane) {
        const position = entityPosition(id)!.position
        const range = xyDistance(position, pawn.position)
        const bearing = Math.atan2(position.y - pawn.position.y, position.x - pawn.position.x) * 180 / Math.PI
        const angle = ((bearing - pawn.eyeAngles.yaw + 540) % 360) - 180
        if (range < 20 * 39.37 - 3 || range > 50 * 39.37 + 3 || Math.abs(angle) > 55.2 || Math.abs(position.z) > 12) {
          finish(false, 'invalid lane range, bearing or floor'); return
        }
      }
      const before = entityPosition(lane[0])!.position
      moveWaves(128, -256)
      const shifted = entityPosition(lane[0])!.position
      moveWaves(-128, 256)
      if (Math.abs(shifted.x - before.x + 128) > 1 || Math.abs(shifted.y - before.y - 256) > 1) {
        finish(false, 'recenter did not carry lane unit'); return
      }
      oldCamp = camp
      subject.teleport({ x: before.x - 190, y: before.y, z: 4 }, forward)
      killEntity({ victim: lane[0], attacker: pawn.entity })
      const orb = alive('item_xp')[0]
      const launch = orb && entityPosition(orb)?.position
      if (!launch) { finish(false, 'no native soul on kill'); return }
      moveWaves(256, 128)
      const carried = entityPosition(orb)?.position
      moveWaves(-256, -128)
      if (!carried || Math.abs(carried.x - launch.x + 256) > 1 || Math.abs(carried.y - launch.y + 128) > 1) {
        finish(false, 'wrapping on the kill tick left a fresh soul behind'); return
      }
      phase = 'shoot lane'
      return
    }
    if (phase === 'shoot lane') {
      if (orbs.length) {
        if (lane.length > 3) { finish(false, 'lane replaced before orb settled'); return }
        shootOrb(subject, pawn, orbs[0])
      }
      if (score.troopers.missed) { finish(false, 'lane orb expired before bot shot it'); return }
      if (score.troopers.secured && lane.length === 4) {
        subject.drive({ facing: pawn.eyeAngles, forward: 0, left: 0, held: 0n, pressed: 0n })
        const center = entityPosition(oldCamp[0])!.position
        subject.teleport({ x: center.x - 190, y: center.y, z: 4 }, forward)
        for (const id of oldCamp) killEntity({ victim: id, attacker: pawn.entity })
        phase = 'expire camp'
      }
      return
    }
    if (phase === 'expire camp') {
      if (orbs.length && camp.some(id => !oldCamp.includes(id))) { finish(false, 'early camp replacement'); return }
      if (camp.length && score.camps.missed === oldCamp.length) {
        if (score.camps.secured || score.troopers.missed) { finish(false, 'cross-source score'); return }
        config.campTier = 2
        config.trooperCount = 1
        phase = 'mixed kills'
      }
      return
    }
    if (phase === 'mixed kills' && camp.length && lane.length === 1) {
      const before = camp.map(id => entityPosition(id)!.position)
      for (let i = 0; i < 3; i++) moveWaves(4100, 0)
      campCenter = entityPosition(camp[0])!.position
      const dx = campCenter.x - before[0].x
      for (const [i, id] of camp.entries()) {
        const at = entityPosition(id)!.position
        if (!ground(at) || Math.abs(at.x - before[i].x - dx) > 1 || Math.abs(at.y - before[i].y) > 1) {
          finish(false, 'same-direction wraps split the camp or carried it off the floor'); return
        }
      }
      // Both rewards must be eligible even if the random groups spawned far apart.
      const lanePosition = { x: campCenter.x + 360, y: campCenter.y, z: campCenter.z }
      const troop = new Npc(lane[0])
      troop.move(lanePosition, forward)
      subject.teleport({ x: campCenter.x - 160, y: campCenter.y, z: 4 }, forward)
      killEntity({ victim: camp[0], attacker: pawn.entity })
      killEntity({ victim: lane[0], attacker: pawn.entity })
      phase = 'shoot camp'
      return
    }
    if (phase === 'shoot camp' && campCenter) {
      const center = campCenter
      const orb = orbs.find(id => {
        const at = entityPosition(id)?.position
        return at && xyDistance(at, center) < 125
      })
      if (orb) shootOrb(subject, pawn, orb)
      else subject.drive({ facing: pawn.eyeAngles, forward: 0, left: 0, held: 0n, pressed: 0n })
      if (score.camps.secured === 1 && score.troopers.missed === 1) {
        if (score.troopers.secured !== 1 || score.camps.missed !== oldCamp.length ||
            score.troopers.kills !== 2 || score.camps.kills !== oldCamp.length + 1) {
          finish(false, 'mixed kills credited to wrong source'); return
        }
        config.campTier = 3
        phase = 'tier 3'
      }
      return
    }
    if (phase === 'tier 3' && camp.length) {
      // Cancel during the native kill, before its delayed callback can bind the orb.
      killEntity({ victim: camp[0], attacker: pawn.entity })
      killEntity({ victim: lane[0], attacker: pawn.entity })
      config.camps = config.troopers = false
      updateWaves(subject, now, config)
      phase = 'cleanup'
      return
    }
    if (phase === 'cleanup' && !camp.length && !lane.length) {
      finish(!orbs.length, 'lane range/bearing, repeated camp wraps, souls secured and missed across delayed polls, camp replacement, tier/count and cleanup')
    }
  })
}
