import { persist, sequence, type Player } from 'modlock'
import { resetCharacterSession } from '../character'
import { resetTraining } from '../gameplay'
import { session } from '../session'
import { applyConfiguration, settingsSnapshot } from '../trainer-settings'
import { attachTrainerDocument, parseTrainerDocument, profiles, saveConfiguration, unavailableLibrary } from '../trainer-store'
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
const summaryKeys = new Set(['preset', 'version', 'limit_mode', 'timer', 'parries', 'souls', 'second'])

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

let cachedProfiles: ReturnType<typeof profiles> | undefined
let catalog = '[]'
function profileCatalog(): string {
  const current = profiles()
  if (current === cachedProfiles) return catalog
  cachedProfiles = current
  catalog = JSON.stringify(current.map(p => ({ id: String(p.id), name: p.name, hero: p.loadout?.hero || '',
    inventory: !!p.loadout?.items, abilities: !!p.loadout?.abilities, settings: p.settings !== undefined,
    items: p.loadout?.items?.length || 0, level: p.loadout?.abilities?.level || 0,
    drill: p.settings?.split(',').filter(field => summaryKeys.has(field.split('=')[0])).join(',') || '' })))
  return catalog
}

export function nativeScoreStorage(fields: Record<string, string | number>, includeProfiles: boolean): Record<string, string | number> {
  const store = active, result = { ...fields }
  delete result.ProfileAccount // The UI only needs its own rows.
  if (nativeStorageLoading()) result.StorageLoading = 1
  if (!store || store.phase === 'loading') {
    result.StartUnavailable = nativeStorageUnavailableReason()
    delete result.ProfileBusy
    delete result.ProfileList
    return result
  }
  if (store.phase === 'importing') result.StartUnavailable = nativeStorageUnavailableReason()
  if (store.phase === 'offline') result.SettingsSaveError = 'offline'
  else if (unavailableLibrary()) result.SettingsSaveError = 'damaged'
  else if (store.error) result.SettingsSaveError = store.error === capacityError ? 'capacity' : 'write'
  else if (store.phase === 'ready') result.SettingsSaveError = ''
  if (store.error) result.SettingsSaveMessage = store.error
  if (store.pendingSince !== undefined && Date.now() - store.pendingSince >= 450) result.SettingsSavePending = 1
  if (!includeProfiles) return result
  const offline = store.phase === 'offline'
  result.ProfileList = !offline && !unavailableLibrary() ? profileCatalog() : ''
  if (store.sending || store.phase === 'importing') {
    result.ProfileBusy = 1
    result.ProfileFeedback = store.phase === 'importing' ? 'Importing…' : 'Saving to your account…'
  } else if (store.error) result.ProfileFeedback = store.error
  if (offline) { result.ProfileBusy = 0; result.ProfileFeedback = '' }
  return result
}
