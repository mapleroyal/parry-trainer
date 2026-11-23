// Modlock owns the account data. Only the private launcher can reach the portable backup.
import { log, readFile, sequence, writeFile } from 'modlock'

export const maxBackupBytes = 256 * 1024
// The launcher caps UTF-8 bytes, including player-entered names.
export function backupFits(raw: string): boolean {
  if (raw.length > maxBackupBytes) return false
  if (raw.length * 3 <= maxBackupBytes) return true
  let bytes = 0
  for (const c of raw) {
    const n = c.codePointAt(0)!
    bytes += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4
    if (bytes > maxBackupBytes) return false
  }
  return true
}
type Operation = 'export' | 'import'

function nextToken(): string | undefined {
  // A persisted serial makes both stale replies and old cleanup messages harmless
  // across account changes, server restarts, and interrupted operations.
  const key = 'backup-sequence.txt'
  const previous = readFile(key) ?? '0'
  if (!/^\d{1,20}$/.test(previous)) return
  const next = (BigInt(previous) + 1n).toString()
  if (next.length <= 20 && writeFile(key, next)) return next
}

export function transferBackup(operation: Operation, account: string, serializeBackup: () => string,
  importBackup: (raw: string) => boolean, done: (message: string) => void): void {
  if (!/^(local|[0-9]{1,20})$/.test(account)) { done('No trainer account is available.'); return }
  let token: string | undefined
  try { token = nextToken() } catch { /* The host may have lost its writable storage. */ }
  if (!token) { done('Could not start the backup transfer.'); return }
  const suffix = account + '-' + token + '.json'
  if (operation === 'export') {
    try {
      const data = serializeBackup()
      if (!data || !backupFits(data) || !writeFile('backup-export-' + suffix, data)) {
        done('Could not prepare the trainer data for export.')
        return
      }
    } catch {
      done('Could not prepare the trainer data for export.')
      return
    }
  }
  log('PARRY_TRAINER_BACKUP', operation, token, account)
  function finish(message: string) {
    log('PARRY_TRAINER_BACKUP_DONE', token, account)
    done(message)
  }
  sequence(attempt => {
    let result: string | undefined
    try { result = readFile('backup-reply-' + suffix) }
    catch { finish('Could not read the launcher response.'); return }
    if (result === undefined) {
      if (attempt < 51) return 0.2
      finish('The launcher did not respond to the backup request.')
      return
    }
    let message = 'The launcher returned an invalid backup response.'
    try {
      const reply = JSON.parse(result)
      if (reply?.token === token && reply.operation === operation) {
        if (reply.ok === false && typeof reply.error === 'string') message = reply.error
        if (reply.ok === true && typeof reply.path === 'string' && reply.path.length) {
          if (operation === 'export') message = 'Exported to ' + reply.path
          else {
            const data = readFile('backup-import-' + suffix)
            message = data && backupFits(data) && importBackup(data)
              ? 'Imported from ' + reply.path : 'Import failed. The trainer data was not replaced.'
          }
        }
      }
    } catch { message = 'The trainer could not read or apply the backup.' }
    finish(message)
  })
}
