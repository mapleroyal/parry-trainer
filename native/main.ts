import { hideHud, jsx, route, show } from 'modlock'
import { resetCharacterSession } from '../character'
import { useDrainRoute } from '../drain-warning'
import { activeTrainee, startGameplay } from '../gameplay'
import { registerScore } from '../score'
import { registerTrainerCommands } from '../trainer-commands'
import { closeNativeStorage, nativeScoreStorage, nativeStorageLoading,
  openNativeStorage, retryNativeSave } from './storage'
import { nativeBackupAction, resetNativeBackup } from './backup'

useDrainRoute((player, visible) => route(player, 'draining', visible))
registerTrainerCommands({ busy: nativeStorageLoading, retry: retryNativeSave, nativeBackup: true })

registerScore((player, sequence, score, library) => {
  const fields = nativeScoreStorage(score, library)
  fields.ScoreSequence = Number(sequence)
  route(player, 'score', fields)
})

startGameplay('stock', {
  joined(connection) {
    resetCharacterSession()
    resetNativeBackup()
    openNativeStorage(connection.player)
    hideHud(connection.player, ['topBar', 'minimap', 'brokerCountdown', 'levelUp'])
    show(connection.player, jsx('layout', {
      src: 'trainer.xml',
      style: { width: '100%', height: '100%' },
      onAction(player, action, payload) {
        if (action === 'backup' && activeTrainee()?.slot === player.slot) nativeBackupAction(player, payload)
      },
    }))
  },
  left() {
    resetCharacterSession()
    resetNativeBackup()
    closeNativeStorage()
  },
})
