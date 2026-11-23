// Let a real sparring partner land a lethal heavy while an unclaimed soul is in flight.
import {
  addBot, Buttons, damage, findEntities, killEntity, log, Npc, onDamaged, onFrame, onKill,
  players, readField, serverCommand, writeField, type Player,
} from 'modlock'
import { beginTraining, setMeleeDistances, stopTraining, testSubject, waveSettings } from '../gameplay'
import { changeSetting } from '../trainer-settings'
import { session } from '../session'
import { soulStats } from '../waves'

export default function registerDeathProbe(): void {
  let active = true, start = -1, stopped = -1, timeLeft = 0
  let stage: 'setup' | 'windup' | 'lethal hit' | 'respawn' | 'retry' | 'protected' = 'setup'
  let trainee: Player | undefined, attacker = 0, killedBy = 0
  let retryHits = 0, retryStarted = 0, deaths = 0
  const alive = (type: string) => findEntities(type).filter(id =>
    readField(id, 'CBaseEntity', 'm_lifeState', 'uint8') === 0)

  function finish(ok: boolean, message: string): void {
    active = false
    if (ok) log('PARRY TRAINER PROBE PASS', 'death', message)
    else log('PARRY TRAINER PROBE FAIL', 'death', message, stage, session.phase, session.reason,
      'heavies', session.heavy, 'hits', session.hits, JSON.stringify(soulStats()))
    stopTraining()
    serverCommand('quit')
  }
  onKill(event => {
    if (active && event.victimPlayer.slot === trainee?.slot) {
      deaths++
      killedBy = event.attacker
    }
  })
  onDamaged(hit => {
    if (active && stage === 'protected' && hit.attacker === attacker && hit.victim === trainee?.pawn()?.entity && hit.healthLost > 0)
      retryHits++
  })
  onFrame(({ timeSeconds: now }) => {
    if (!active) return
    if (start < 0) start = now
    if (now - start > 30) { finish(false, 'timeout'); return }
    if (!trainee) {
      trainee = addBot({ name: 'Death trainee', hero: 'hero_wraith', team: 2 })
      if (trainee) testSubject(trainee, undefined, false)
      return
    }
    const pawn = trainee.pawn()
    const opponent = players().find(p => p.name === 'Trainer opponent 1')?.player
    if (stage === 'setup' && pawn?.hero && pawn.health > 0) {
      waveSettings.troopers = waveSettings.camps = true
      waveSettings.campReactive = false
      setMeleeDistances(0, 0, 50)
      // Combat lethality and losing on death are independent. Enable both to
      // make a fatal heavy end the run before the coincident hit limit.
      changeSetting('idle_drain', '0')
      changeSetting('death', '1')
      changeSetting('fail_on_death', '1')
      changeSetting('hit_limit', '1')
      changeSetting('fail_on_hits', '1')
      if (beginTraining({ mode: 'timer', value: 60 })) stage = 'windup'
    } else if (stage === 'windup' && pawn?.hero && opponent && ((opponent.buttons() ?? 0n) & Buttons.melee)) {
      const lane = alive('npc_trooper')[0]
      if (!lane || !alive('npc_trooper_neutral').length) return
      attacker = opponent.pawn()!.entity
      // A nearby kill creates a claimable orb even if the randomly placed lane is far away.
      new Npc(lane).move({ x: pawn.position.x - 180, y: pawn.position.y, z: pawn.position.z })
      killEntity({ victim: lane, attacker: pawn.entity })
      if (!alive('item_xp').length) { finish(false, 'no live soul before the lethal swing'); return }
      writeField(pawn.entity, 'CBaseEntity', 'm_iHealth', 'int32', 1)
      stage = 'lethal hit'
    } else if (stage === 'lethal hit' && session.phase === 'finished') {
      if (session.reason !== 'death' || session.hitLimit !== 1 || session.heavy !== 1 ||
          session.hits !== 1 || soulStats().troopers.kills !== 1) {
        finish(false, 'death or final score'); return
      }
      stopped = now
      timeLeft = session.remaining(now)
      stage = 'respawn'
    } else if (stage === 'respawn' && now - stopped >= 3 && pawn?.hero && pawn.health > 0) {
      if (deaths !== 1 || killedBy !== attacker || session.reason !== 'death' || session.hits !== 1 || session.heavy !== 1 ||
          session.remaining(now) !== timeLeft || timeLeft <= 0 || opponent ||
          ['npc_trooper', 'npc_trooper_neutral', 'item_xp'].some(type => alive(type).length)) {
        finish(false, 'final score, frozen timer or cleanup after respawn'); return
      }
      const lane = soulStats().troopers
      if (lane.kills !== 1 || lane.secured || lane.missed) { finish(false, 'unresolved soul changed the result'); return }
      // Keeping the death loss enabled must not itself make combat lethal.
      changeSetting('death', '0')
      changeSetting('fail_on_hits', '0')
      if (beginTraining({ mode: 'none' })) stage = 'retry'
    } else if (stage === 'retry' && session.phase === 'running' && pawn?.hero && opponent?.pawn()?.hero && alive('npc_trooper').length) {
      stage = 'protected'
      retryStarted = now
      attacker = opponent.pawn()!.entity
      damage({ victim: pawn.entity, attacker, amount: 100000 })
    } else if (stage === 'protected' && retryHits === 1 && now - retryStarted >= 0.4 && pawn) {
      damage({ victim: pawn.entity, attacker, amount: 100000 })
    } else if (stage === 'protected' && retryHits >= 2) {
      finish(deaths === 1 && !!pawn && pawn.health > 0 && session.phase === 'running' && !session.reason && !session.heavy &&
        !session.hits && !session.hitLimit && !soulStats().troopers.kills,
        'death and hit cap, frozen result through respawn, protected retry survives successive lethal hits')
    }
  })
}
