import { adjustSound, after, emitSound, stopSound, type Player, type Timer } from 'modlock'
import { session } from './session'

let lastRun = -1
let voice: { id: number; fade: Timer } | undefined

function silence(): void {
  if (!voice) return
  adjustSound(voice.id, 0)
  if (!voice.fade.finished) {
    voice.fade.cancel()
    stopSound(voice.id)
  }
  voice = undefined
}

export function handleResultAudio(player: Player, action: string): void {
  if (action === 'stop') { silence(); return }
  if (session.phase !== 'finished' || lastRun === session.runId) return
  const victory = session.reason === 'time' || session.reason === 'goal'
  const defeat = session.reason === 'hits' || session.reason === 'death'
  if (!((action === 'win' && victory) || (action === 'lose' && defeat))) return
  const pawn = player.pawn()
  if (!pawn) return
  silence()
  // Retail's Music.Match events are music-only, 2D, and use the UI voice layer.
  // Emit on the entity so the cue can begin while the trainee is still dead.
  const id = emitSound(pawn.entity, victory ? 'Music.Match.Win' : 'Music.Match.Lose', { listeners: [player.slot] })
  if (id === undefined) return
  lastRun = session.runId
  // The native stop fades over 0.5s. Allow 1.4s before the fade, for 1.9s total.
  voice = { id, fade: after(1.4, () => { stopSound(id) }) }
}
