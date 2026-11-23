// Native heavy contacts drive the loss counter. Health damage alone does not.
import { addBot, Buttons, damage, findEntities, log, onDamaged, onFrame, onMelee,
  players, readField, serverCommand, type Player } from 'modlock'
import { beginTraining, setMeleeDistances, stopTraining, testSubject, waveSettings } from '../gameplay'
import { billyParticleResources, lungeDust } from '../particles'
import { session } from '../session'
import { changeSetting } from '../trainer-settings'

export default function registerHitLimitProbe(): void {
  let active = true, start = -1, nextParry = 0, unrelatedDamage = 0, contacts = 0, stopped = -1
  let stage: 'setup' | 'damage' | 'parry' | 'contacts' | 'cleanup' = 'setup'
  let trainee: Player | undefined

  function finish(ok: boolean, detail: string): void {
    active = false
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'hit-limit', detail, stage,
      session.phase, session.reason, 'parries', session.parries, 'hits', session.hits, 'contacts', contacts)
    stopTraining()
    serverCommand('quit')
  }
  onDamaged(hit => {
    if (active && stage === 'parry' && hit.victim === trainee?.pawn()?.entity && hit.attacker === hit.victim)
      unrelatedDamage += hit.healthLost
  })
  onMelee(swing => {
    const pawn = active && stage === 'contacts' && trainee?.pawn()
    if (pawn && swing.heavy && swing.attackerPlayer.slot !== trainee?.slot && swing.hits.includes(pawn.entity)) contacts++
  })
  onFrame(({ timeSeconds: now }) => {
    if (!active) return
    if (start < 0) start = now
    if (now - start > 45) { finish(false, 'timeout'); return }
    if (!trainee) {
      trainee = addBot({ name: 'Hit limit trainee', hero: 'hero_wraith', team: 2 })
      if (trainee) testSubject(trainee, undefined, false)
      return
    }
    const pawn = trainee.pawn()
    if (!pawn?.hero) return
    const opponent = players().find(c => c.name === 'Trainer opponent 1')?.player
    if (stage === 'setup') {
      setMeleeDistances(0, 0, 50)
      waveSettings.troopers = true
      // End the run on a punch with live hand and lunge effects.
      if (!changeSetting('hero1', 'hero_punkgoat') || !changeSetting('effects', '1')) { finish(false, 'opponent'); return }
      if (!changeSetting('hit_limit', '2') || !changeSetting('fail_on_hits', '1')) { finish(false, 'settings'); return }
      if (beginTraining({ mode: 'none' })) stage = 'damage'
    } else if (stage === 'damage' && session.phase === 'running' && opponent && findEntities('npc_trooper').length) {
      stage = 'parry'
      damage({victim: pawn.entity, attacker: pawn.entity, amount: 17})
    } else if (stage === 'parry' && opponent) {
      if (session.hits || session.phase !== 'running') { finish(false, 'lost a hit before the parry'); return }
      if (session.parries) {
        if (unrelatedDamage <= 0 || session.parries !== 1) { finish(false, 'missing unrelated damage or parry'); return }
        // A settings command can prepare the next run while this one keeps its original limit.
        changeSetting('hit_limit', '1')
        if (session.hitLimit !== 2) { finish(false, 'hit limit changed during the run'); return }
        stage = 'contacts'
        return
      }
      const melee = opponent.abilities().find(a => a.slot === 22)
      if (!melee) return
      const state = readField(melee.entity, 'CCitadel_Ability_HoldMelee', 'm_eCurrentAttackState', 'uint32')
      if ((state === 2 || state === 3 || state === 5) && now >= nextParry && trainee.press(Buttons.parry))
        nextParry = now + 0.9
    } else if (stage === 'contacts' && session.phase === 'finished') {
      if (session.reason !== 'hits' || session.hits !== 2 || session.hitLimit !== 2 || contacts !== 2 || pawn.health <= 0) {
        finish(false, 'wrong result at second contact'); return
      }
      stage = 'cleanup'
      stopped = now
    } else if (stage === 'cleanup' && now - stopped >= 0.1 && now - stopped < 2) {
      const effects = [lungeDust, ...billyParticleResources]
      for (const entity of findEntities('info_particle_system')) {
        const name = readField(entity, 'CParticleSystem', 'm_iszEffectName', 'string')
        if (typeof name === 'string' && effects.includes(name) && readField(entity, 'CParticleSystem', 'm_bActive', 'bool')) {
          finish(false, 'opponent effect still active after defeat'); return
        }
      }
    } else if (stage === 'cleanup' && now - stopped >= 2) {
      finish(session.phase === 'finished' && session.reason === 'hits' && session.parries === 1 &&
        session.hits === 2 && contacts === 2 && !opponent && !findEntities('npc_trooper').length,
        'unrelated damage and successful parry ignored, second native heavy ends run, frozen score and wave cleanup')
    }
  })
}
