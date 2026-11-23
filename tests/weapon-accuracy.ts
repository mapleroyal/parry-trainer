// Fire the trainee's real shotgun sideways, then into a stationary lane trooper.
import { addBot, Buttons, entityPosition, findEntities, log, onFrame, onModifierEvent,
  readField, serverCommand, type Player } from 'modlock'
import { testSubject, waveSettings } from '../gameplay'
import { session } from '../session'

export default function registerWeaponAccuracyProbe(): void {
  const east = { yaw: 0, pitch: 0, roll: 0 }
  let subject: Player | undefined, nextAt = -1, phase = 0, startedAt = -1
  let blasts = 0, missed = 0, active = true
  onModifierEvent('MODIFIER_EVENT_GUN_FIRED', event => {
    if (event.player.slot === subject?.slot) blasts++
  })

  function finish(ok: boolean, message: string): void {
    active = false
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'weapon-accuracy', message,
      'volleys', blasts, 'pellets hit/fired', session.bulletsHit, session.bulletsFired, 'initial misses', missed)
    serverCommand('quit')
  }

  onFrame(({ timeSeconds: now }) => {
    if (!active) return
    if (startedAt < 0) startedAt = now
    if (now - startedAt > 30) { finish(false, 'timeout'); return }
    if (!subject) {
      subject = addBot({ name: 'Accuracy trainee', team: 2, hero: 'hero_atlas' })
      if (subject) { testSubject(subject); waveSettings.troopers = true; waveSettings.trooperActive = false }
      return
    }
    const pawn = subject.pawn()
    if (!pawn?.hero || session.phase !== 'running') return
    const target = findEntities('npc_trooper').find(id => readField(id, 'CBaseEntity', 'm_lifeState', 'uint8') === 0)
    if (!target) return
    if (nextAt < 0) nextAt = now + 4 // Let match-intro respawns and weapon deploy finish.
    if (now < nextAt) return
    const pos = entityPosition(target)!.position
    const dx = pos.x - pawn.eyePosition.x, dy = pos.y - pawn.eyePosition.y
    const facing = phase < 2 ? { ...east, yaw: 90 } : {
      yaw: Math.atan2(dy, dx) * 180 / Math.PI,
      pitch: -Math.atan2(pos.z + 35 - pawn.eyePosition.z, Math.hypot(dx, dy)) * 180 / Math.PI, roll: 0 }
    if (phase === 0 || phase === 2)
      subject.teleport({ x: pos.x - 275, y: pos.y, z: pos.z + 2 }, facing, { x: 0, y: 0, z: 0 })
    const attack = phase === 1 || phase === 3 ? Buttons.attack : 0n
    subject.drive({ facing, forward: 0, left: 0, held: attack, pressed: attack })
    if (phase === 2) {
      missed = session.bulletsFired
      if (blasts < 1 || missed <= blasts || session.bulletsHit !== 0) { finish(false, 'empty-space volley'); return }
    }
    if (phase === 4) {
      finish(session.bulletsHit > 0 && session.bulletsFired > missed && session.bulletsHit <= session.bulletsFired - missed,
        'creep hit and misses retained')
      return
    }
    phase++
    nextAt = now + 0.8
  })
}
