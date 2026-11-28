// Keep the portable format bounded before parsing or storing the whole record.
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
