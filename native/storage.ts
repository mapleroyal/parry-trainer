import { persist, sequence, type Player } from 'modlock'
import { resetCharacterSession } from '../character'
import { resetTraining } from '../gameplay'
import { session } from '../session'
import { applyConfiguration, settingsSnapshot } from '../trainer-settings'
import { attachTrainerDocument, parseTrainerDocument, saveConfiguration, unavailableLibrary } from '../trainer-store'
import { packTrainerDocument, readRecord, recordParts, recordUpdate } from './save-codec.js'

type Phase = 'loading' | 'ready' | 'offline' | 'importing'
interface StorageSession {
  player: Player
  owner: string
  initialSettings: string
  phase: Phase
  latest?: string
  pendingSince?: number
  sending?: boolean
  error?: string
}
let active: StorageSession | undefined
const accountError = 'Account storage is unavailable. You can train with temporary settings or reconnect your account.'
const writeError = 'Changes are only in this session. Use Save settings again to retry.'
const capacityError = 'The account library is full. Export a backup and remove older entries.'

export function nativeStorageLoading(): boolean { return !active || active.phase === 'loading' || active.phase === 'importing' }
export function nativeStorageUnavailableReason(): string {
  if (!active || active.phase === 'loading') return 'Loading your trainer settings…'
  return active.phase === 'importing' ? 'Importing your trainer backup…' : ''
}

function makeParts(raw: string): string[] | undefined {
  return recordParts(packTrainerDocument(JSON.parse(raw)))
}

function send(store: StorageSession, parts: string[], done: (ok: boolean) => void): void {
  // All operations are absolute sets in one record; sending the same document
  // after a timeout is idempotent, including empty fields left by removed entries.
  try {
    persist.update(store.player, 'trainer', recordUpdate(parts), {}, (record, error) => {
      if (active === store) done(!!record && !error)
    })
  } catch { if (active === store) done(false) }
}

function flush(store: StorageSession, parts?: string[]): void {
  const text = store.latest
  if (!text || store.sending || store.phase !== 'ready') return
  const encoded = parts ?? makeParts(text)
  if (!encoded) { store.error = capacityError; return }
  store.sending = true
  store.pendingSince ??= Date.now()
  send(store, encoded, ok => {
    store.sending = false
    if (store.latest === text) store.pendingSince = undefined
    if (store.latest !== text) {
      // A more recent edit is already waiting. It contains the full document.
      flush(store)
    } else if (ok) {
      store.latest = undefined
      store.error = undefined
    } else store.error = writeError
  })
}

function queue(store: StorageSession, raw: string): boolean {
  if (active !== store || store.phase !== 'ready') return false
  const parts = makeParts(raw)
  if (!parts) { store.error = capacityError; return false }
  store.latest = raw
  store.error = undefined
  flush(store, parts)
  return true
}

export function closeNativeStorage(): void {
  active = undefined
  attachTrainerDocument('', undefined, () => false)
}

export function openNativeStorage(player: Player): void {
  closeNativeStorage()
  resetTraining()
  applyConfiguration('')
  const identity = player.connection()?.steamId ?? 0n
  const store: StorageSession = { player, owner: identity > 0n ? String(identity) : '', initialSettings: settingsSnapshot(), phase: 'loading' }
  active = store
  readAccount(store, false)
}

