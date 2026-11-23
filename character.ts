// Commands are scoped to the active trainee by the same gate as the other trainer controls.
import { heroes, type Player } from 'modlock'
import { applyHeroLoadout, captureHeroLoadout } from './hero-loadout'
import { transferBackup } from './trainer-backup'
import { session } from './session'
import { applyConfiguration, savedDrillConfiguration, settingsSnapshot } from './trainer-settings'
import { addProfile, deleteProfile, exportTrainerData, importTrainerData, profiles, renameProfile, replaceProfile, saveConfiguration, validProfileName,
  trainerAccount, unavailableLibrary } from './trainer-store'

let pending: 'loadout' | 'export' | 'import' | undefined
let feedback = ''
let selected = 0
let revision = 0
let generation = 0
const running = () => session.phase === 'running' || session.phase === 'countdown'
export const characterChanging = () => pending === 'loadout' || pending === 'import'

export function resetCharacterSession(): void {
  generation++
  pending = undefined
  feedback = ''
  revision = 0
  selected = 0
}

export function characterFields(heroId: number | undefined, library: boolean): Record<string, string | number> {
  const hero = heroes.find(h => h.id === heroId)?.name ?? ''
  return library ? { ProfileHero: hero, ProfileAccount: unavailableLibrary() ? '' : trainerAccount(),
    ProfileFeedback: feedback || (unavailableLibrary() ? 'Saved entries unavailable. Import a backup to recover them.' : ''),
    ProfileBusy: Number(!!pending), ProfileRevision: String(revision), ProfileSelected: String(selected) } : { ProfileHero: hero }
}

export function characterAction(player: Player, args: string): void {
  if (pending || !trainerAccount()) return
  const [action, arg, encoded, extra] = args.trim().split(/\s+/)
  if (extra || (encoded && action !== 'save' && action !== 'rename')) return
  selected = 0
  if (running() && ['apply', 'drill-only', 'import'].includes(action)) {
    feedback = 'End the session before loading an entry or importing a backup.'
    return
  }
  let name: string | undefined
  if (encoded) {
    try { name = decodeURIComponent(encoded) } catch { name = '' }
    if (!validProfileName(name)) { feedback = 'Use a name of 1–40 characters.'; return }
  }
  if (action === 'save') {
    const [kind, hero, rest] = (arg || '').split(':')
    if (!name || rest !== undefined || !['drill', 'drill-build', 'build', 'items', 'skills'].includes(kind)) return
    const withBuild = kind !== 'drill'
    if (withBuild !== Boolean(hero)) return
    const build = withBuild ? captureHeroLoadout(player, kind !== 'skills', kind !== 'items') : undefined
    if (withBuild && (!build || build.hero !== hero)) { feedback = 'Your active hero changed. Open Save again.'; return }
    const result = addProfile(build, kind.startsWith('drill') ? savedDrillConfiguration() : undefined, name)
    feedback = result.message
    selected = result.id ?? 0
    return
  }

  // A disconnect can reuse the same player slot. A previous request must never
  // update the new player's data or release their current operation.
  const ticket = generation
  const current = () => ticket === generation && player.connection() !== undefined
  if ((action === 'export' && !arg) || (action === 'import' && arg === 'confirm')) {
    pending = action
    feedback = action === 'export' ? 'Exporting…' : 'Importing…'
    transferBackup(action, trainerAccount(), () => exportTrainerData(settingsSnapshot()), raw => {
      if (!current() || running()) return false
      const saved = importTrainerData(raw)
      if (saved === undefined) return false
      applyConfiguration(saved)
      revision++
      return true
    }, message => { if (current()) { feedback = message; pending = undefined } })
    return
  }
  if (!['apply', 'drill-only', 'rename', 'overwrite', 'overwrite-drill-only', 'delete'].includes(action) || !/^[1-9]\d{0,15}$/.test(arg)) return
  const profile = profiles().find(p => p.id === Number(arg))
  if (!profile) { feedback = 'That entry is no longer available.'; return }
  const title = '“' + profile.name + '”'
  if (action === 'rename' && name) { feedback = renameProfile(profile, name); selected = profile.id; return }
  if (action === 'rename') return
  if (action === 'overwrite' || action === 'overwrite-drill-only') {
    let loadout = profile.loadout
    if (action === 'overwrite-drill-only' && !profile.settings) {
      feedback = 'Choose the matching hero to overwrite this build.'
      return
    }
    if (action === 'overwrite' && loadout) {
      const live = captureHeroLoadout(player, !!loadout.items, !!loadout.abilities)
      if (!live || live.hero !== loadout.hero) {
        feedback = 'Could not capture this hero’s build. Choose the matching hero and try again.'
        return
      }
      loadout = live
    }
    const settings = profile.settings ? savedDrillConfiguration() : undefined
    if (replaceProfile({ ...profile, settings, loadout })) {
      selected = profile.id
      feedback = 'Overwrote ' + title + '.'
    } else feedback = 'Could not overwrite ' + title + '.'
    return
  }
  if (action === 'delete') {
    feedback = deleteProfile(profile.id) ? 'Deleted ' + title + '.' : 'Could not delete the entry.'
    return
  }
  if (action === 'drill-only' && !profile.settings) return
  const build = action === 'apply' ? profile.loadout : undefined
  function applyDrill(settings: string): boolean {
    if (!saveConfiguration(settings)) return false
    applyConfiguration(settings)
    revision++
    return true
  }
  if (!build) {
    if (profile.settings) feedback = applyDrill(profile.settings) ? 'Loaded drill ' + title + '.' : 'Could not save the drill settings.'
    return
  }
  pending = 'loadout'
  feedback = 'Loading build…'
  applyHeroLoadout(player, build, error => {
    if (!current()) return
    pending = undefined
    if (error) { feedback = error; return }
    feedback = profile.settings && !applyDrill(profile.settings) ? 'Build loaded. Could not save the drill settings.' : 'Loaded ' + title + '.'
  })
}
