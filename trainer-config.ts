// Validate the whole portable configuration before an import changes any settings.
import { heroNamed } from 'modlock'
import { createPresetSettings, drillDefaults, intervalSettingKeys, isPresetSetting, meleeSettingKeys, presetFormatVersion, presetValue, presetValues } from './difficulty-settings.js'

export function drillValue(key: string, value: string): string | undefined {
  switch (key) {
    case 'hero1': case 'hero2': return value === 'random' ? value : heroNamed(value)?.name
    case 'limit_mode': return ['none', 'goal', 'timer'].includes(value) ? value : undefined
    case 'timer': return /^[1-9]\d{0,4}$/.test(value) && Number(value) <= 86400 ? value : undefined
    case 'parries': case 'souls': return /^(0|[1-9]\d{0,3})$/.test(value) ? value : undefined
  }
}

export function savedDrillChoices(choices: Map<string, string>, includeDefaults = false): string[] {
  return Object.keys(drillDefaults).filter(key => includeDefaults || (choices.has(key) && choices.get(key) !== drillDefaults[key]))
    .map(key => key + '=' + (choices.get(key) ?? drillDefaults[key]))
}

// A profile from an earlier release can describe the same drill using a different wire format.
export function configurationKey(saved?: string): string | undefined {
  if (saved === undefined) return
  const model = createPresetSettings()
  model.restore(saved)
  const fields = new Map<string, string>()
  for (const entry of saved.split(',')) {
    const [key, value] = entry.split('=')
    fields.set(key, value)
  }
  return model.snapshot().concat(savedDrillChoices(fields)).join(',')
}

export function validConfiguration(saved: unknown): saved is string {
  if (typeof saved !== 'string' || saved.length > 2048) return false
  const fields = new Map<string, string>()
  for (const entry of saved.split(',')) {
    const pair = /^([a-z0-9_]+)=([a-z0-9_.]+)$/.exec(entry)
    if (!pair) return false
    const [, key, value] = pair
    if (fields.has(key)) return false
    fields.set(key, value)
    if (key === 'version') {
      if (!['2', '3', '4', '5', presetFormatVersion].includes(value)) return false
    } else if (key === 'preset' || key === 'difficulty' || isPresetSetting(key)) {
      if (presetValue(key, value) === undefined) return false
    } else if (drillValue(key, value) !== value) return false
  }
  const version = fields.get('version')
  if (!version || !fields.has('preset')) return false
  if (version !== presetFormatVersion && intervalSettingKeys.some(key => fields.has(key) &&
      (version !== '5' || fields.get(key)!.includes('.')))) return false
  if (version === '2' || version === '3') return !meleeSettingKeys.some(key => fields.has(key))
  if (fields.has('difficulty')) return false
  const defaults = presetValues(Number(fields.get('preset')), version)
  return Number(fields.get('melee_min') ?? defaults.melee_min) <= Number(fields.get('melee_max') ?? defaults.melee_max) &&
    Number(fields.get('interval_min') ?? defaults.interval_min) <= Number(fields.get('interval_max') ?? defaults.interval_max)
}
