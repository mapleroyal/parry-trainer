import { command, log } from 'modlock'
import { currentInterface } from '../native/main'

/** register adds screenshot navigation to this local probe build only. */
export default function register(): void {
  command('trainer_preview', (player, name) => {
    const view = currentInterface()
    if (view?.player.slot !== player.slot) return

    // Route each fixture to the same panels and handlers as an ordinary session.
    switch (name) {
      case 'session': view.preview('Session'); break
      case 'hero': view.preview('My hero'); break
      case 'opponents': view.preview('Opponents'); break
      case 'creeps': view.preview('Creeps'); break
      case 'drills': view.preview('Saved', 'Drills'); break
      case 'builds': view.preview('Saved', 'Hero builds'); break
      case 'backups': view.preview('Saved', 'Backups'); break
      case 'templates': view.preview('Templates'); break
      case 'score': view.preview('Score'); break
      default: return
    }
    log('PARRY TRAINER PREVIEW', name)
  })
}
