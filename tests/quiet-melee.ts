// Equip the live retail roster's real weapons. This catches renamed slot-22
// abilities and aliases that the engine cannot grant to a particular hero.
import { addBot, heroes, log, onFrame, serverCommand, type Player } from 'modlock'
import { quietMeleeFor } from '../native/quiet-melee'

export default function registerQuietMeleeProbe(): void {
  let index = 0, subject: Player | undefined, started = -1, nextAt = 0, done = false
  function finish(ok: boolean, details: string): void {
    done = true
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'quiet-melee', details)
    serverCommand('quit')
  }
  onFrame(({ timeSeconds: now }) => {
    if (done || now < nextAt) return
    if (started < 0) started = now
    const hero = heroes[index]
    if (!hero) { finish(true, 'equipped and restored all ' + index + ' released hero melee weapons'); return }
    if (now - started > 90) { finish(false, 'timeout equipping ' + hero.name); return }
    if (!subject) {
      subject = addBot({ name: 'Weapon test', hero: hero.name, team: 2 })
      return
    }
    if (subject.pawn()?.hero !== hero.id) return
    const equipped = () => subject?.abilities().find(ability => ability.slot === 22)?.name
    const original = equipped()
    if (!original) return
    const quiet = quietMeleeFor(original)
    if (!quiet || (quiet !== original && !subject.replaceAbility(22, quiet, true)) || equipped() !== quiet ||
        (quiet !== original && !subject.replaceAbility(22, original, true)) || equipped() !== original) {
      finish(false, hero.name + ' ' + original + ' -> ' + quiet + ' -> ' + equipped())
      return
    }
    if (!subject.removeBot()) { finish(false, 'could not retire ' + hero.name); return }
    subject = undefined
    nextAt = now + 0.25
    index++
  })
}
