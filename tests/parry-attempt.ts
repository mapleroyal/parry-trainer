// All inputs go to private bot heroes. Use two synchronized attackers so one
// real activation can catch two heavies without relying on encounter RNG.
import { addBot, Buttons, log, onAbilityCast, onFrame, onMelee, onParry, serverCommand, type Player } from 'modlock'
import { conceal, setFreeParry } from '../gameplay'
import { ParryAttempts } from '../parry-attempt'

type Trial = 'setup' | 'stock cooldown' | 'no cooldown' | 'start interrupted cast' | 'resume' |
  'unscored cast' | 'enable scoring' | 'wait for expiry' | 'unblocked' | 'double catch' | 'done'

export default function registerParryAttemptProbe(): void {
  let trainee: Player | undefined, left: Player | undefined, right: Player | undefined
  let entity = 0, run: number | undefined
  let casts = 0, whiffs = 0, contacts = 0, catches = 0
  let trial: Trial = 'setup'
  let started = -1, trialAt = 0, nextPress = 0, sentParry = false, placed = false
  const tracker = new ParryAttempts(() => run, () => entity)
  const zero = { x: 0, y: 0, z: 0 }
  function finish(ok: boolean, why: string): void {
    trial = 'done'
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'parry-attempt', why,
      'casts', casts, 'whiffs', whiffs, 'contacts', contacts, 'catches', catches)
    serverCommand('quit')
  }
  onAbilityCast(cast => { if (cast.caster === entity && cast.name === 'citadel_ability_melee_parry') casts++ })
  onMelee(swing => { if (swing.heavy && swing.hits.includes(entity)) contacts++ })
  onParry(event => { if (event.parrier === entity) catches++ })
  onFrame(({ timeSeconds: now }) => {
    if (trial === 'done') return
    if (started < 0) started = now
    if (now - started > 25) { finish(false, 'timeout during ' + trial); return }
    trainee ??= addBot({ name: 'Whiff trainee', hero: 'hero_wraith', team: 2 })
    left ??= addBot({ name: 'Whiff left', hero: 'hero_wraith', team: 3 })
    right ??= addBot({ name: 'Whiff right', hero: 'hero_wraith', team: 3 })
    const pawn = trainee?.pawn(), leftPawn = left?.pawn(), rightPawn = right?.pawn()
    if (!trainee || !left || !right || !pawn?.hero || !leftPawn?.hero || !rightPawn?.hero) return
    entity = pawn.entity
    whiffs += tracker.update(pawn)
    const age = now - trialAt
    function enter(next: Trial): void {
      trial = next
      trialAt = nextPress = now
      placed = false
    }
    function spam(): void {
      if (now >= nextPress) { trainee!.press(Buttons.parry); nextPress = now + 0.125 }
    }
    if (trial === 'setup') {
      if (now - started < 2) return
      conceal(leftPawn.entity); conceal(rightPawn.entity)
      setFreeParry(false)
      run = 1
      enter('stock cooldown')
    } else if (trial === 'stock cooldown') {
      if (age < 2) { spam(); return }
      if (casts !== 1 || whiffs !== 1 || contacts || catches) { finish(false, 'empty air or cooldown spam'); return }
      setFreeParry(true)
      trainee.refreshAbility('citadel_ability_melee_parry')
      enter('no cooldown')
    } else if (trial === 'no cooldown') {
      if (casts < 4) { spam(); return }
      if (whiffs < 4) return
      if (whiffs !== casts || contacts || catches) { finish(false, 'adjoining no-cooldown casts'); return }
      enter('start interrupted cast')
    } else if (trial === 'start interrupted cast') {
      if (casts === 4) { spam(); return }
      // The old run stops while the native parry is still active.
      run = undefined
      enter('resume')
    } else if (trial === 'resume') {
      if (age < 0.15) return
      run = 2
      enter('unscored cast')
    } else if (trial === 'unscored cast') {
      if (age < 1) return
      if (whiffs !== 4) { finish(false, 'pending window crossed a run boundary'); return }
      run = undefined
      trainee.press(Buttons.parry)
      enter('enable scoring')
    } else if (trial === 'enable scoring') {
      if (casts < 6) return
      // Enabling scoring partway through an unscored cast cannot arm it.
      run = 2
      enter('wait for expiry')
    } else if (trial === 'wait for expiry') {
      if (age < 1) return
      if (whiffs !== 4) { finish(false, 'mid-window enable charged an old cast'); return }
      enter('unblocked')
    } else {
      for (const [bot, direction] of [[left, -1], [right, 1]] as const) {
        const facing = { pitch: 0, yaw: direction === -1 ? 0 : 180, roll: 0 }
        if (!placed) bot.teleport({ x: pawn.position.x + direction * 50, y: pawn.position.y,
          z: pawn.position.z }, facing, zero)
        bot.drive({ facing, forward: 0, left: 0, held: age < 0.35 ? Buttons.melee : 0n,
          pressed: !placed ? Buttons.melee : 0n })
      }
      placed = true
      if (trial === 'double catch' && age >= 0.30 && !sentParry) sentParry = trainee.press(Buttons.parry)
      if (age < 1.6) return
      if (whiffs !== 4) { finish(false, trial + ' added a whiff'); return }
      if (trial === 'unblocked') {
        if (contacts !== 2 || catches) { finish(false, 'expected two actual unblocked contacts'); return }
        enter('double catch')
      } else finish(casts === 7 && catches === 2, 'one whiff per executed empty parry, zero for unopposed hits or a double catch')
    }
  })
}
