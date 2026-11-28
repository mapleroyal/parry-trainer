import type { Child, Style } from 'modlock'
import type { scoreFields } from '../score-snapshot'
import { jsx } from 'modlock'
import { clock, column, heading, note, palette, row, text } from './ui'

type Score = ReturnType<typeof scoreFields>
const number = (score: Score, key: string) => Number(score[key] ?? 0)
const pct = (hit: number, total: number) => total ? `${Math.round(100 * hit / total)}%` : '—'
const layer: Style = { width: '100%', height: '100%' }

/** ArenaState is what the arena layers show besides the score itself. */
export interface ArenaState {
  /** draining is whether the stationary drain is hurting the trainee. */
  draining: boolean
  /** banner is whether the victory or defeat wipe is up. */
  banner: boolean
  /** dead is whether the trainee's hero is down. */
  dead: boolean
  /** timer is the timer the player has set, or 0 without one, for the clock before a run. */
  timer: number
  /** penalties is whether any soul penalty is on. */
  penalties: boolean
}

/** goalProgress names each goal of a goal run with its progress. */
function goalProgress(score: Score): string {
  const parts: string[] = []
  const goal = number(score, 'SessionGoal'), souls = number(score, 'SessionSoulGoal')
  if (goal) parts.push(`${score.SessionParries}/${goal} ${goal === 1 ? 'parry' : 'parries'}`)
  if (souls) parts.push(`${score.SessionSouls}/${souls} ${souls === 1 ? 'soul' : 'souls'}`)
  return parts.join('  ·  ')
}

/** hudCall returns the bar's last column: its caption and call to action, or none. */
function hudCall(score: Score, state: ArenaState): { caption: string; text: string; key: boolean } | undefined {
  const phase = score.SessionPhase, goal = score.SessionMode === 'goal'
  if (phase === 'ready') return { caption: 'Training', text: 'to begin', key: true }
  if (phase === 'finished') {
    const failed: Record<string, string> = { death: 'Failed · You died', hits: 'Failed · Hit limit reached' }
    const why: Record<string, string> = { time: 'Time up', goal: 'Goal reached', stopped: 'Training ended' }
    const reason = String(score.SessionEndReason)
    return { caption: failed[reason] ?? why[reason] ?? 'Training complete', text: goal ? goalProgress(score) : 'to train again', key: !goal }
  }
  if (goal) return { caption: number(score, 'SessionGoal') && number(score, 'SessionSoulGoal') ? 'Goals' : 'Goal', text: goalProgress(score), key: false }
  if (phase === 'running' && state.penalties) return { caption: 'Net souls secured', text: String(score.SessionSouls), key: false }
  return undefined
}

/**
 * arenaHud draws the stat bar, the countdown, the result wipe and the drain
 * warning from the trainer's own layouts, which keep the game's fonts, art and
 * animations; the mod only sets their named panels.
 */
export function arenaHud(score: Score, state: ArenaState): Child {
  const phase = score.SessionPhase
  const count = (key: string) => number(score, key)
  // Before a run the clock shows the timer the player set; after it, the run's own.
  const timed = phase === 'ready' ? state.timer > 0 : score.SessionMode === 'timer'
  const seconds = phase === 'ready' ? state.timer : phase === 'countdown' ? (timed ? count('SessionTimerTarget') : 0)
    : timed ? count('SessionRemaining') : count('SessionElapsed')
  const recovering = phase === 'running' && state.dead && (count('SessionRespawnMs') > 0 || !count('SessionFailOnDeath'))
  const call = hudCall(score, state)
  const souls = (secured: string, missed: string) => `${score[secured]} secured · ${score[missed]} missed`
  const digit = phase === 'countdown' ? Math.min(3, count('SessionRemaining')) : 0
  const won = ['time', 'goal'].includes(String(score.SessionEndReason))
  return jsx('panel', { style: layer, children: [
    jsx('layout', { src: 'hud.xml', style: layer, bindings: {
      ParryTrainerClockCaption: { text: timed ? 'Time left' : 'Time elapsed' },
      ParryTrainerClock: { text: clock(seconds) },
      ParryTrainerHudRecovery: { visible: recovering },
      ParryTrainerHudParries: { text: `${score.SessionParries}/${score.SessionHeavies} · ${score.SessionHits} hits taken` },
      ParryTrainerHudLaneSouls: { text: souls('LaneSecured', 'LaneMissed') },
      ParryTrainerHudCampSouls: { text: souls('CampSecured', 'CampMissed') },
      ParryTrainerHudLimit: { visible: Boolean(call) },
      ParryTrainerHudCaption: { text: call?.caption ?? '' },
      ParryTrainerHudKey: { visible: Boolean(call?.key) },
      ParryTrainerHudText: { text: call?.text ?? '' },
    } }, 'hud'),
    // A new layout for each digit starts the game's shrinking animation again.
    digit > 0 && jsx('layout', { src: 'countdown.xml', style: layer, bindings: {
      PausedCountdownLabel: { text: String(digit), class: 'ShrinkCountdown' },
    } }, `countdown-${digit}`),
    state.banner && jsx('layout', { src: 'result.xml', style: layer, bindings: {
      // The trainee plays on Amber, and the game colors its wipe by the winning team.
      ParryTrainerResultVisual: { class: won ? 'MatchFinished Team1Victory' : 'MatchFinished Team2Victory' },
      ParryTrainerVictoryLabel: { visible: won },
      ParryTrainerDefeatLabel: { visible: !won },
    } }, `result-${score.SessionRun}`),
    jsx('layout', { src: 'drain.xml', style: layer, bindings: {
      cast_failed_box: { class: state.draining ? 'cast_failed' : '' },
    } }, 'drain'),
  ] }, 'arena-hud')
}

