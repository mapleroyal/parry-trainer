// Measure real movement and health in the arena with unrelated damage isolated.
import { addBot, Buttons, holdModifierState, log, onFrame, onKill, onSpawn, players, serverCommand, type Player } from 'modlock'
import { beginTraining, stopTraining, testSubject } from '../gameplay'
import { session } from '../session'
import { changeSetting, resetSettings } from '../trainer-settings'

export default function registerStationaryProbe(): void {
  let active = true, started = -1, since = 0, hp = 0, max = 0, x = 0, kills = 0
  let phase: 'ready' | 'countdown' | 'standing' | 'slow' | 'jumping' | 'drain' | 'running' |
    'depletion' | 'respawn' | 'landing' | 'fast' | 'fatal' | 'finished' | 'off' = 'ready'
  let trainee: Player | undefined
  let previousHp = 0, observedLoss = 0
  const forward = { pitch: 0, yaw: 0, roll: 0 }
  // Stop unrelated melee casts. Blocking damage later still causes Deadlock
  // to report the would-be hit in its native post-damage event.
  onSpawn((player, pawn) => {
    if (player.connection()?.name.startsWith('Trainer opponent ')) holdModifierState(pawn.entity, 'MODIFIER_STATE_MELEE_DISABLED')
  })
  onKill(hit => { if (active && hit.victimPlayer.slot === trainee?.slot) kills++ })
  function finish(ok: boolean, why: string): void {
    active = false
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'stationary', why, phase, session.phase, session.reason ?? 'none', kills)
    stopTraining()
    serverCommand('quit')
  }
  onFrame(({ timeSeconds: now }) => {
    if (!active) return
    if (started < 0) started = now
    if (now - started > 30) { finish(false, 'timeout'); return }
    if (!trainee) {
      trainee = addBot({ name: 'Movement trainee', team: 2, hero: 'hero_wraith' })
      if (trainee) testSubject(trainee, undefined, false)
      return
    }
    const pawn = trainee.pawn()
    if (!pawn?.hero) return
    observedLoss += Math.max(0, previousHp - Math.max(0, pawn.health))
    previousHp = Math.max(0, pawn.health)
    switch (phase) {
      case 'ready':
        if (!max) {
          // Start the bot through the same Normal defaults as the human Reset button.
          resetSettings()
          changeSetting('hero1', 'hero_wraith')
          max = pawn.effectiveMaxHealth ?? pawn.maxHealth
          since = now
        }
        if (now - since > 0.5) {
          if (pawn.health < max) { finish(false, 'damaged in setup'); return }
          if (beginTraining({ mode: 'timer', value: 60 })) phase = 'countdown'
        }
        break
      case 'countdown':
        if (pawn.health < max - 2) { finish(false, 'damaged in countdown'); return }
        if (session.phase === 'running') {
          changeSetting('idle_rate', '25') // Current value.
          changeSetting('hero1', 'hero_wraith') // Current opponent.
          changeSetting('timer', '90') // For the next run.
          changeSetting('hit_limit', '9') // Also captured at Begin.
          changeSetting('preset', '70') // Rejected while running.
          if (session.rulesChanged) { finish(false, 'unchanged, pending or rejected setting marked the run'); return }
          hp = pawn.health; since = now; phase = 'standing'
        }
        break
      case 'standing':
        if (now - since < 1) return
        if (Math.abs((hp - pawn.health) / max - 0.25 * (now - since)) > 0.025) {
          finish(false, 'expected 25 percent per stationary second'); return
        }
        changeSetting('idle_rate', '15')
        hp = pawn.health; since = now; phase = 'slow'
        break
      case 'slow':
        if (now - since < 1) return
        if (Math.abs((hp - pawn.health) / max - 0.15 * (now - since)) > 0.025) {
          finish(false, 'expected 15 percent after changing rate'); return
        }
        trainee.press(Buttons.jump)
        hp = pawn.health; since = now; phase = 'jumping'
        break
      case 'jumping':
        if (now - since < 0.18 || pawn.velocity.z < 20) return
        if (pawn.health < hp - max * 0.025) { finish(false, 'drained during vertical movement'); return }
        phase = 'drain'
        break
      case 'drain':
        if (pawn.health > max * 0.43) return
        trainee.drive({ facing: forward, forward: 1, left: 0, held: 0n, pressed: 0n })
        hp = pawn.health; x = pawn.position.x; since = now; phase = 'running'
        break
      case 'running':
        trainee.drive({ facing: forward, forward: 1, left: 0, held: 0n, pressed: 0n })
        if (now - since < 0.8) return
        if (pawn.position.x - x < 80 || Math.abs(pawn.health - hp) > max * 0.04) {
          finish(false, 'movement did not pause drain at low health'); return
        }
        trainee.drive({ facing: forward, forward: 0, left: 0, held: 0n, pressed: 0n })
        phase = 'depletion'
        break
      case 'depletion':
        if (session.phase !== 'running') { finish(false, 'death ended the run with its loss condition off'); return }
        if (pawn.health > 0) return
        since = now
        phase = 'respawn'
        break
      case 'respawn':
        if (pawn.health <= 0) return
        if (kills !== 1 || pawn.health < max - 2 || now - since < 1.4 || now - since > 1.8 ||
            session.phase !== 'running' || session.reason || session.remaining(now) >= 55) {
          finish(false, 'expected full-health native respawn during the same running timer'); return
        }
        changeSetting('idle_rate', '50')
        changeSetting('fail_on_death', '1')
        phase = 'landing'
        break
      case 'landing':
        // The native respawn drops the hero a few units. Start measuring the
        // stationary rate once the landing actually starts costing health.
        if (pawn.health >= max) return
        since = now; hp = pawn.health; phase = 'fast'
        break
      case 'fast':
        if (now - since < 0.7) return
        if (Math.abs((hp - pawn.health) / max - 0.5 * (now - since)) > 0.045) {
          finish(false, 'expected 50 percent and no charge for dead time'); return
        }
        phase = 'fatal'
        break
      case 'fatal':
        if (session.phase !== 'finished') return
        if (session.reason !== 'death' || session.deathCause !== 'standing-drain' || !session.rulesChanged || session.respawnAt || pawn.health > 0) { finish(false, 'lethal drain must count as death'); return }
        phase = 'finished'
        break
      case 'finished':
        if (pawn.health <= 0 || players().some(p => p.name === 'Trainer opponent 1')) return
        // Native regeneration between samples can cover a small part of a drain.
        if (kills !== 2 || session.deaths !== 2 || session.reason !== 'death' ||
            Math.abs(session.damageTaken - observedLoss) > max * 0.04) {
          finish(false, 'scored ' + session.damageTaken + ' HP, observed ' + observedLoss); return
        }
        changeSetting('idle_drain', '0')
        if (beginTraining({ mode: 'timer', value: 1 })) phase = 'off'
        break
      case 'off':
        if (session.phase === 'finished') finish(session.reason === 'time' && !session.rulesChanged && !session.deathCause && pawn.health === max && !session.damageTaken && !session.deaths,
          '15/25/50% drain, jump/run, protected combat with drain deaths, respawn in same run, death loss, off')
    }
  })
}
