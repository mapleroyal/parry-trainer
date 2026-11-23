import { modifierState, onAbilityCast, onParry, type Pawn } from 'modlock'

export type ParryGuard = Readonly<{ caught: boolean }>

/** Each executed cast owns one native guard window, including multi-opponent catches. */
export class ParryAttempts {
  private run: number | undefined
  private entity = 0
  private current?: { caught: boolean; scoreWhiff: boolean }
  private completed = 0

  get guard(): ParryGuard | undefined { return this.current }

  constructor(private readonly eligibleRun: () => number | undefined, traineeEntity: () => number,
              private readonly scoreWhiff = () => true) {
    onAbilityCast(cast => {
      if (cast.name !== 'citadel_ability_melee_parry' || cast.caster !== traineeEntity()) return
      const run = this.eligibleRun()
      if (run === undefined) return
      if (this.run !== run || this.entity !== cast.caster) {
        this.clear()
        this.run = run
        this.entity = cast.caster
      }
      // With Sandbox cooldowns off, the next cast can start on the very tick
      // the last window expires. PARRY_ACTIVE stays true across both attempts.
      this.finishGuard()
      this.current = { caught: false, scoreWhiff: this.scoreWhiff() }
    })
    onParry(catchEvent => {
      if (this.current && this.entity === catchEvent.parrier) this.current.caught = true
    })
  }

  clear(): void {
    this.run = undefined
    this.entity = 0
    this.current = undefined
    this.completed = 0
  }

  private finishGuard(): void {
    if (this.current?.scoreWhiff && !this.current.caught) this.completed++
    this.current = undefined
  }

  /** Settle before checking for run completion. No outstanding window crosses runs or pawns. */
  update(pawn: Pawn | undefined): number {
    if (this.run === undefined) return 0
    if (this.run !== this.eligibleRun() || pawn?.entity !== this.entity) {
      this.clear()
      return 0
    }
    if (!this.scoreWhiff()) {
      if (this.current) this.current.scoreWhiff = false
      this.completed = 0
    }
    if (this.current && (pawn.health <= 0 || !modifierState(this.entity, 'MODIFIER_STATE_PARRY_ACTIVE'))) this.finishGuard()
    const count = this.completed
    this.completed = 0
    return count
  }
}
