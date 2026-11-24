import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import {
  fieldCount,
  packTrainerDocument,
  readRecord,
  recordParts,
  recordUpdate,
  unpackTrainerDocument,
} from '../native/save-codec.js'

const reference = {
  format: 'parry-trainer',
  version: 3,
  nextId: 42,
  settings: 'preset=50,version=5',
  profiles: [
    { id: 1, name: '早起 🐾', settings: 'preset=50,version=5,timer=318' },
    { id: 8, name: 'Scout 🐸🦊🍋⭐🐾🌝🎲🍄🌳🎮', loadout: { hero: 'hero_atlas', items: [] } },
    {
      id: 39,
      name: 'Armoured',
      loadout: { hero: 'hero_atlas', items: [{ id: 12, slot: 23, state: 0, imbues: [1] }] },
      settings: 'preset=50,version=5,timer=318',
    },
  ],
}
const asRecord = (parts) => Object.fromEntries(Object.entries(recordUpdate(parts)).map(([key, v]) => [key, v.set]))
test('account codec preserves an attached build, all saved IDs and Unicode, and clears old trailing fields', () => {
  const original = JSON.stringify(reference),
    parts = recordParts(packTrainerDocument(reference))
  assert.deepEqual(JSON.parse(readRecord(asRecord(parts))), JSON.parse(original))
  assert.ok(parts.length > 1)
  const small = { ...reference, profiles: [] },
    updated = { ...asRecord(parts), ...asRecord(recordParts(packTrainerDocument(small))) }
  assert.equal(Object.keys(updated).length, fieldCount)
  assert.deepEqual(JSON.parse(readRecord(updated)), small)
  assert.equal(readRecord({}), undefined)
  assert.throws(() => readRecord({ p0: '', p3: 'leftovers' }))
  const manifest = JSON.parse(fs.readFileSync(new URL('../native/persistence.json', import.meta.url)))
  assert.deepEqual(Object.keys(manifest.persist[0].fields).sort(), Object.keys(updated).sort())
})
test('an over-capacity save is rejected and every accepted field respects UTF-8 bytes', () => {
  assert.equal(recordParts('x'.repeat(fieldCount * 250 + 1)), undefined)
  assert.ok(recordParts('x'.repeat(fieldCount * 250)))
  const payload = ('a'.repeat(249) + '🌍é').repeat(25),
    segments = recordParts(payload)
  assert.equal(segments.join(''), payload)
  assert.ok(segments.every((s) => Buffer.byteLength(s) <= 250 && s.isWellFormed()))
  assert.throws(() => unpackTrainerDocument('[1,1,[],["X"],0,[]]'))
})
const file = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8')

// Drive the same typed tree the game sees, without opening the installed game.
function backupsView() {
  const player = { slot: 2, pawn: () => undefined }
  const committed = []
  let tree
  const node = (kind, props = {}) => ({ kind, ...props })
  const api = vm.createContext({
    heroes: [], jsx: node, show(_, children) { tree = children }, simulationTime: () => 0,
    session: { phase: 'ready' }, soulStats: () => ({}), scoreFields: () => ({}),
    settingsSnapshot: () => reference.settings, characterFields: () => ({}),
    characterChanging: () => false, nativeStorageLoading: () => false,
    nativeLibraryStatus: () => ({ ready: true }), nativeBackupAvailable: () => true,
    arenaHud: () => null, closeButton: () => null, palette: {},
    column: (children) => node('panel', { children }), row: (children) => node('panel', { children }),
    heading: (text) => node('label', { text }), note: (text) => node('label', { text }),
    button: (text, onPress) => node('button', { text, onPress }),
    exportTrainerData: () => JSON.stringify(reference),
    backupProblem: (raw) => raw === '{}' ? 'Invalid backup' : undefined,
    importNativeDocument: (owner, raw, done) => { committed.push({ owner, raw }); done('Imported.') },
  })
  const source = file('native/interface.ts').replace(/^import .*$/gm, '').replace(/^export /gm, '')
  vm.runInContext(stripTypeScriptTypes(source), api)
  const view = vm.runInContext('TrainerInterface', api)
  new view(player).preview('Saved', 'Backups')
  function find(kind, text) {
    const walk = (value) => Array.isArray(value) ? value.flatMap(walk) : value?.kind ? [value, ...walk(value.children)] : []
    return walk(tree).find((item) => item.kind === kind && (text === undefined || item.text === text))
  }
  return { committed, find, player }
}

