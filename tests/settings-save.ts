// Fill an in-memory library to the backup limit, then make and retry a real settings write.
import { log, onFrame, serverCommand } from 'modlock'
import { maxBackupBytes } from '../trainer-backup'
import { applyConfiguration, changeSetting, savedDrillConfiguration, settingsSaveError, settingsSnapshot } from '../trainer-settings'
import { deleteProfile, exportTrainerData, importTrainerData } from '../trainer-store'

export default function registerSettingsSaveProbe(): void {
  let done = false
  onFrame(() => {
    if (done) return
    done = true
    try {
      const initial = settingsSnapshot()
      type Entry = { id: number; name: string; settings: string }
      const doc = { format: 'parry-trainer', version: 3, nextId: 20000, settings: initial, profiles: [] as Entry[] }
      let bytesFree = maxBackupBytes - JSON.stringify(doc).length
      for (const settings of [savedDrillConfiguration(), initial]) {
        while (true) {
          const id = doc.profiles.length + 1, entry = { id, name: 'Drill ' + id, settings }
          const size = JSON.stringify(entry).length + Number(id > 1)
          if (size > bytesFree) break
          bytesFree -= size
          doc.profiles.push(entry)
        }
      }
      if (importTrainerData(JSON.stringify(doc)) !== initial) throw new Error('library preparation')
      applyConfiguration(initial + ',penalty_unparried=1,penalty_whiff=1,fail_on_hits=1,trooper_speed=33,hero1=hero_wraith')
      if (!changeSetting('timer', '321') || settingsSaveError() !== 'write') throw new Error('write failure status')
      const active = settingsSnapshot()
      if (!active.includes('timer=321') || JSON.parse(exportTrainerData()).settings !== initial ||
          JSON.parse(exportTrainerData(active)).settings !== active) throw new Error('active and persisted settings')
      if (!deleteProfile(1) || !changeSetting('retry_save', '1') || settingsSaveError() ||
          JSON.parse(exportTrainerData()).settings !== active) throw new Error('retry')
      const library = JSON.stringify(JSON.parse(exportTrainerData()).profiles)
      for (const [key, value] of Object.entries({ hero2: 'hero_atlas', limit_mode: 'goal', parries: '42', souls: '3' }))
        if (!changeSetting(key, value)) throw new Error('could not customize ' + key)
      if (changeSetting('preset', '101') || !settingsSnapshot().includes('parries=42')) throw new Error('invalid preset changed choices')
      if (!changeSetting('preset', '50') || settingsSnapshot() !== initial) throw new Error('same-level Apply did not replace the drill')
      const after = JSON.parse(exportTrainerData())
      if (after.settings !== initial || JSON.stringify(after.profiles) !== library) throw new Error('Apply changed the library or was not saved')
      if (!changeSetting('melee_min', '13') || !changeSetting('melee_max', '42') || !changeSetting('melee_bias', '81'))
        throw new Error('distance edit refused')
      const edited = settingsSnapshot(), libraryBackup = exportTrainerData()
      if (!edited.includes('melee_min=13,melee_max=42,melee_bias=81') || JSON.parse(libraryBackup).settings !== edited)
        throw new Error('distance edit did not persist')
      applyConfiguration(initial)
      const imported = importTrainerData(libraryBackup)
      if (!imported) throw new Error('distance backup rejected')
      applyConfiguration(imported)
      if (settingsSnapshot() !== edited) throw new Error('distance backup round trip')
      log('PARRY TRAINER PROBE PASS settings-save failed write recovered, same-level Apply replaced the complete drill and preserved the library')
    } catch (error) { log('PARRY TRAINER PROBE FAIL settings-save', String(error)) }
    serverCommand('quit')
  })
}
