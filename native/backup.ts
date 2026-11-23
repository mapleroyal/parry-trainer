// Portable backups pass through the player's own layout. A hosted lobby never
// chooses a path on the player's PC, and needs no launcher or host-local files.
import { route, type Player } from 'modlock'
import { session } from '../session'
import { settingsSnapshot } from '../trainer-settings'
import { exportTrainerData } from '../trainer-store'
import { importNativeDocument, nativeBackupAvailable } from './storage'
import { packTrainerDocument, unpackTrainerDocument } from './save-codec.js'

interface Transfer {
  player: Player
  id: number
  content: string
  kind: 'export' | 'import'
  total: number
  format?: 'packed' | 'json'
  committing?: boolean
  result?: { message: string; ok: boolean }
}
let transfer: Transfer | undefined
let revision = 0
export function resetNativeBackup(): void { transfer = undefined }

export function nativeBackupAction(player: Player, payload: unknown): void {
  if (!Array.isArray(payload)) return
  const [op, id, offset, value, total, format] = payload
  if (!Number.isSafeInteger(id) || id <= 0) return
  const send = (state: string, fields: object = {}) => route(player, 'backup', { id, state, revision: ++revision, ...fields })
  const fail = (message: string) => send('error', { message })
  const start = !transfer || transfer.id !== id || transfer.player !== player
  if (op === 'get') {
    if (!Number.isInteger(offset) || offset < 0) return
    if (start) {
      if (offset !== 0 || (transfer?.committing && !transfer.result) || !nativeBackupAvailable(player, false)) {
        fail('Your trainer data is unavailable for export.'); return
      }
      const content = packTrainerDocument(JSON.parse(exportTrainerData(settingsSnapshot())))
      transfer = { id, player, kind: 'export', content, total: content.length }
    }
    if (transfer?.kind !== 'export' || offset > transfer.total) return
    let end = Math.min(transfer.total, offset + 900)
    // Keep each route a well-formed Unicode string even at a fragment boundary.
    if (end < transfer.total && /[\uD800-\uDBFF]/.test(transfer.content.charAt(end - 1))) end--
    send('text', { offset, text: transfer.content.slice(offset, end), total: transfer.total })
    return
  }
  if (op !== 'put' || !Number.isInteger(offset) || offset < 0 || typeof value !== 'string' || !value ||
      value.length > 155 || !Number.isInteger(total) || total < 1 || total > 16384 ||
      (format !== 'packed' && format !== 'json')) return
  if (start) {
    if (offset !== 0 || !nativeBackupAvailable(player, true)) {
      fail('Wait for account storage to finish before importing.'); return
    }
    transfer = { id, player, kind: 'import', content: '', total, format }
  }
  const receiving = transfer
  if (!receiving || receiving.kind !== 'import' || receiving.total !== total || receiving.format !== format) return
  if (receiving.result) { send(receiving.result.ok ? 'done' : 'error', { message: receiving.result.message }); return }
  if (receiving.committing) { send('saving'); return }
  if (session.phase === 'countdown' || session.phase === 'running') { fail('End your session before importing a backup.'); return }
  if (offset === receiving.content.length && offset + value.length <= total) receiving.content += value
  if (receiving.content.length < total) { send('next', { offset: receiving.content.length }); return }
  let raw
  try { raw = format === 'packed' ? unpackTrainerDocument(receiving.content) : receiving.content }
  catch { fail('This backup could not be read. Your library was kept.'); return }
  receiving.committing = true
  send('saving')
  importNativeDocument(player, raw, (message, ok) => {
    if (transfer !== receiving) return
    receiving.result = { message, ok }
    send(ok ? 'done' : 'error', { message })
  })
}
