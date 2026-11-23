// Bank real lane orbs, then compare a hit, a dodge, a catch and a whiff.
import { addBot, Buttons, entityPosition, findEntities, killEntity, log, onFrame, players, readField,
  serverCommand, vector, type Player } from 'modlock'
import { beginTraining, testSubject } from '../gameplay'
import { session } from '../session'
import { changeSetting } from '../trainer-settings'
import { securedSouls } from '../waves'

export default function registerSoulPenaltiesProbe(): void {
  let trainee: Player | undefined, start = -1, marker = 0, attempted = false, lastUnit = 0
  let stage: 'setup' | 'bank' | 'hit' | 'dodge' | 'catch' | 'whiff' | 'rebuild' | 'done' = 'setup'
  function finish(ok: boolean, message: string): void {
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'soul-penalties', stage, message,
      'collected', securedSouls(), 'deducted', session.soulsDeducted, 'hits/parries', session.hits, session.parries)
    stage = 'done'
    serverCommand('quit')
  }
  function alive(name: string): number | undefined {
    return findEntities(name).find(e => readField(e, 'CBaseEntity', 'm_lifeState', 'uint8') === 0)
  }
  onFrame(({ timeSeconds: now }) => {
    if (stage === 'done') return
    if (start < 0) start = now
    if (now - start > 75) { finish(false, 'timeout'); return }
    if (!trainee) {
      trainee = addBot({ name: 'Soul penalty trainee', hero: 'hero_wraith', team: 2 })
      if (trainee) testSubject(trainee, undefined, false)
      return
    }
    const pawn = trainee.pawn()
    if (!pawn?.hero || pawn.health <= 0) return
    if (stage === 'setup') {
      changeSetting('troopers', '1')
      changeSetting('idle_drain', '0')
      changeSetting('difficulty', '100')
      if (beginTraining({mode:'goal', parries:1, souls:5})) stage = 'bank'
      return
    }
    if (session.phase === 'finished') {
      finish(stage === 'rebuild' && session.reason === 'goal' && securedSouls() === 9 && session.soulsDeducted === 4,
        'net soul goal with independently earned lane souls')
      return
    }
    if (session.phase !== 'running') return
    const enemy = players().find(p => p.name === 'Trainer opponent 1')?.player
    if (stage === 'bank' || stage === 'rebuild') {
      if (stage === 'bank' && securedSouls() >= 5) {
        trainee.drive({facing:pawn.eyeAngles, forward:0, left:0, pressed:0n, held:0n})
        changeSetting('penalty_hit', '1')
        changeSetting('penalty_unparried', '1')
        marker = session.hits
        stage = 'hit'
        return
      }
      const orb = alive('item_xp')
      const soul = orb && entityPosition(orb)?.position
      if (soul) trainee.drive({facing:vector.aimAt(pawn.eyePosition, soul), forward:0, left:0,
        pressed:Buttons.attack, held:Buttons.attack})
      else {
        const unit = alive('npc_trooper')
        const pos = unit && entityPosition(unit)?.position
        if (pos && unit !== lastUnit) {
          trainee.teleport({ x:pos.x - 190, y:pos.y, z:pos.z }, vector.level(0))
          if (killEntity({victim:unit, attacker:pawn.entity})) lastUnit = unit
        }
      }
      return
    }
    if (stage === 'hit' && session.hits > marker) {
      if (session.soulsDeducted !== 2) { finish(false, 'one heavy hit should cost two'); return }
      marker = session.heavy
      stage = 'dodge'
    } else if (stage === 'dodge') {
      if (!attempted && enemy && ((enemy.buttons() ?? 0n) & Buttons.melee)) {
        attempted = trainee.teleport({x:pawn.position.x + 1500, y:pawn.position.y, z:pawn.position.z}, pawn.eyeAngles)
      }
      if (session.heavy === marker) return
      if (!attempted || session.soulsDeducted !== 3) { finish(false, 'unparried miss should cost one'); return }
      stage = 'catch'
      attempted = false
    } else if (stage === 'catch') {
      const melee = enemy?.abilities().find(a => a.slot === 22)
      const state = melee && readField(melee.entity, 'CCitadel_Ability_HoldMelee', 'm_eCurrentAttackState', 'uint32')
      if (!session.parries) {
        if (state === 2 || state === 3 || state === 5) trainee.press(Buttons.parry)
        return
      }
      if (session.soulsDeducted !== 3) { finish(false, 'caught heavy incurred a deduction'); return }
      changeSetting('penalty_hit', '0')
      changeSetting('penalty_unparried', '0')
      changeSetting('penalty_whiff', '1')
      stage = 'whiff'
    } else if (stage === 'whiff') {
      if (session.soulsDeducted === 3) { trainee.press(Buttons.parry); return }
      if (session.soulsDeducted !== 4) { finish(false, 'expected one empty parry'); return }
      changeSetting('penalty_whiff', '0')
      stage = 'rebuild'
    }
  })
}
