import { hideHud, onFrame, show } from 'modlock'
import { resetCharacterSession } from '../character'
import { useDrainRoute } from '../drain-warning'
import { activeTrainee, startGameplay } from '../gameplay'
import { TrainerInterface } from './interface'
import { closeNativeStorage, openNativeStorage } from './storage'

let view: TrainerInterface | undefined

useDrainRoute((_, visible) => {
  if (!view) return false
  view.draining = visible
  return true
})

startGameplay('stock', {
  joined({ player }) {
    resetCharacterSession()
    openNativeStorage(player)
    hideHud(player, ['topBar', 'minimap', 'brokerCountdown', 'levelUp'])
    view = new TrainerInterface(player)
    view.update(true)
  },
  left({ player }) {
    show(player, null)
    hideHud(player, [])
    view = undefined
    resetCharacterSession()
    closeNativeStorage()
  },
})

onFrame(() => {
  if (view?.player === activeTrainee()) view?.update()
})

/** currentInterface gives the local probe the same interface players use. */
export const currentInterface = () => view
