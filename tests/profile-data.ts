// Exercise the same settings, naming and atomic replacement as the Saved library.
import { log, onFrame, serverCommand } from 'modlock'
import { changeSetting, savedDrillConfiguration, settingsSnapshot } from '../trainer-settings'
import { validConfiguration } from '../trainer-config'
import { addProfile, deleteProfile, exportTrainerData, importTrainerData, profiles, renameProfile, replaceProfile } from '../trainer-store'

export default function registerProfileDataProbe(): void {
  let tested = false
  onFrame(() => {
    if (tested) return
    tested = true
    const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message) }
    try {
      changeSetting('preset', '75')
      changeSetting('hero2', 'hero_wraith')
      changeSetting('timer', '213')
      changeSetting('penalty_hit', '0')
      changeSetting('penalty_whiff', '1')
      // The legacy fixture below predates configurable timing.
      changeSetting('interval_min', '18')
      changeSetting('interval_max', '100')
      changeSetting('interval_bias', '50')
      const saved = settingsSnapshot(), full = savedDrillConfiguration(), abrams = { hero: 'hero_atlas', items: [] }
      check(full.includes('stamina=0') && full.includes('hero1=random') && full.includes('timer=213'), 'effective configuration')
      check(full.includes('penalty_hit=0') && full.includes('penalty_unparried=0') && full.includes('penalty_whiff=1'), 'profile penalties')
      check(validConfiguration(saved) && validConfiguration('preset=100,version=2') &&
        !validConfiguration(saved + ',penalty_unparried=3'), 'portable penalty validation')
      check(full.includes('melee_min=33') && full.includes('melee_max=100') && full.includes('melee_bias=25'), 'saved melee range and weight')
      check(full.includes('interval_min=18') && full.includes('interval_max=100') && full.includes('interval_bias=50') &&
        validConfiguration('preset=0,version=6,interval_min=18.82,interval_max=40') &&
        !validConfiguration('preset=0,version=6,interval_max=79') &&
        !validConfiguration('preset=0,version=6,interval_min=18.823') &&
        validConfiguration('preset=0,version=5,interval_max=40,interval_min=30,interval_bias=15') &&
        validConfiguration('preset=0,version=5,interval_max=75') &&
        !validConfiguration('preset=50,version=5,interval_min=18.82') &&
        !validConfiguration('preset=0,version=5,interval_max=40') &&
        !validConfiguration('preset=50,version=4,interval_min=0'), 'portable interval validation')
      check(validConfiguration('preset=0,version=4,melee_max=32,melee_min=20,melee_bias=7') &&
        validConfiguration('preset=50,version=3,difficulty=10') && !validConfiguration('preset=50,version=4,difficulty=10') &&
        !validConfiguration('preset=0,version=4,melee_max=32') &&
        !validConfiguration('preset=50,version=4,melee_max=61,melee_min=62') &&
        !validConfiguration('preset=50,version=4,melee_bias=101'), 'portable distance validation')
      check(addProfile(abrams, full, 'Mêlée').id === 1, 'drill containing a build')
      const duplicate = addProfile(abrams, full, 'Duplicate')
      check(duplicate.id === 1 && duplicate.message.includes('Mêlée'), 'named duplicate selection')
      check(addProfile(abrams, undefined, 'Fresh kit').id === 2, 'independent build')
      check(addProfile(undefined, saved, 'Warmup').id === 3, 'independent drill')
      check(!profiles()[2].loadout && !profiles()[1].settings, 'independent categories')
      check(renameProfile(profiles()[2], 'Flicks & dashes').includes('Flicks & dashes'), 'rename')
      const portable = exportTrainerData(), invalid = JSON.parse(portable)
      invalid.profiles[2].settings += ',timer=broken'
      check(importTrainerData(JSON.stringify(invalid)) === undefined && exportTrainerData() === portable, 'partial import')
      invalid.profiles[2].settings = saved
      invalid.profiles[2].id = invalid.profiles[0].id
      check(importTrainerData(JSON.stringify(invalid)) === undefined && exportTrainerData() === portable, 'duplicate IDs')
      check(deleteProfile(2) && profiles().length === 2, 'delete one entry')
      check(importTrainerData(portable) === saved && profiles().length === 3 && exportTrainerData() === portable, 'whole-library restore')
      const older = JSON.parse(portable)
      older.format = 'parry-void' // Original portable backup identifier.
      older.version = 2
      older.profiles.forEach((entry: { name?: string }) => { delete entry.name })
      older.profiles[0].settings = full.split(',').filter(entry => !/^(penalty|melee|interval)_/.test(entry))
        .map(entry => entry.startsWith('version=') ? 'version=2' : entry).concat('difficulty=75').join(',')
      older.profiles[2].loadout = { hero:'hero_retired_training_fixture' }
      check(importTrainerData(JSON.stringify(older)) === saved, 'original portable library import')
      check(JSON.parse(exportTrainerData()).format === 'parry-trainer', 're-exported library uses the current format')
      check(profiles()[2].id === 3 && !profiles()[2].loadout, 'legacy settings-only entry is a portable drill')
      check(addProfile(undefined, saved, 'Already saved').id === 3, 'same drill on another hero')
      check(addProfile(abrams, full, 'With penalty').id === 4, 'distinct combined build')
      changeSetting('penalty_whiff', '0')
      check(addProfile(abrams, savedDrillConfiguration(), 'Changed').id === 1, 'equivalent attached build and drill')
      const original = profiles()[0], updated = savedDrillConfiguration(), before = JSON.parse(exportTrainerData())
      check(replaceProfile({ ...original, settings:updated }), 'overwrite existing drill')
      const after = JSON.parse(exportTrainerData())
      check(after.profiles.length === before.profiles.length && after.nextId === before.nextId &&
        after.profiles[0].name === original.name && after.profiles[0].id === original.id &&
        after.profiles[0].settings === updated && JSON.stringify(after.profiles[0].loadout) === JSON.stringify(original.loadout) &&
        JSON.stringify(after.profiles.slice(1)) === JSON.stringify(before.profiles.slice(1)), 'in-place overwrite')
      check(!replaceProfile({ ...original, id:999 }) && JSON.stringify(after) === exportTrainerData(), 'missing overwrite target')
      log('PARRY TRAINER PROBE PASS profile-data named drills, in-place overwrite, independent hero builds, cross-hero duplicates and backups')
    } catch (error) { log('PARRY TRAINER PROBE FAIL profile-data', String(error)) }
    serverCommand('quit')
  })
}
