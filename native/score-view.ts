import type { Child, Style } from 'modlock'
import type { scoreFields } from '../score-snapshot'
import { jsx } from 'modlock'
import { clock, column, heading, note, palette, row, text } from './ui'

type Score = ReturnType<typeof scoreFields>
const number = (score: Score, key: string) => Number(score[key] ?? 0)
const pct = (hit: number, total: number) => total ? `${Math.round(100 * hit / total)}%` : '—'
const bannerStyle: Style = { horizontalAlign: 'center', verticalAlign: 'center', fontSize: 54,
  bold: true, background: palette.plate, padding: [12, 34], borderRadius: 7 }

/** arenaHud displays only the counters and feedback the player needs during a drill. */
export function arenaHud(score: Score, draining: boolean, banner: boolean): Child {
  const phase = score.SessionPhase
  const count = (key: string) => number(score, key)
  const stat = (label: string, value: string) => column([note(label), text(value, { bold: true, fontSize: 20 })], { margin: [0, 13] }, label)
  return jsx('panel', { style: { width: '100%', height: '100%' }, children: [
    phase === 'ready' && text('Tab · Parry Trainer', { horizontalAlign: 'center', y: 18, color: palette.quiet, fontSize: 16 }),
    phase === 'countdown' && text(`${count('SessionRemaining') || 'GO'}`, bannerStyle),
    phase === 'running' && row([
      stat(score.SessionMode === 'timer' ? 'Time left' : 'Elapsed', clock(count(score.SessionMode === 'timer' ? 'SessionRemaining' : 'SessionElapsed'))),
      stat('Parries', `${score.SessionParries}/${score.SessionHeavies} · ${score.SessionHits} hit`),
      stat('Trooper souls', `${score.LaneSecured} secured · ${score.LaneMissed} missed`),
      stat('Camp souls', `${score.CampSecured} secured · ${score.CampMissed} missed`),
    ], { horizontalAlign: 'center', y: 18 }),
    draining && text('Move to stop the health drain', { horizontalAlign: 'center', verticalAlign: 'center', y: 85, color: palette.red, bold: true }),
    banner && text(outcome(score), { ...bannerStyle, color: outcome(score) === 'Victory' ? palette.green : palette.red }),
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
