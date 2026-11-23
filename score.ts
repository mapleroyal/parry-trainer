import { command, log, type Player } from 'modlock'
import { activeTrainee, simulationTime } from './gameplay'
import { session } from './session'
import { soulStats } from './waves'
import { settingsSaveError, settingsSnapshot } from './trainer-settings'
import { characterChanging, characterFields } from './character'
import { scoreFields } from './score-snapshot'

type Score = Record<string, string | number>
type Reply = (player: Player, sequence: string, fields: Score, library: boolean) => void

export function registerScore(reply: Reply = (_, seq, fields) => log('PARRY_TRAINER_SCORE', seq, JSON.stringify(fields))): void {
  command('parry_trainer_score', (player, args) => {
    if (player.slot !== activeTrainee()?.slot) return
    const match = /^(\d{1,16})( profiles)?$/.exec(args.trim())
    if (!match || !Number.isSafeInteger(Number(match[1]))) return
    const pawn = player.pawn()
    const library = Boolean(match[2])
    const startUnavailable = characterChanging() ? 'Wait for the saved data to finish loading.' :
      !pawn?.hero || pawn.health <= 0 ? 'Waiting for your hero to spawn.' : ''
    reply(player, match[1], scoreFields(session, soulStats(), simulationTime(), settingsSnapshot(),
      { ...characterFields(pawn?.hero, library), StartUnavailable: startUnavailable, SettingsSaveError: settingsSaveError() }), library)
  })
}