/** outcome names the scored result, not a visual effect in the retail HUD. */
function outcome(score: Score): string {
  if (score.SessionPhase === 'ready') return 'No session yet'
  if (score.SessionPhase === 'countdown') return 'Starting soon'
  if (score.SessionPhase === 'running') return 'In progress'
  if (score.SessionEndReason === 'stopped') return 'Session stopped'
  return ['time', 'goal'].includes(String(score.SessionEndReason)) ? 'Victory' : 'Defeat'
}

/** scorecard is shared by the Score tab and the automatic result recap. */
export function scorecard(score: Score): Child {
  const count = (key: string) => number(score, key)
  const metric = (label: string, value: string | number) => row([text(label, { width: 224, fontSize: 17 }),
    text(value, { color: palette.green, fontSize: 17 })], { padding: [4, 2] }, label)
  const reason: Record<string, string> = { death: score.SessionDeathCause === 'standing-drain' ? 'Standing still drained your remaining health.' : 'You died.',
    hits: 'Heavy hit limit reached.', time: 'Time limit reached.', goal: 'Training goals reached.', stopped: 'Ended manually.' }
  const fired = count('SessionBulletsFired'), hit = count('SessionBulletsHit')
  const combat = column([heading('Combat'), metric('Successful parries', score.SessionParries), metric('Incoming heavy melees', score.SessionHeavies),
    metric('Heavy hits taken', score.SessionHits), metric('Parry rate', pct(count('SessionParries'), count('SessionHeavies'))),
    metric('Bullet accuracy', fired ? `${pct(hit, fired)} · ${hit}/${fired}` : '—'),
    metric('Damage taken', `${Math.round(count('SessionDamageTaken'))} HP`), metric('Deaths', score.SessionDeaths)], { width: 380 })
  const souls = column([heading('Souls · Troopers / Camps'), metric('Secured', `${score.LaneSecured} / ${score.CampSecured}`),
    metric('Missed', `${score.LaneMissed} / ${score.CampMissed}`), metric('Creep kills', `${score.LaneKills} / ${score.CampKills}`),
    metric('Total collected', count('LaneSecured') + count('CampSecured')), metric('Deductions', score.SessionSoulsDeducted),
    metric('Net soul score', score.SessionSouls)], { width: 380 })
  return column([heading(outcome(score)), note(reason[String(score.SessionEndReason)] || (score.SessionPhase === 'ready' ? 'Begin a session to record a score.' : '')),
    score.SessionMode === 'timer' && note(`Timer target · ${clock(count('SessionTimerTarget'))}`),
    score.SessionMode === 'goal' && note(`Goals · ${score.SessionParries}/${score.SessionGoal} parries · ${score.SessionSouls}/${score.SessionSoulGoal} souls`),
    score.SessionPhase !== 'ready' && note(`Elapsed · ${clock(count('SessionElapsed'))}`),
    Boolean(score.SessionRulesChanged) && note('Rules changed during this session.'), row([combat, souls], { verticalAlign: 'top' })], { width: '100%' })
}
