import { createEntity, findEntitiesByName, fireInput, removeEntity, showEntityOnlyTo, type Player } from 'modlock'

const signalName = 'parry_trainer_drain_signal'
let signal: { entity: number; slot: number; visible: boolean } | undefined
let visibleUntil = -Infinity

// The hosted HUD can receive this state directly. The standalone reference uses its world panel.
type DrainRoute = (player: Player, visible: boolean) => boolean
let publish: DrainRoute | undefined
let lastRoute: { player: Player; visible: boolean } | undefined
export function useDrainRoute(route: DrainRoute): void { publish = route }

function setVisible(visible: boolean): void {
  if (!signal || signal.visible === visible) return
  const input = visible ? 'AddCSSClass' : 'RemoveCSSClass'
  if (fireInput(signal.entity, input, { text: 'ParryTrainerDrainActive' })) signal.visible = visible
}

export function clearDrainWarning(): void {
  if (publish) {
    if (lastRoute?.visible) publish(lastRoute.player, false)
    lastRoute = undefined
    visibleUntil = -Infinity
    return
  }
  // A script reload loses the old handle before the next world's callback.
  for (const entity of findEntitiesByName(signalName)) removeEntity(entity)
  signal = undefined
  visibleUntil = -Infinity
}

export function updateDrainWarning(player: Player | undefined, now: number, damaged: boolean): void {
  if (signal && player?.slot !== signal.slot) clearDrainWarning()
  if (!player) return
  if (damaged) visibleUntil = now + 0.35
  const visible = now < visibleUntil
  if (publish) {
    if (lastRoute?.player.slot !== player.slot || lastRoute.visible !== visible) {
      if (publish(player, visible)) lastRoute = { player, visible }
    }
    return
  }
  if (!signal) {
    // An empty, owner-only world panel carries the state to Panorama even outside
    // the camera's view. Its initial inactive state clears any surviving HUD
    // warning on a script reload before the player begins another session.
    const entity = createEntity({ designerName: 'point_clientui_world_text_panel', subclass: '', team: 0,
      position: { x: 0, y: 0, z: -1000 }, transmitAlways: true, keyValues: [
        { key: 'targetname', value: { text: signalName } },
        { key: 'enabled', value: { boolean: true } },
        { key: 'ignore_input', value: { boolean: true } },
        { key: 'width', value: { number: 1 } }, { key: 'height', value: { number: 1 } },
        { key: 'dialog_layout_name', value: { text: 'file://{resources}/layout/parry_trainer_drain_signal.xml' } },
      ] })
    if (entity === undefined) return
    if (!showEntityOnlyTo(entity, [player.slot])) { removeEntity(entity); return }
    signal = { entity, slot: player.slot, visible: false }
  }
  setVisible(visible)
}
