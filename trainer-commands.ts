import { command, log, type Player } from 'modlock'
import { activeTrainee, beginTraining, simulationTime, stopTraining } from './gameplay'
import { setRangePreview } from './range-preview'
import { parseLimit } from './session'
import { handleResultAudio } from './result-audio'
import { characterAction, characterChanging } from './character'
import { changeSetting, resetSettings } from './trainer-settings'

function traineeCommand(name: string, action: (player: Player, args: string) => void): void {
  command(name, (player, args) => {
    if (activeTrainee()?.slot === player.slot) action(player, args.trim())
  })
}
export function registerTrainerCommands(options: {
  busy?: () => boolean
  retry?: () => void
  nativeBackup?: boolean
} = {}): void {
  traineeCommand('parry_trainer_profile', (player, args) => {
    if (options.busy?.()) return
    if (options.nativeBackup && /^(export|import)(?:\s|$)/.test(args)) return
    characterAction(player, args)
  })
  traineeCommand('parry_trainer_range_preview', (_, args) => setRangePreview(args, simulationTime()))
  traineeCommand('parry_trainer_result_audio', handleResultAudio)
  traineeCommand('parry_trainer_begin', (_, args) => {
    const limit = parseLimit(args)
    if (!options.busy?.() && !characterChanging() && limit && beginTraining(limit)) log('PARRY_TRAINER_BEGIN', limit.mode)
  })
  traineeCommand('parry_trainer_stop', (_, args) => { if (!args) stopTraining() })
  traineeCommand('parry_trainer_reset', (_, args) => { if (!args && !options.busy?.() && !characterChanging()) resetSettings() })
  traineeCommand('parry_trainer_setting', (_, args) => {
    const [setting, value, extra] = args.split(/\s+/)
    if (options.retry && setting === 'retry_save' && value === '1' && !extra) { options.retry(); return }
    if (!options.busy?.() && !characterChanging() && value && !extra && changeSetting(setting, value)) log('PARRY_TRAINER_SETTING', setting, value)
  })
}
