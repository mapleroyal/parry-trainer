import { writeField, type Pawn, type Player } from 'modlock'
import type { ParryGuard } from './parry-attempt'

// One trainee practices at a time. Use game time and actual 3D velocity:
// jumping counts as movement, turning in place and arena recentering do not.
class StationaryDrain {
  enabled = false
  private rate = 25
  private lastTick: number | undefined
  private fraction = 0
  private guard?: ParryGuard
  private deferred = 0

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.reset()
  }

  setRate(percent: number): void {
    if (Number.isFinite(percent)) this.rate = Math.max(15, Math.min(50, percent))
  }

  reset(): void {
    this.lastTick = undefined
    this.fraction = 0
    this.guard = undefined
    this.deferred = 0
  }

  private settleGuard(): void {
    if (!this.guard?.caught) this.fraction += this.deferred
    this.guard = undefined
    this.deferred = 0
  }

  // Return the HP actually removed. Losing all remaining HP is a successful kill.
  tick(player: Player, pawn: Pawn, now: number, guard?: ParryGuard): number {
    if (!this.enabled) return 0
    const { x, y, z } = pawn.velocity
    // Charge only intervals between still samples. A single slow tick at the
    // apex of a jump costs nothing. Ignore ground jitter under 5 cm/s.
    const still = Math.hypot(x, y, z) <= 2
    const elapsed = still ? Math.max(0, now - (this.lastTick ?? now)) : 0
    this.lastTick = still ? now : undefined
    const cost = (pawn.effectiveMaxHealth ?? pawn.maxHealth) * this.rate / 100 * elapsed
    // With cooldowns disabled a second cast can replace the first without an
    // inactive frame. Settle the first independently before charging the next.
    if (guard && this.guard !== guard) {
      this.settleGuard()
      this.guard = guard
    }
    if (this.guard) {
      this.deferred += cost
      // The elapsed interval ending on the expiry tick still belongs to that guard.
      if (!guard) this.settleGuard()
    } else this.fraction += cost
    const drain = Math.floor(this.fraction)
    if (!drain) return 0
    // This opt-in health cost can kill even when Sandbox protects against combat.
    if (drain >= pawn.health) {
      if (!player.kill()) return 0
      this.fraction = 0
      return pawn.health
    }
    // This is a percentage health cost, independent of damage resistance and shields.
    if (!writeField(pawn.entity, 'CBaseEntity', 'm_iHealth', 'int32', pawn.health - drain)) return 0
    this.fraction -= drain
    return drain
  }
}

export const stationaryDrain = new StationaryDrain()