function readAccount(store: StorageSession, retry: boolean): void {
  const { player } = store
  function offline() {
    store.phase = 'offline'
    store.error = accountError
    attachTrainerDocument('', undefined, () => false)
  }
  if (!store.owner) { offline(); return }
  store.phase = 'loading'
  // getMany starts a fresh request. get still returns the cached result until
  // its response arrives, including an older failure on the same connection.
  let previous: ReturnType<typeof persist.get> | undefined
  if (retry) {
    try {
      previous = persist.get(player, 'trainer')
      persist.getMany([player], 'trainer')
    } catch { offline(); return }
  }
  sequence(attempt => {
    if (active !== store) return
    let raw: string | undefined
    try {
      const read = persist.get(player, 'trainer')
      if (read === previous || read.state === 'loading') {
        if (attempt < 81) return 0.15
        offline()
        return
      }
      if (read.state === 'unavailable') { offline(); return }
      try { raw = readRecord(read.record) }
      catch { raw = '' } // Preserve a damaged record until an explicit recovery import.
    } catch { offline(); return }
    const live = settingsSnapshot()
    const keepSession = retry && (live !== store.initialSettings || session.phase === 'running' || session.phase === 'countdown')
    store.phase = 'ready'
    store.error = undefined
    store.latest = undefined
    const settings = attachTrainerDocument(store.owner, raw, text => queue(store, text))
    if (!keepSession) applyConfiguration(settings)
    else if (live !== settings && !unavailableLibrary()) {
      store.error = 'Your library is connected. Save these session settings to use them next time.'
    }
  })
}

export function retryNativeSave(): void {
  const store = active
  if (store?.phase === 'offline') { readAccount(store, true); return }
  if (store?.phase !== 'ready' || store.sending) return
  // A failed size check can leave newer settings in gameplay than in the store.
  const settings = settingsSnapshot()
  if (!saveConfiguration(settings)) return
  if (store.error === capacityError && !store.latest) store.error = undefined
  if (store.latest) {
    store.error = undefined
    flush(store)
  }
}

export function nativeBackupAvailable(player: Player, writing: boolean): boolean {
  const store = active
  return store?.player === player && store.phase === 'ready' &&
    (writing ? !store.sending : !unavailableLibrary())
}

/** backupProblem checks an import without changing settings or saved entries. */
export function backupProblem(raw: string): string | undefined {
  const data = parseTrainerDocument(raw)
  if (!data) return 'This is not a valid trainer backup. Your library was kept.'
  if (!makeParts(JSON.stringify(data))) return 'This backup exceeds account storage. Your library was kept.'
}

/** nativeLibraryStatus reports whether the owner can use or replace the library. */
export function nativeLibraryStatus(): { ready: boolean; busy: boolean; message: string; retry: boolean } {
  const store = active
  if (nativeStorageLoading()) return { ready: false, busy: true, message: nativeStorageUnavailableReason(), retry: false }
  const damaged = unavailableLibrary()
  return {
    ready: store?.phase === 'ready' && !damaged,
    busy: Boolean(store?.sending),
    message: store?.error ?? (damaged ? 'Saved entries unavailable. Import a backup to recover them.' :
      store?.pendingSince !== undefined && Date.now() - store.pendingSince >= 450 ? 'Saving to your account…' : ''),
    retry: !store?.sending && Boolean(store?.error && store.error !== capacityError),
  }
}

// Check and persist the entire import before changing the visible library or
// applying its settings. The caller holds session changes while this is pending.
export function importNativeDocument(player: Player, raw: string, done: (message: string, ok: boolean) => void): void {
  const store = active
  if (!store || !nativeBackupAvailable(player, true)) { done('Finish saving your changes before importing.', false); return }
  const data = parseTrainerDocument(raw)
  if (!data) { done('This is not a valid trainer backup. Your library was kept.', false); return }
  const text = JSON.stringify(data), parts = makeParts(text)
  if (!parts) { done('This backup exceeds Hyperline’s account storage limit. Your library was kept.', false); return }
  store.phase = 'importing'
  send(store, parts, ok => {
    if (!ok) {
      // A timeout can arrive after the backing service committed the record.
      // Never overwrite that unknown result; let a fresh connection read it.
      store.phase = 'offline'
      store.error = 'Could not confirm the import. Reconnect your account to check its saved library.'
      done(store.error, false)
      return
    }
    store.phase = 'ready'
    store.latest = undefined
    store.error = undefined
    const settings = attachTrainerDocument(store.owner, text, value => queue(store, value))
    resetCharacterSession()
    applyConfiguration(settings)
    done('Imported your trainer settings, drills and hero builds.', true)
  })
}
