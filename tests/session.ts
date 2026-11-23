import { addBot, Buttons, entityPosition, findEntities, killEntity, log, onFrame, onParry, players, readField, serverCommand, vector, writeField, type Player } from 'modlock'
import { beginTraining, hitLossSettings, resetTraining, setMeleeDistances, testSubject, waveSettings } from '../gameplay'
import { session } from '../session'
import { changeSetting, resetSettings } from '../trainer-settings'
import { soulStats } from '../waves'

export default function registerSessionProbe(): void {
  let active = true, stage = 0, start = -1, pressedAt = -1
  let trainee: Player | undefined
  const primary = 'CCitadel_Ability_PrimaryWeapon'
  let gun = 0, magazine = 0, spentRounds = false
  let goalStarted = 0, expandedClip = 0, sawEmpty = false, checkedEmptyStart = false
  let parriedDuringWaves = false
  let lastKill: 'troopers' | 'camps' | undefined
  function finish(ok: boolean, message: string): void {
    active = false
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'session', message)
    serverCommand('quit')
  }
  onParry(event => {
    if (active && event.player.slot === trainee?.slot && stage === 3) {
      parriedDuringWaves ||= findEntities('npc_trooper').length > 0 && findEntities('npc_trooper_neutral').length > 0
    }
  })
  onFrame(({ timeSeconds: now }) => {
    if (!active) return
    if (start < 0) start = now
    if (now - start > 45) { finish(false, 'timeout at stage ' + stage); return }
    if (!trainee) {
      trainee = addBot({ name: 'Session trainee', hero: 'hero_wraith', team: 2 })
      if (trainee) testSubject(trainee, undefined, false)
      return
    }
    const pawn = trainee.pawn()
    if (!pawn?.hero) return
    const opponent = players().find(c => c.name === 'Trainer opponent 1')?.player
    if (stage === 0 && now - start > 1) {
      if (opponent || session.phase !== 'ready') { finish(false, 'encounter active before Begin'); return }
      if (!changeSetting('preset', '100') || waveSettings.trooperSpeed !== 100 || !waveSettings.camps ||
          !hitLossSettings.enabled || hitLossSettings.limit !== 1) { finish(false, 'hardest preset did not reach gameplay'); return }
      changeSetting('preset', '50')
      gun = trainee.abilities().find(a => a.slot === 21)?.entity ?? 0
      const clip = gun && readField(gun, primary, 'm_iClip', 'int32')
      if (typeof clip !== 'number' || clip <= 0) return
      magazine = clip
      if (beginTraining({mode:'timer', value:2})) {
        if (changeSetting('preset', '100') || changeSetting('preset_reset', '1')) {
          finish(false, 'changed the preset during a run'); return
        }
        stage++
      }
    } else if (stage === 1) {
      if (session.phase === 'countdown' && opponent) { finish(false, 'opponent active during countdown'); return }
      const clip = readField(gun, primary, 'm_iClip', 'int32')
      if (session.phase === 'countdown' && session.remaining(now) <= 1) {
        trainee.drive({ facing: pawn.eyeAngles, forward: 0, left: 0, held: Buttons.attack, pressed: Buttons.attack })
        spentRounds ||= typeof clip === 'number' && clip < magazine
      }
      if (session.phase === 'running') {
        trainee.drive({ facing: pawn.eyeAngles, forward: 0, left: 0, held: 0n, pressed: 0n })
        if (!spentRounds || clip !== magazine) { finish(false, 'first scored frame did not start fully loaded'); return }
        stage++
      }
    } else if (stage === 2 && session.phase === 'finished' && !opponent) {
      if (session.reason !== 'time') { finish(false, 'timer reason'); return }
      changeSetting('troopers', '1')
      setMeleeDistances(0, 0, 50)
      if (beginTraining({mode:'goal', parries:2, souls:2})) {
        if (!trainee.buyItem('upgrade_clip_size')) { finish(false, 'could not upgrade the magazine'); return }
        goalStarted = now
        if (changeSetting('troopers', '0') || !changeSetting('camps', '1') ||
            !changeSetting('troopers', '0') || changeSetting('camps', '0') || !changeSetting('troopers', '1')) {
          finish(false, 'soul goal must retain its last source and allow switching between them'); return
        }
        stage++
      }
    } else if (stage === 3 && session.phase === 'countdown' && now - goalStarted >= 2.8) {
      const clip = readField(gun, primary, 'm_iClip', 'int32')
      if (!expandedClip) {
        const fraction = readField(gun, primary, 'm_flAmmoFrac', 'float32')
        if (typeof clip !== 'number' || typeof fraction !== 'number' || fraction <= 0) return
        expandedClip = Math.round(clip / fraction)
        if (expandedClip <= magazine || !writeField(gun, primary, 'm_iClip', 'int32', 0)) {
          finish(false, 'could not empty the upgraded magazine'); return
        }
      } else if (clip === 0) sawEmpty = true
    } else if (stage === 3 && session.phase === 'running' && !checkedEmptyStart) {
      if (!sawEmpty || readField(gun, primary, 'm_iClip', 'int32') !== expandedClip) {
        finish(false, 'empty upgraded weapon was not full on the first scored frame'); return
      }
      checkedEmptyStart = true
    } else if (stage === 3 && session.phase === 'running' && opponent) {
      const scores = soulStats()
      // Catch the first punch with both waves live, then secure one orb from each.
      if (session.parries && !scores.camps.secured) {
        const group = scores.troopers.secured ? 'camps' : 'troopers'
        if (scores[group].missed) { finish(false, 'test shot missed ' + group + ' soul'); return }
        if (group !== lastKill) {
          const unit = findEntities(group === 'troopers' ? 'npc_trooper' : 'npc_trooper_neutral')[0]
          const at = unit && entityPosition(unit)?.position
          if (!at) return
          trainee.teleport({ x: at.x - 190, y: at.y, z: at.z }, vector.level(0))
          killEntity({ victim: unit, attacker: pawn.entity })
          lastKill = group
        } else {
          const orb = findEntities('item_xp').find(id => readField(id, 'CBaseEntity', 'm_lifeState', 'uint8') === 0)
          const at = orb && entityPosition(orb)?.position
          if (at) trainee.drive({ facing: vector.aimAt(pawn.eyePosition, at), forward: 0, left: 0,
            held: Buttons.attack, pressed: Buttons.attack })
        }
        return
      }
      if (scores.camps.secured && waveSettings.camps) {
        if (!changeSetting('penalty_unparried', '1') || !changeSetting('troopers', '0') || changeSetting('camps', '0') ||
            !changeSetting('penalty_unparried', '0') || !changeSetting('camps', '0')) {
          finish(false, 'completed soul target must retain a source only while a soul penalty is active'); return
        }
        trainee.drive({ facing: pawn.eyeAngles, forward: 0, left: 0, held: 0n, pressed: 0n })
        return
      }
      const weapon = opponent.abilities().find(a => a.slot === 22)
      if (!weapon) return
      const state = readField(weapon.entity, 'CCitadel_Ability_HoldMelee', 'm_eCurrentAttackState', 'uint32')
      if ((state === 2 || state === 3 || state === 5) && now - pressedAt >= 0.9) {
        if (trainee.press(Buttons.parry)) pressedAt = now
      }
    } else if (stage === 3 && session.phase === 'finished' && !opponent) {
      if (session.reason !== 'goal' || session.parries !== 2 || session.heavy < 2) {
        finish(false, 'final parry / heavy not scored'); return
      }
      if (!parriedDuringWaves || waveSettings.troopers || waveSettings.camps ||
          findEntities('npc_trooper').length || findEntities('npc_trooper_neutral').length) {
        finish(false, 'first parry must have waves and both sources must be off for the last parry'); return
      }
      if (soulStats().troopers.secured !== 1 || soulStats().camps.secured !== 1) {
        finish(false, 'combined goal must wait for both secured orbs'); return
      }
      const finalElapsed = session.elapsed(now)
      resetSettings()
      if (session.phase !== 'finished' || session.reason !== 'goal' || session.parries !== 2 ||
          session.elapsed(now) !== finalElapsed || soulStats().troopers.secured !== 1 || soulStats().camps.secured !== 1) {
        finish(false, 'restoring options must preserve the completed score'); return
      }
      resetTraining() // A new trainee connection clears the previous session.
      stage++
    } else if (stage === 4) {
      finish(session.phase === 'ready' && !opponent && session.parries === 0 && session.heavy === 0 &&
        !waveSettings.troopers && !waveSettings.camps, 'ready, countdown, timed stop, parry with trooper and neutral waves live, one secured orb from each source, joint goal cleanup, options reset preserves final score, fresh connection')
    }
  })
}
