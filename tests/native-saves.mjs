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
function transfers(initial, includeDrop) {
  const callbacks = [],
    routes = {},
    panels = new Map(),
    labels = {},
    messages = []
  const panel = (id) => {
    if (!panels.has(id)) panels.set(id, { text: '', SetHasClass() {} })
    return panels.get(id)
  }
  const root = { FindChildTraverse: panel },
    player = {},
    state = { view: 'main', section: 'backups' }
  let time = 0,
    dropped = false,
    max = 0,
    current = initial,
    loaded = 0
  const schedule = (delay, fn) => callbacks.push({ time: time + delay, fn })
  const server = vm.createContext({
    session: { phase: 'ready' },
    nativeBackupAvailable: () => true,
    exportTrainerData: () => JSON.stringify(current),
    packTrainerDocument,
    unpackTrainerDocument,
    settingsSnapshot: () => current.settings,
    route(_, name, value) {
      schedule(0.02, () => routes[name]?.(value))
      return true
    },
    importNativeDocument(p, data, done) {
      schedule(0.18, () => {
        current = JSON.parse(data)
        loaded++
        done('Imported.', true)
      })
    },
  })
  vm.runInContext(
    stripTypeScriptTypes(
      file('native/backup.ts')
        .replace(/^import .*$/gm, '')
        .replace(/^export /gm, ''),
    ),
    server,
  )
  const ui = vm.createContext({
    $: { Schedule: schedule },
    ParryTrainerRoot: () => root,
    ParryTrainerCanProfile: () => true,
    ParryTrainerProfiles: state,
    ParryTrainerText(r, id, msg) {
      labels[id] = msg
      messages.push(msg)
    },
    ParryTrainerProfileOverview() {
      state.view = 'main'
    },
    ParryTrainerProfileView(view, action) {
      Object.assign(state, { view, action })
    },
    ParryTrainerSetSettingsReady() {},
    ParryTrainerInvalidateScore() {},
    packTrainerDocument,
    unpackTrainerDocument,
    recordParts,
    Modlock: {
      route(name, fn) {
        routes[name] = fn
      },
      onUnload() {},
      press(name, packet) {
        const bytes = Buffer.byteLength(JSON.stringify(packet))
        max = Math.max(max, bytes)
        assert.ok(bytes <= 180)
        if (includeDrop && !dropped && packet[0] === 'put' && packet[2] !== 0) {
          dropped = true
          return true
        }
        schedule(0.02, () => server.nativeBackupAction(player, packet))
        return true
      },
    },
  })
  vm.runInContext(file('native/backup-client.js'), ui)
  ui.ParryTrainerNativeBackupInitialize(root)
  return {
    ui,
    panel,
    labels,
    messages,
    get current() {
      return current
    },
    get loaded() {
      return loaded
    },
    get max() {
      return max
    },
    get dropped() {
      return dropped
    },
    run() {
      for (let i = 0; callbacks.length && i < 5000; i++) {
        callbacks.sort((a, b) => a.time - b.time)
        const next = callbacks.shift()
        time = next.time
        next.fn()
      }
      assert.equal(callbacks.length, 0)
    },
  }
}
test('portable backup exports readable JSON and imports only after confirmation, even with a dropped action', () => {
  const stub = transfers(reference, true),
    entry = stub.panel('ParryTrainerBackupText')
  stub.ui.ParryTrainerNativeBackupRequest('export')
  stub.run()
  assert.deepEqual(JSON.parse(entry.text), reference)
  assert.match(stub.labels.ParryTrainerBackupFeedback, /text field/)
  const changed = structuredClone(reference)
  changed.profiles[0].name = '⚒️🪄「\u0022🌹\u0022」'
  changed.settings += ',timer=333'
  entry.text = JSON.stringify(changed)
  stub.ui.ParryTrainerNativeBackupRequest('import')
  assert.equal(stub.loaded, 0)
  assert.equal(stub.ui.ParryTrainerNativeBackupProceed(), true)
  stub.run()
  assert.ok(stub.dropped)
  assert.ok(stub.max <= 180)
  assert.equal(stub.loaded, 1)
  assert.deepEqual(stub.current, changed)
  assert.equal(stub.labels.ParryTrainerBackupFeedback, 'Imported.')
})


test('the renamed trainer imports a backup exported under its previous name', () => {
  const stub = transfers(reference, false)
  const entry = stub.panel('ParryTrainerBackupText')
  entry.text = JSON.stringify({ ...reference, format: 'parry-void' })
  stub.ui.ParryTrainerNativeBackupRequest('import')
  assert.equal(stub.ui.ParryTrainerNativeBackupProceed(), true)
  stub.run()
  assert.equal(stub.loaded, 1)
  assert.deepEqual(stub.current, reference)
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
    profiles() {
      return local.profiles
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
  }
}

test('delayed account reads never overwrite a temporary session or the existing library on recovery', () => {
  const s = accountService()
  s.login()
  assert.equal(s.poll(), 0.15)
  s.poll(81)
  assert.equal(s.api.nativeStorageLoading(), false)
  assert.equal(s.api.nativeScoreStorage({}, true).SettingsSaveError, 'offline')
  const temporary = reference.settings + ',timer=557'
  assert.equal(s.edit(temporary), false)
  s.api.retryNativeSave()
  assert.equal(s.gets.length, 1)
  assert.equal(s.poll(), 0.15)
  s.loaded()
  s.poll(2)
  assert.equal(s.settings, temporary)
  assert.equal(s.calls.length, 0)
  assert.equal(JSON.parse(s.api.nativeScoreStorage({}, true).ProfileList).length, 3)
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
  assert.equal(s.api.nativeScoreStorage({}, true).SettingsSaveError, 'write')
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
  assert.equal(s.api.nativeScoreStorage({}, true).SettingsSaveError, 'offline')
  s.api.retryNativeSave()
  assert.equal(s.poll(), 0.15)
  s.loaded()
  s.poll()
  s.api.importNativeDocument(s.player, changed, (msg, ok) => replies.push(ok))
  s.receipt(true)
  assert.deepEqual(replies, [false, true])
  assert.equal(s.settings, reference.settings + ',timer=200')
})
