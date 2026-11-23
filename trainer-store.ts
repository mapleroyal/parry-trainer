// One atomic file holds the account's settings and profile library. The same
// document can be exported to another account without carrying over a Steam ID.
import { log, readFile, writeFile } from 'modlock'
import { configurationKey, validConfiguration } from './trainer-config'
import { presetFormatVersion } from './difficulty-settings.js'
import { type HeroLoadout, heroLoadoutKey, validHeroLoadout } from './hero-loadout'
import { backupFits } from './trainer-backup'

export interface HeroProfile {
  id: number
  name: string
  loadout?: HeroLoadout
  settings?: string
}
interface TrainerData {
  format: 'parry-trainer'
  version: 3
  nextId: number
  settings: string
  profiles: HeroProfile[]
}

function fresh(): TrainerData {
  return { format: 'parry-trainer', version: 3, nextId: 1, settings: 'preset=50,version=' + presetFormatVersion, profiles: [] }
}
const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0

function fieldsOnly(obj: unknown, keys: string[]): boolean {
  return !!obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).every(k => keys.includes(k))
}

export function validProfileName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && Array.from(value).length <= 40 &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)
}

export function parseTrainerDocument(raw: string): TrainerData | undefined {
  if (!raw || !backupFits(raw)) return
  let doc
  try { doc = JSON.parse(raw) } catch { return }
  if (!fieldsOnly(doc, ['format', 'version', 'nextId', 'settings', 'profiles']) || !['parry-trainer', 'parry-void'].includes(doc.format) ||
      ![1, 2, 3].includes(doc.version) || !positiveInt(doc.nextId) || !validConfiguration(doc.settings) ||
      !Array.isArray(doc.profiles)) return
  const entries: HeroProfile[] = [], ids = new Set<number>()
  for (const p of doc.profiles) {
    if (!fieldsOnly(p, doc.version === 3 ? ['id', 'name', 'loadout', 'settings'] : ['id', 'number', 'name', 'loadout', 'settings']) ||
        !positiveInt(p.id) || p.id >= doc.nextId || ids.has(p.id) ||
        (p.settings !== undefined && !validConfiguration(p.settings))) return
    // Older drills recorded the authoring hero even when they contained no build.
    const loadout = p.settings && doc.version < 3 && fieldsOnly(p.loadout, ['hero']) ? undefined : p.loadout
    const name = doc.version < 3 && p.name === undefined ? (p.settings ? 'Drill ' + p.id : 'Build ' + (p.number ?? p.id)) : p.name
    if (!validProfileName(name) || (!loadout && !p.settings) ||
        (loadout !== undefined && !validHeroLoadout(loadout))) return
    ids.add(p.id)
    entries.push({ id: p.id, name, loadout, settings: p.settings })
  }
  return { ...doc, format: 'parry-trainer', version: 3, profiles: entries }
}

let data = fresh()
let account = ''
let damaged = false
let writeDocument: ((raw: string) => boolean) | undefined
export const trainerAccount = () => account
export const profiles = (): readonly HeroProfile[] => data.profiles
export const unavailableLibrary = () => damaged

export function openTrainerData(steamId: bigint): string {
  const owner = steamId > 0n ? String(steamId) : 'local'
  const raw = readFile('trainer-' + owner + '.json')
  attachTrainerDocument(owner, raw, text => writeFile('trainer-' + owner + '.json', text))
  if (damaged) log('Parry Trainer: could not read the saved profile library. Use Saved → Backups to recover it.')
  if (raw === undefined) {
    const legacy = readFile('settings-' + account + '.txt')
    if (legacy && legacy.length <= 2048) return legacy
  }
  return data.settings
}

// Both launch paths use the same validation and library operations. The native
// adapter supplies an account-scoped cloud writer and tracks its acknowledgement.
export function attachTrainerDocument(owner: string, raw: string | undefined, write: (raw: string) => boolean): string {
  account = owner
  writeDocument = write
  const restored = raw === undefined ? undefined : parseTrainerDocument(raw)
  data = restored ?? fresh()
  damaged = raw !== undefined && !restored
  return data.settings
}

function commit(next: TrainerData, replaceDamaged = false): boolean {
  if (damaged && !replaceDamaged) return false
  const raw = JSON.stringify(next)
  if (!backupFits(raw) || (writeDocument && !writeDocument(raw))) return false
  data = next
  damaged = false
  return true
}

export function saveConfiguration(settings: string): boolean {
  if (settings === data.settings && !damaged) return true
  return commit({ ...data, settings })
}
export function exportTrainerData(activeSettings = data.settings): string {
  if (damaged) throw new Error('Unreadable profile library.')
  return JSON.stringify({ ...data, settings: activeSettings })
}
export function importTrainerData(raw: string): string | undefined {
  const next = parseTrainerDocument(raw)
  if (next && commit(next, true)) return next.settings
}

// Drills share one name space. Standalone builds are named per hero.
function groupOf(entry: { loadout?: HeroLoadout; settings?: string }): string {
  return entry.settings === undefined ? entry.loadout!.hero : 'drills'
}

export function addProfile(loadout: HeroLoadout | undefined, settings: string | undefined, name: string): { message: string; id?: number } {
  if (!validProfileName(name)) return { message: 'Use a name of 1–40 characters.' }
  if (!settings && !loadout) return { message: 'Choose a drill or build to save.' }
  const id = data.nextId, entry = { id, name, loadout, settings }
  const group = data.profiles.filter(p => groupOf(p) === groupOf(entry))
  const captured = loadout && heroLoadoutKey(loadout), drill = configurationKey(settings)
  const duplicate = group.find(p => (p.loadout && heroLoadoutKey(p.loadout)) === captured && configurationKey(p.settings) === drill)
  if (duplicate) return { id: duplicate.id, message: 'Already saved as “' + duplicate.name + '”.' }
  if (group.some(p => p.name.toLowerCase() === name.toLowerCase())) return { message: 'That name is already in use. Choose another.' }
  if (!positiveInt(id + 1) || !commit({ ...data, nextId: id + 1, profiles: [...data.profiles, entry] }))
    return { message: 'Could not save. Check available storage or export and remove older entries.' }
  return { id, message: 'Saved “' + name + '”.' }
}

export function renameProfile(p: HeroProfile, name: string): string {
  if (!validProfileName(name)) return 'Use a name of 1–40 characters.'
  if (data.profiles.some(other => other.id !== p.id && groupOf(other) === groupOf(p) &&
      other.name.toLowerCase() === name.toLowerCase())) return 'That name is already in use. Choose another.'
  return replaceProfile({ ...p, name })
    ? 'Renamed to “' + name + '”.' : 'Could not save the new name.'
}

export function replaceProfile(replacement: HeroProfile): boolean {
  const index = data.profiles.findIndex(entry => entry.id === replacement.id)
  if (index < 0) return false
  const profiles = [...data.profiles]
  profiles[index] = replacement
  return commit({ ...data, profiles })
}

export function deleteProfile(id: number): boolean {
  const remaining = data.profiles.filter(p => p.id !== id)
  return remaining.length < data.profiles.length && commit({ ...data, profiles: remaining })
}
