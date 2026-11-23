// The server's simulation clock controls countdowns, deadlines, and scored play.
export type SessionLimit =
  | { mode: 'none' }
  | { mode: 'timer'; value: number }
  | { mode: 'goal'; parries: number; souls: number }
type Phase = 'ready' | 'countdown' | 'running' | 'finished'
export type DeathCause = 'standing-drain' | 'other'
type EndReason = 'time' | 'goal' | 'stopped' | 'death' | 'hits'

export function parseLimit(line: string): SessionLimit | undefined {
  const [mode, ...args] = line.trim().split(/\s+/)
  if (mode === 'none' && !args.length) return { mode }
  if (mode === 'timer' && args.length === 1 && /^[1-9]\d{0,4}$/.test(args[0])) {
    const value = Number(args[0])
    if (value <= 86400) return { mode, value }
  }
  if (mode === 'goal' && (args.length === 1 || args.length === 2) &&
      args.every(arg => /^(0|[1-9]\d{0,3})$/.test(arg))) {
    // One argument is the original parry-only command. A zero target is disabled.
    const [parries, souls = 0] = args.map(Number)
    if (parries || souls) return { mode, parries, souls }
  }
}

export class PracticeSession {
  runId = 0
  phase: Phase = 'ready'
  limit: SessionLimit = { mode: 'none' }
  reason: EndReason | undefined
  heavy = 0
  parries = 0
  hits = 0
  bulletsFired = 0
  bulletsHit = 0
  private bulletOwner = 0
  private bulletsInFlight = 0
  private unscoredInFlight = 0
  private creditedInFlight = 0
  damageTaken = 0
  deaths = 0
  deathCause: DeathCause | undefined
  respawnAt = 0
  rulesChanged = false
  failOnDeath = false // This live rule persists between runs until the setting changes.
  soulsDeducted = 0
  hitLimit = 0 // Zero disables this loss condition for the run.
  private startAt = 0
  private stoppedAt = 0
  private hitLimitAt: number | undefined

  get settlingHit(): boolean { return this.hitLimitAt !== undefined && this.phase === 'running' }

  reset(): void {
    this.phase = 'ready'
    this.reason = undefined
    this.deathCause = undefined
    this.respawnAt = 0
    this.rulesChanged = false
    this.limit = { mode: 'none' }
    this.heavy = this.parries = this.hits = this.hitLimit = 0
    this.bulletsFired = this.bulletsHit = this.creditedInFlight = 0
    this.unscoredInFlight = this.bulletsInFlight
    this.damageTaken = this.deaths = this.soulsDeducted = 0
    this.startAt = this.stoppedAt = 0
    this.hitLimitAt = undefined
  }

  begin(limit: SessionLimit, now: number, hitLimit = 0): boolean {
    if (this.phase === 'running' || this.phase === 'countdown') return false
    this.reset()
    this.runId++
    this.phase = 'countdown'
    this.limit = limit
    this.hitLimit = hitLimit
    this.startAt = now + 3
    return true
  }

  restoreUnlimitedRules(): void {
    if (this.phase !== 'countdown' && this.phase !== 'running') return
    if (this.phase === 'running' && (this.limit.mode !== 'none' || this.hitLimit > 0)) this.rulesChanged = true
    this.limit = { mode: 'none' }
    this.hitLimit = 0
    this.hitLimitAt = undefined
  }

  setBulletOwner(pawn: number): void {
    if (this.bulletOwner === pawn) return
    this.bulletOwner = pawn
    this.bulletsInFlight = this.unscoredInFlight = this.creditedInFlight = 0
  }

  bulletFired(): void {
    this.bulletsInFlight++
    if (this.phase === 'running') this.bulletsFired++
    else this.unscoredInFlight++
  }

  bulletHitTarget(): void {
    if (this.phase !== 'running' || this.creditedInFlight >= this.bulletsInFlight) return
    // Modlock supplies contacts without projectile IDs. Reserve contact credit
    // for pre-session bullets first when their flight overlaps scored fire.
    if (++this.creditedInFlight > this.unscoredInFlight) this.bulletsHit++
  }

  bulletRemoved(): void {
    if (!this.bulletsInFlight) return
    this.bulletsInFlight--
    if (this.unscoredInFlight) this.unscoredInFlight--
    if (this.creditedInFlight) this.creditedInFlight--
  }

  recordDeath(cause: DeathCause, respawnAt: number): boolean {
    // A native kill notification can follow the trainer's immediately lethal drain.
    if (this.phase !== 'running' || this.respawnAt) return false
    this.deaths++
    this.deathCause = cause
    this.respawnAt = respawnAt
    return true
  }

  recordRespawn(): void {
    if (!this.respawnAt) return // A finished run keeps its terminal cause.
    this.respawnAt = 0
    this.deathCause = undefined
  }

  finish(reason: EndReason, now: number): void {
    if (this.phase !== 'running' && this.phase !== 'countdown') return
    if (this.phase === 'countdown') this.startAt = now
    this.reason = reason
    this.respawnAt = 0
    if (reason !== 'death') this.deathCause = undefined
    this.phase = 'finished'
    this.stoppedAt = now
  }

  soulScore(collected: number): number {
    return Math.max(0, collected - this.soulsDeducted)
  }

  deductSouls(collected: number, cost: number): number {
    const spent = Math.min(this.soulScore(collected), cost)
    this.soulsDeducted += spent
    return spent
  }

  tick(now: number, securedSouls: number, deathLoss = false): void {
    if (this.phase === 'countdown' && now >= this.startAt) {
      this.phase = 'running'
      this.startAt = now
    }
    if (this.phase !== 'running') return
    if (deathLoss) {
      this.finish('death', this.hitLimitAt ?? now)
      return
    }
    if (this.hitLimit > 0 && this.hits >= this.hitLimit) {
      // Deadlock reports melee contact one simulation tick before applying its
      // damage. Keep the last swing alive for its kill or parry callback.
      if (this.hitLimitAt === undefined) this.hitLimitAt = now
      else if (now > this.hitLimitAt) this.finish('hits', this.hitLimitAt)
      return
    }
    this.hitLimitAt = undefined
    if (this.limit.mode === 'timer' && now >= this.startAt + this.limit.value) this.finish('time', now)
    else if (this.limit.mode === 'goal' && this.parries >= this.limit.parries && this.soulScore(securedSouls) >= this.limit.souls)
      this.finish('goal', now)
  }

  elapsed(now: number): number {
    if (this.phase !== 'running' && this.phase !== 'finished') return 0
    const end = this.phase === 'finished' ? this.stoppedAt : now
    return Math.max(0, Math.floor(end - this.startAt))
  }

  remaining(now: number): number {
    if (this.phase === 'countdown') return Math.max(0, Math.ceil(this.startAt - now))
    if (this.limit.mode !== 'timer') return 0
    return Math.max(0, this.limit.value - this.elapsed(now))
  }
}

export const session = new PracticeSession()
