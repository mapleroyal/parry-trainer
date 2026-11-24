// Commands are scoped to the active trainee by the same gate as the other trainer controls.
import { heroes, type Player } from 'modlock'
import { applyHeroLoadout, captureHeroLoadout } from './hero-loadout'
import { session } from './session'
import { applyConfiguration, savedDrillConfiguration } from './trainer-settings'
import { addProfile, deleteProfile, profiles, renameProfile, replaceProfile, saveConfiguration, validProfileName,
  trainerAccount } from './trainer-store'

let loading = false
let feedback = ''
let generation = 0
const running = () => session.phase === 'running' || session.phase === 'countdown'
export const characterChanging = () => loading

export function resetCharacterSession(): void {
  generation++
  loading = false
  feedback = ''
}

/** characterFields describes the active hero and the latest library operation. */
export function characterFields(heroId: number | undefined) {
  return { hero: heroes.find(h => h.id === heroId)?.name ?? '', feedback, loading }
}

export function characterAction(player: Player, args: string): void {
  if (loading || !trainerAccount()) return
  const [action, arg, encoded, extra] = args.trim().split(/\s+/)
  if (extra || (encoded && action !== 'save' && action !== 'rename')) return
  if (running() && ['apply', 'drill-only'].includes(action)) {
    feedback = 'End the session before loading an entry.'
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
    return
  }

  // A disconnect can reuse the same player slot. A previous request must never
  // update the new player's data or release their current operation.
  const ticket = generation
  const current = () => ticket === generation && player.connection() !== undefined
  if (!['apply', 'drill-only', 'rename', 'overwrite', 'overwrite-drill-only', 'delete'].includes(action) || !/^[1-9]\d{0,15}$/.test(arg)) return
  const profile = profiles().find(p => p.id === Number(arg))
  if (!profile) { feedback = 'That entry is no longer available.'; return }
  const title = '“' + profile.name + '”'
  if (action === 'rename' && name) { feedback = renameProfile(profile, name); return }
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
    return true
  }
  if (!build) {
    if (profile.settings) feedback = applyDrill(profile.settings) ? 'Loaded drill ' + title + '.' : 'Could not save the drill settings.'
    return
  }
  loading = true
  feedback = 'Loading build…'
  applyHeroLoadout(player, build, error => {
    if (!current()) return
    loading = false
    if (error) { feedback = error; return }
    feedback = profile.settings && !applyDrill(profile.settings) ? 'Build loaded. Could not save the drill settings.' : 'Loaded ' + title + '.'
  })
}
