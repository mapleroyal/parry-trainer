import { jsx, type Child, type Player, type Style } from 'modlock'

/** palette keeps the arena HUD and settings in the same warm-neutral colors. */
export const palette = {
  plate: '#17191a', row: '#292d2d', border: '#454b47', ink: '#f4eedc',
  quiet: '#c2c7ba', green: '#aecdad', selected: '#3a5144', warning: '#ffce92', red: '#f1ad98',
}

/** column stacks rows without creating a new surface. */
export const column = (children: Child, style: Style = {}, key?: string) =>
  jsx('panel', { style: { flow: 'down', ...style }, children }, key)

/** row groups controls left to right. */
export const row = (children: Child, style: Style = {}, key?: string) =>
  jsx('panel', { style: { flow: 'right', verticalAlign: 'center', ...style }, children }, key)

/** text labels use the stock body face throughout the settings. */
export const text = (value: string | number, style: Style = {}, key?: string) =>
  jsx('label', { style: { color: palette.ink, fontSize: 18, ...style }, children: String(value) }, key)

/** heading marks a group of related settings or stats. */
export const heading = (value: string) => text(value, { bold: true, fontSize: 22, margin: [10, 0, 6] })

/** note reserves the smaller text role for instructions and status. */
export const note = (value: string, color = palette.quiet) => text(value, { color, fontSize: 16, margin: [5, 0] })

/** button uses the same keyboard target and accent across the trainer. */
export function button(label: string, onPress: (player: Player) => void, options: {
  selected?: boolean; primary?: boolean; disabled?: boolean; key?: string
} = {}): Child {
  const { selected, primary, disabled, key } = options
  const style = { padding: [7, 11], margin: [0, 4, 4, 0], borderRadius: 4,
    background: primary ? palette.green : selected ? palette.selected : palette.row }
  return jsx('button', { onPress, disabled, style, children: text(label, {
    color: primary ? palette.plate : palette.ink, bold: !!primary, fontSize: 17,
  }) }, key ?? label)
}

/** closeButton returns focus locally instead of sending another mod action. */
export function closeButton(label = 'Close'): Child {
  return jsx('menuClose', { style: { background: palette.row, padding: [7, 11], borderRadius: 4 }, children: text(label) })
}

/** clock prints the simulation clock without rounding it up mid-drill. */
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
