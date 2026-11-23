import { log } from 'modlock'
import { createPresetSettings, drillDefaults, isPresetSetting, needsSoulSource, presetFormatVersion, presetSettingKeys, presetValues, soleSoulSource } from './difficulty-settings.js'
import { hitLossSettings, resetTraining, setDeathEnabled, setMeleeDistances, setMeleeIntervals, setFailOnDeath, setFastStamina,
  setFreeParry, setOpponentHero, setSecondOpponent, soulPenaltySettings, waveSettings } from './gameplay'
import { setMeleeCues, setParriedEffects } from './particles'
import { session } from './session'
import { stationaryDrain } from './stationary-drain'
import { securedSouls } from './waves'
import { drillValue, savedDrillChoices } from './trainer-config'
import { openTrainerData, saveConfiguration, unavailableLibrary } from './trainer-store'

function applyPresetValue(key: string, value: boolean | number): void {
  const enabled = value === true
  switch (key) {
    case 'melee_min': case 'melee_max': case 'melee_bias':
      setMeleeDistances(preset.get('melee_min'), preset.get('melee_max'), preset.get('melee_bias')); break
    case 'interval_min': case 'interval_max': case 'interval_bias':
      setMeleeIntervals(preset.get('interval_min'), preset.get('interval_max'), preset.get('interval_bias')); break
    case 'trooper_speed': waveSettings.trooperSpeed = Number(value); break
    case 'trooper_count': waveSettings.trooperCount = Number(value); break
    case 'camp_tier': waveSettings.campTier = Number(value); break
    case 'hit_limit': hitLossSettings.limit = Number(value); break
    case 'effects': setMeleeCues(enabled); break
    case 'parried': setParriedEffects(enabled); break
    case 'cooldown': setFreeParry(!enabled); break
    case 'stamina': setFastStamina(enabled); break
    case 'second': setSecondOpponent(enabled); break
    case 'troopers': waveSettings.troopers = enabled; break
    case 'camps': waveSettings.camps = enabled; break
    case 'trooper_active': waveSettings.trooperActive = enabled; break
    case 'camp_reactive': waveSettings.campReactive = enabled; break
    case 'death': setDeathEnabled(enabled); break
    case 'fail_on_death': setFailOnDeath(enabled); break
    case 'fail_on_hits': hitLossSettings.enabled = enabled; break
    case 'penalty_hit': soulPenaltySettings.hit = enabled; break
    case 'penalty_unparried': soulPenaltySettings.unparried = enabled; break
    case 'penalty_whiff': soulPenaltySettings.whiff = enabled; break
    case 'idle_drain': stationaryDrain.setEnabled(enabled); break
    case 'idle_rate': stationaryDrain.setRate(Number(value)); break
  }
}

const preset = createPresetSettings((key: string, value: boolean | number) => {
  applyPresetValue(key, value)
  // These two settings are captured at Begin. Editing them affects the next run.
  if (session.phase === 'running' && key !== 'hit_limit' && key !== 'fail_on_hits') session.rulesChanged = true
})
// Only non-default choices need to be persisted.
const choices = new Map<string, string>()

export function settingsSnapshot(): string {
  return preset.snapshot().concat(savedDrillChoices(choices)).join(',')
}

// Capture the effective values as well as the slider position. A saved drill
// should still reproduce the drill if a later release retunes a preset.
export function savedDrillConfiguration(): string {
  return ['preset=' + preset.preset, 'version=' + presetFormatVersion, ...presetSettingKeys.map(key => key + '=' + Number(preset.get(key))),
    ...savedDrillChoices(choices, true)].join(',')
}

function applyDrillSetting(key: string, value: string): boolean {
  const normalized = drillValue(key, value)
  if (normalized === undefined) return false
  if ((key === 'hero1' || key === 'hero2') && !setOpponentHero(key === 'hero1' ? 0 : 1, normalized)) return false
  choices.set(key, normalized)
  return true
}

function restoreDrillChoices(): void {
  setOpponentHero(0, drillDefaults.hero1)
  setOpponentHero(1, drillDefaults.hero2)
  choices.clear()
}

let saveError: '' | 'write' | 'damaged' = ''
export const settingsSaveError = () => saveError

function persist(): void {
  let saved = false
  try { saved = saveConfiguration(settingsSnapshot()) } catch { /* Storage may have become unavailable. */ }
  const error = saved ? '' : unavailableLibrary() ? 'damaged' : 'write'
  if (error && error !== saveError) log('Parry Trainer: could not save trainer settings', error)
  saveError = error
}

export function changeSetting(key: string, value: string): boolean {
  if (key === 'retry_save') {
    if (value !== '1' || saveError !== 'write') return false
    persist()
    return true
  }
  // A whole preset can change the hit limit, which is fixed when the run begins.
  if (session.phase === 'countdown' || session.phase === 'running') {
    if (key === 'preset' || key === 'preset_reset') return false
    if (value === '0' && session.limit.mode === 'goal' && key === soleSoulSource(waveSettings.troopers, waveSettings.camps) &&
        needsSoulSource(session.limit.souls, session.soulScore(securedSouls()), preset.get)) return false
  }
  if (key === 'preset' || key === 'preset_reset') {
    if (key === 'preset_reset' && value !== '1') return false
    if (!preset.setPreset(key === 'preset' ? value : preset.preset)) return false
    restoreDrillChoices()
  } else if (isPresetSetting(key)) {
    if (!preset.setPreference(key, value)) return false
  } else if (!applyDrillSetting(key, value)) return false
  persist()
  return true
}

export function applyConfiguration(saved: string): void {
  // Applying an imported or stored drill replaces any earlier unsaved edits.
  // Load and Reset immediately persist their new active settings and check again.
  saveError = ''
  restoreDrillChoices()
  preset.restore(saved)
  // A new pawn and a fresh server also need values equal to the previous state.
  for (const key of presetSettingKeys) applyPresetValue(key, preset.get(key))
  for (const entry of saved.split(',')) {
    const pair = /^([a-z0-9_]+)=([a-z0-9_]+)$/.exec(entry)
    if (pair) applyDrillSetting(pair[1], pair[2])
  }
}

export function loadSettings(steamId: bigint): void {
  resetTraining()
  applyConfiguration(openTrainerData(steamId))
  persist() // Migrate the previous settings file once, keeping its original intact.
}

export function resetSettings(): void {
  // Restore a live session in place. Its counters, start time and the hero belong to the player.
  session.restoreUnlimitedRules()
  const defaults: Record<string, number | boolean> = presetValues(50)
  if (session.phase === 'running' && presetSettingKeys.some(key =>
      key !== 'fail_on_hits' && key !== 'hit_limit' && preset.get(key) !== defaults[key])) session.rulesChanged = true
  applyConfiguration('')
  persist()
}