test('typed backups export plain text and replace data only after current-player confirmation', () => {
  const { committed, find, player } = backupsView()
  find('button', 'Export backup').onPress()
  assert.deepEqual(JSON.parse(find('documentOutput').text), reference)
  const raw = JSON.stringify({ ...reference, profiles: [{ id: 1, name: '雪🌿', settings: reference.settings }] })
  const form = find('documentInput')
  form.onSubmit({ slot: 8 }, raw)
  assert.equal(find('button', 'Confirm'), undefined)
  form.onSubmit(player, '{}')
  assert.ok(find('label', 'Invalid backup'))
  form.onSubmit(player, raw)
  assert.equal(committed.length, 0)
  find('button', 'Cancel').onPress()
  assert.equal(committed.length, 0)
  find('documentInput').onSubmit(player, raw)
  const confirm = find('button', 'Confirm')
  confirm.onPress()
  confirm.onPress()
  assert.deepEqual(committed, [{ owner: player, raw }])
})
function accountService() {
  let read,
    tick,
    local,
    writer,
    timePrefs = reference.settings
  const calls = [],
    gets = [],
    pending = [],
    current = { phase: 'ready' }
  const player = { connection: () => ({ steamId: 76561197960265728n }) }
  const api = vm.createContext({
    persist: {
      get() {
        return read
      },
      getMany(players, type) {
        gets.push(type)
      },
      update(owner, key, change, opts, reply) {
        calls.push(readRecord(Object.fromEntries(Object.entries(change).map(([k, v]) => [k, v.set]))))
        pending.push(reply)
      },
    },
    sequence(fn) {
      tick = fn
    },
    resetTraining() {},
    resetCharacterSession() {},
    session: current,
    applyConfiguration(value) {
      timePrefs = value || reference.settings
    },
    settingsSnapshot() {
      return timePrefs
    },
    attachTrainerDocument(owner, raw, write) {
      writer = write
      local = raw ? JSON.parse(raw) : { ...reference, profiles: [] }
      return local.settings
    },
    saveConfiguration(settings) {
      if (settings === local.settings) return true
      const next = { ...local, settings }
      if (writer(JSON.stringify(next))) {
        local = next
        return true
      }
      return false
    },
    parseTrainerDocument(raw) {
      try {
        return JSON.parse(raw)
      } catch {}
    },
    unavailableLibrary() {
      return false
    },
    packTrainerDocument,
    readRecord,
    recordParts,
    recordUpdate,
  })
  vm.runInContext(
    stripTypeScriptTypes(
      file('native/storage.ts')
        .replace(/^import .*$/gm, '')
        .replace(/^export /gm, ''),
    ),
    api,
  )
  return {
    api,
    calls,
    gets,
    current,
    player,
    login() {
      read = { state: 'loading' }
      api.openNativeStorage(player)
    },
    loaded(doc = reference) {
      read = { state: 'loaded', record: asRecord(recordParts(packTrainerDocument(doc))) }
    },
    poll(i = 1) {
      return tick(i)
    },
    receipt(ok) {
      pending.shift()(ok ? {} : undefined, ok ? undefined : 'failure')
    },
    edit(s) {
      timePrefs = s
      return api.saveConfiguration(s)
    },
    get settings() {
      return timePrefs
    },
    get library() {
      return local.profiles
    },
  }
}

test('delayed account reads never overwrite a temporary session or the existing library on recovery', () => {
  const s = accountService()
  s.login()
  assert.equal(s.poll(), 0.15)
  s.poll(81)
  assert.equal(s.api.nativeStorageLoading(), false)
  assert.equal(s.api.nativeLibraryStatus().ready, false)
  const temporary = reference.settings + ',timer=557'
  assert.equal(s.edit(temporary), false)
  s.api.retryNativeSave()
  assert.equal(s.gets.length, 1)
  assert.equal(s.poll(), 0.15)
  s.loaded()
  s.poll(2)
  assert.equal(s.settings, temporary)
  assert.equal(s.calls.length, 0)
  assert.equal(JSON.stringify(s.library), JSON.stringify(reference.profiles))
  s.api.retryNativeSave()
  assert.equal(JSON.parse(s.calls[0]).settings, temporary)
  assert.deepEqual(JSON.parse(s.calls[0]).profiles, reference.profiles)
})
test('cloud updates serialize and retry the latest snapshot, and old account acknowledgements are ignored', () => {
  const s = accountService()
  s.login()
  s.loaded()
  s.poll()
  s.edit(reference.settings + ',timer=700')
  s.edit(reference.settings + ',timer=701')
  s.edit(reference.settings + ',timer=702')
  assert.equal(s.calls.length, 1)
  s.receipt(true)
  assert.equal(s.calls.length, 2)
  assert.equal(JSON.parse(s.calls[1]).settings, reference.settings + ',timer=702')
  s.receipt(false)
  assert.equal(s.api.nativeLibraryStatus().retry, true)
  s.api.retryNativeSave()
  assert.equal(s.calls[1], s.calls[2])
  s.api.closeNativeStorage()
  s.login()
  s.receipt(true)
  assert.equal(s.api.nativeStorageLoading(), true)
  s.loaded()
  s.poll()
  assert.equal(s.settings, reference.settings)
})
test('cloud import changes live gameplay only after acknowledgement; an ambiguous failure requires an account read', () => {
  const s = accountService()
  s.login()
  s.loaded()
  s.poll()
  const changed = JSON.stringify({ ...reference, settings: reference.settings + ',timer=200' }),
    replies = []
  s.api.importNativeDocument(s.player, changed, (msg, ok) => replies.push(ok))
  assert.equal(s.api.nativeStorageLoading(), true)
  assert.equal(s.settings, reference.settings)
  s.receipt(false)
  assert.deepEqual(replies, [false])
  assert.equal(s.settings, reference.settings)
  assert.equal(s.api.nativeLibraryStatus().ready, false)
  s.api.retryNativeSave()
  assert.equal(s.poll(), 0.15)
  s.loaded()
  s.poll()
  s.api.importNativeDocument(s.player, changed, (msg, ok) => replies.push(ok))
  s.receipt(true)
  assert.deepEqual(replies, [false, true])
  assert.equal(s.settings, reference.settings + ',timer=200')
})
