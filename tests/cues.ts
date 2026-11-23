import {
  addBot, entityPosition, findEntities, log, modifierState, onFrame, onMelee, readField,
  serverCommand, type Player, type Vector,
} from 'modlock'
import { setMeleeDistances, testSubject } from '../gameplay'
import { lungeDust, setMeleeCues, type ClientAssets } from '../particles'

// Check both same-hero weapons and the native particle actually emitted along
// the lunge. The quiet attacks bracket a visible one at maximum separation.
export default function registerCuesProbe(assets: ClientAssets = 'private'): void {
  let active = true
  let started = -1
  let swings = 0
  let subject: Player | undefined
  const stock = 'citadel_ability_melee_wraith'
  let first: Vector | undefined
  let travelled = 0
  let visibleEmitter = 0
  function finish(ok: boolean, detail: string): void {
    active = false
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'cues', detail)
    serverCommand('quit')
  }
  onFrame(({ timeSeconds: t }) => {
    if (!active) return
    if (started < 0) { started = t; setMeleeDistances(100, 100, 50) }
    if (t - started > 30) { finish(false, 'timed out before three native heavies'); return }
    if (!subject) {
      subject = addBot({ name: 'Particle trainee', team: 2, hero: 'hero_wraith' })
      if (subject) testSubject(subject)
      return
    }
    for (const entity of findEntities('info_particle_system')) {
      if (readField(entity, 'CParticleSystem', 'm_iszEffectName', 'string') !== lungeDust ||
          !readField(entity, 'CParticleSystem', 'm_bActive', 'bool')) continue
      // Following through after the visible swing may still complete its end cap.
      if (swings !== 1) {
        if (entity !== visibleEmitter) { finish(false, 'quiet attack spawned new dust'); return }
        continue
      }
      visibleEmitter = entity
      const pos = entityPosition(entity)?.position
      if (!pos) continue
      first ??= pos
      travelled = Math.max(travelled, Math.hypot(pos.x - first.x, pos.y - first.y, pos.z - first.z))
    }
  })
  onMelee(swing => {
    if (!active || !subject || !swing.heavy || swing.attackerPlayer.slot === subject.slot) return
    const theirs = swing.attackerPlayer.abilities(), ours = subject.abilities()
    for (const [slot, name] of [[22, stock], [18, 'citadel_ability_sprint']] as const) {
      const actual = theirs.find(a => a.slot === slot)?.name
      if (ours.find(a => a.slot === slot)?.name !== name || actual !== (assets === 'stock' || swings === 1 ? name : 'parry_trainer_quiet_' + name)) {
        finish(false, 'incorrect melee or sprint for slot ' + slot + ', opponent had ' + actual)
        return
      }
    }
    if (assets === 'stock' && (!modifierState(swing.attacker, 'MODIFIER_STATE_DO_NOT_DRAW_MODEL') ||
        modifierState(swing.attacker, 'MODIFIER_STATE_INVISIBLE_TO_ENEMY') !== (swings !== 1) ||
        modifierState(swing.attacker, 'MODIFIER_STATE_DO_NOT_DRAW_PARTICLES') !== (swings !== 1))) {
      finish(false, 'incorrect opponent visibility states on swing ' + (swings + 1))
      return
    }
    if (++swings === 3) {
      finish(travelled >= 75, 'stock same-hero trainee, hidden / visible / hidden, dust travelled ' +
        Math.round(travelled) + ' units')
      return
    }
    setMeleeCues(swings === 1)
  })
}
