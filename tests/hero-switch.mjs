import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

// The native engine disallows changing a test bot's hero. Drive the human
// connection lifecycle here, including the frames before the new pawn is ready.
export const heroes = ['Abrams', 'Wraith', 'Haze'].map((title, i) =>
  ({ title, id: i + 1, name: ['hero_atlas', 'hero_wraith', 'hero_haze'][i] }))
export const items = [{ id: 10, name: 'upgrade_test' }]
export const heroNamed = name => heroes.find(hero => hero.name === name)
export const readField = () => 1
let restored, left, scheduled = []
export const onRestored = callback => { restored = callback }
export const onPlayerLeave = callback => { left = callback }
export const sequence = callback => scheduled.push({ callback, attempt: 0 })

test('native hero selection waits for the pawn and skills, recovers a failed build, and respects a manual pick or disconnect', async () => {
  const hooks = registerHooks({ resolve(name, context, next) {
    return name === 'modlock' ? { url: import.meta.url, shortCircuit: true } : next(name, context)
  } })
  const { applyHeroLoadout, captureHeroLoadout } = await import('../hero-loadout.ts')
  hooks.deregister()
  const equipment = [{ id: 10, slot: 23, state: 0 }], choices = [], results = []
  let hero = 1, ready = true, gear = [], generation = 1
  const player = {
    slot: 0,
    pawn: () => hero && ({ hero, generation, team: 2, health: 100, abilityPoints: 0, abilityUnlocks: 0 }),
    connection: () => ({ generation }),
    abilities() {
      const skills = ready ? [0, 1, 2, 3].map(slot => ({ id: 100 * hero + slot, slot, state: 0, name: 'skill' + slot })) : []
      return [...skills, ...gear.map(item => ({ ...item, name: items[0].name, imbues: [] }))]
    },
    selectHero(id, team) { assert.equal(team, 2); choices.push(id); return id },
    freeze() {},
    adjustAbilityPoints: () => true,
    restoreHero(target) { gear = target.items ?? gear; restored(player); return true },
  }
  function frame(nextHero, skillsReady = true) {
    if (hero !== nextHero) gear = []
    hero = nextHero
    ready = skillsReady
    const frame = scheduled
    scheduled = []
    for (const timer of frame) if (timer.callback(++timer.attempt) !== undefined) scheduled.push(timer)
  }
  const apply = build => applyHeroLoadout(player, build, error => results.push(error ?? 'loaded'))
  const wraith = { hero: 'hero_wraith', items: equipment }
  apply(wraith)
  frame(1); frame(0); frame(2, false)
  assert.deepEqual(choices, [2])
  assert.deepEqual(results, [])
  frame(2)
  assert.deepEqual(captureHeroLoadout(player, true, false), wraith)
  assert.deepEqual(results, ['loaded'])

  const invalid = { ...captureHeroLoadout(player, true, true), hero: 'hero_atlas' }
  apply(invalid)
  frame(1)
  assert.deepEqual(choices, [2, 1, 2])
  frame(2)
  assert.match(results.pop(), /saved skills do not match/)
  assert.deepEqual(captureHeroLoadout(player, true, false), wraith)
  apply({ hero: 'hero_atlas', items: [] })
  frame(3)
  assert.match(results.pop(), /active hero changed/)
  assert.deepEqual(choices, [2, 1, 2, 1])

  apply(wraith)
  left({ connection: { player } })
  generation++
  frame(2)
  assert.match(results.pop(), /Player left/)
  assert.deepEqual(gear, [])
  assert.deepEqual(results, ['loaded'])
})
