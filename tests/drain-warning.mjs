import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

// The game host supplies these calls in production.
const entities = new Map()
const changes = []
let nextEntity = 0
export function createEntity({ keyValues }) {
  const id = ++nextEntity
  entities.set(id, { name: keyValues.find(key => key.key === 'targetname').value.text })
  return id
}
export function showEntityOnlyTo(id, slots) { entities.get(id).slots = slots; return true }
export function findEntitiesByName(name) {
  return [...entities.keys()].filter(id => entities.get(id).name === name)
}
export function removeEntity(id) { return entities.delete(id) }
export function fireInput(id, input, value) {
  assert.ok(entities.has(id))
  assert.equal(value.text, 'ParryTrainerDrainActive')
  changes.push([id, input])
  return true
}

test('actual drain renews one targeted warning and disconnects and reloads clear its state', async () => {
  const hooks = registerHooks({ resolve(name, context, next) {
    return name === 'modlock' ? { url: import.meta.url, shortCircuit: true } : next(name, context)
  } })
  const { updateDrainWarning: tick, clearDrainWarning: clear } = await import('../drain-warning.ts')
  hooks.deregister()
  const player = { slot: 2 }
  tick(player, 0, false)
  assert.deepEqual(entities.get(1).slots, [2])
  assert.deepEqual(changes, [])
  tick(player, 1, true)
  tick(player, 1.1, true)
  tick(player, 1.2, true)
  tick(player, 1.54, false)
  assert.deepEqual(changes, [[1, 'AddCSSClass']])
  tick(player, 1.56, false)
  tick(player, 2, false)
  assert.deepEqual(changes, [[1, 'AddCSSClass'], [1, 'RemoveCSSClass']])
  tick(player, 3, true)
  tick(undefined, 3.01, false)
  assert.equal(entities.size, 0)
  tick(player, 3.02, false)
  assert.deepEqual(entities.get(2).slots, [2])
  assert.equal(changes.length, 3)
  tick(player, 4, true)
  tick(player, 4.49, false)
  assert.deepEqual(changes.slice(-2), [[2, 'AddCSSClass'], [2, 'RemoveCSSClass']])

  entities.set(99, { name: entities.get(2).name }) // Left behind by a previous load.
  entities.set(100, { name: 'other_world_panel' })
  clear()
  assert.deepEqual([...entities.keys()], [100])
  tick(player, 0, false)
  assert.deepEqual(entities.get(3).slots, [2])
})
