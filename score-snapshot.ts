import type { PracticeSession } from './session'
import type { soulStats } from './waves'

// These names are also the label IDs read by the Panorama score panel.
export function scoreFields(run: PracticeSession, souls: ReturnType<typeof soulStats>, now: number, settings: string,
                               character?: Record<string, string | number>): Record<string, string | number> {
  const goal = run.limit.mode === 'goal' ? run.limit : undefined
  return {
    SessionRun: run.runId,
    SessionPhase: run.phase,
    SessionMode: run.limit.mode,
    SessionRemaining: run.remaining(now),
    SessionTimerTarget: run.limit.mode === 'timer' ? run.limit.value : 0,
    SessionElapsed: run.elapsed(now),
    SessionEndReason: run.reason ?? 'none',
    SessionDeathCause: run.reason === 'death' ? run.deathCause ?? 'other' : '',
    SessionRespawnMs: run.phase === 'running' ? Math.max(0, Math.round((run.respawnAt - now) * 1000)) : 0,
    SessionRulesChanged: Number(run.rulesChanged),
    SessionFailOnDeath: Number(run.failOnDeath),
    SessionGoal: goal?.parries ?? 0,
    SessionSoulGoal: goal?.souls ?? 0,
    SessionSouls: run.soulScore(souls.troopers.secured + souls.camps.secured),
    SessionSoulsDeducted: run.soulsDeducted,
    SessionHeavies: run.heavy,
    SessionParries: run.parries,
    SessionHits: run.hits,
    SessionBulletsFired: run.bulletsFired,
    SessionBulletsHit: run.bulletsHit,
    SessionDamageTaken: run.damageTaken,
    SessionDeaths: run.deaths,
    SessionHitLimit: run.hitLimit,
    LaneSecured: souls.troopers.secured,
    LaneMissed: souls.troopers.missed,
    LaneKills: souls.troopers.kills,
    CampSecured: souls.camps.secured,
    CampMissed: souls.camps.missed,
    CampKills: souls.camps.kills,
    TrainerSettings: settings,
    ...character,
  }
}

export function serializeScore(...args: Parameters<typeof scoreFields>): string {
  return JSON.stringify(scoreFields(...args))
}
