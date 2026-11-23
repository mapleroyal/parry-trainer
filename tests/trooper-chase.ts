import {
  addBot, findEntities, holdModifierState, log, Npc, onDamaged,
  onFrame, serverCommand, vector, type Player, type Vector,
} from 'modlock'
import { testSubject, waveSettings } from '../gameplay'

export default function registerTrooperChaseProbe(): void {
  let active = true, start = -1, changed = 0, phase = 0, shots = 0, quietShots = 0
  let trainee: Player | undefined, troop: Npc | undefined, marker: Vector | undefined
  const samples = [50, 10, 100]
  const speeds: number[] = []
  // Both firing positions are far from the authored lane at y=0.
  const spawn = { x: 2400, y: 3200, z: 8 }
  const approachStart = { x: spawn.x + 2500, y: spawn.y + 400, z: 4 }
  onDamaged(hit => {
    if (active && troop && hit.attacker === troop.entity && hit.victim === trainee?.pawn()?.entity && hit.healthLost > 0)
      shots++
  })
  function finish(ok: boolean, message: string): void {
    active = false
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'trooper chase', message, 'phase', phase, 'native hits', shots, 'observed speeds', speeds.join(', '))
    serverCommand('quit')
  }
  onFrame(({timeSeconds: now}) => {
    if (!active) return
    if (start < 0) start = now
    if (now - start > 40) { finish(false, 'timeout'); return }
    if (!trainee) {
      trainee = addBot({name: 'Pursuit trainee', team: 2, hero: 'hero_wraith'})
      if (trainee) {
        testSubject(trainee, spawn)
        waveSettings.troopers = waveSettings.trooperActive = true
      }
      return
    }
    const pawn = trainee.pawn()
    if (!pawn?.hero) return
    if (!troop) {
      const entity = findEntities('npc_trooper')[0]
      if (!entity) return
      troop = new Npc(entity)
      holdModifierState(entity, 'MODIFIER_STATE_IMMOBILIZED', true)
      changed = now
      return
    }
    const npc = troop.read()
    if (!npc) { finish(false, 'lost trooper'); return }
    const distance = vector.flatDistance(npc.position, pawn.position)
    if (phase === 0) {
      if (now - changed < 0.2) { marker = npc.position; return }
      if (!marker || vector.flatDistance(marker, npc.position) > 12 || shots) {
        finish(false, 'immobilized trooper moved or fired at long range'); return
      }
      if (now - changed > 1.2) {
        if (waveSettings.trooperSpeed !== 50) { finish(false, 'factory movement speed'); return }
        // Place the fully initialized NPC far enough out to measure all three
        // speeds before its native AI can acquire the trainee.
        if (!troop.move(approachStart, vector.level(180))) { finish(false, 'positioning trooper'); return }
        holdModifierState(troop.entity, 'MODIFIER_STATE_IMMOBILIZED', false)
        changed = now
        marker = approachStart
        phase++
      }
    } else if (phase === 1 && marker && now - changed >= 0.85) {
      const measured = vector.flatDistance(npc.position, marker) / (now - changed)
      const expected = 512 * samples[speeds.length] / 100
      speeds.push(Math.round(measured))
      if (Math.abs(measured - expected) > expected * 0.1 + 5 || shots) {
        finish(false, 'pursuit speed on living trooper'); return
      }
      marker = npc.position
      changed = now
      if (speeds.length < samples.length) waveSettings.trooperSpeed = samples[speeds.length]
      else phase++
    } else if (phase === 2 && shots > 0) {
      if (distance > 730 || Math.abs(npc.position.y) < 2200) { finish(false, 'first engagement range'); return }
      trainee.teleport({x: spawn.x - 700, y: spawn.y + 1550, z: 6}, vector.level(180))
      marker = npc.position
      changed = now
      quietShots = shots
      phase++
    } else if (phase === 3) {
      const moving = now - changed < 1.5
      trainee.drive({facing: vector.level(180), forward: moving ? 1 : 0, left: 0, held: 0n, pressed: 0n})
      if (shots <= quietShots || !marker || vector.flatDistance(marker, npc.position) < 850) return
      if (distance > 730 || Math.abs(npc.position.y) < 2800) { finish(false, 'second engagement range'); return }
      // Change behavior on the existing living unit while it is actually shooting.
      waveSettings.trooperActive = false
      changed = now
      phase++
    } else if (phase === 4 && now - changed >= 1) {
      quietShots = shots // allow a bullet fired before the toggle to finish its flight
      marker = npc.position
      changed = now
      phase++
    } else if (phase === 5 && now - changed >= 3) {
      finish(!!marker && vector.flatDistance(marker, npc.position) < 10 && quietShots === shots,
        'rooted, pursued a moving target twice off lane, native hits in range, then stationary and disarmed')
    }
  })
}
