import assert from 'node:assert/strict'
import test from 'node:test'
import settings from '../difficulty-settings.js'
import { meleeRange } from '../melee-range.js'

const { createPresetSettings, presetSettingKeys } = settings
const defaults = { melee_min: 50, melee_max: 100, melee_bias: 50, interval_min: 0, interval_max: 100, interval_bias: 50,
  trooper_speed: 50, trooper_count: 1, camp_tier: 1, hit_limit: 3,
  effects: false, parried: false, stamina: true, cooldown: false, second: false, troopers: false,
  trooper_active: false, camps: false, camp_reactive: true, death: false, fail_on_death: false,
  fail_on_hits: false, idle_drain: true, idle_rate: 25, penalty_hit: false, penalty_unparried: false, penalty_whiff: false }
const values = model => Object.fromEntries(presetSettingKeys.map(key => [key, model.get(key)]))
const distances = model => ['melee_min', 'melee_max', 'melee_bias'].map(key => model.get(key))

test('Normal is the baseline, and all pristine presets increase challenge monotonically', () => {
  const model = createPresetSettings()
  assert.deepEqual(values(model), defaults)
  for (let n = 0; n <= 100; n++) {
    const previous = values(model)
    model.setPreset(n)
    const current = values(model)
    if (n === 0) assert.deepEqual(distances(model), [100, 100, 50])
    if (n === 50) assert.deepEqual(current, defaults)
    if (n < 100) assert.ok(current.melee_min >= 16 && current.melee_max === 100)
    if (n === 100) assert.deepEqual(distances(model), [0, 100, 0])
    if (n) for (const key of presetSettingKeys) {
      const sign = ['effects', 'parried', 'stamina', 'hit_limit', 'melee_min', 'melee_bias', 'interval_min', 'interval_max', 'interval_bias'].includes(key) ? -1 : 1
      assert.ok(sign * (Number(current[key]) - Number(previous[key])) >= 0, key + ' at ' + n)
    }
    assert.equal(model.get('idle_drain'), n > 0)
    assert.equal(model.get('fail_on_death'), n === 100)
    assert.equal(model.get('parried'), n === 0)
  }
})

test('interval bounds, weight, saved timing and legacy drills stay independent of distance', () => {
  const model = createPresetSettings()
  const timing = () => ['interval_min', 'interval_max', 'interval_bias'].map(key => model.get(key))
  for (const [pos, expected] of [[0, [80, 100, 75]], [50, [0, 100, 50]], [100, [0, 20, 25]]]) {
    model.setPreset(pos)
    assert.deepEqual(timing(), expected)
    const d = distances(model)
    model.setPreference('interval_min', 98)
    model.setPreference('interval_max', 0)
    assert.equal(model.get('interval_min'), model.get('interval_max'))
    model.setPreference('interval_bias', 7)
    const saved = timing()
    model.restore(model.snapshot().join(','))
    assert.deepEqual(timing(), saved)
    assert.deepEqual(distances(model), d)
    model.restore('preset=' + pos + ',version=4')
    assert.deepEqual(timing(), [18, 100, 50])
    model.restore(model.snapshot().join(','))
    assert.deepEqual(timing(), [18, 100, 50])
  }
  model.restore('')
  assert.deepEqual(timing(), [0, 100, 50])
})

test('version 5 snapshots and saved drills retain every original wait, including partial and fixed ranges', () => {
  const model = createPresetSettings()
  for (let p = 0; p <= 100; p++) {
    const minimum = Math.round(1.5 * Math.max(0, 50 - p))
    const maximum = 100 - Math.round(1.5 * Math.max(0, p - 50))
    const bias = 75 - Math.round(p / 2)
    for (const [fields, lo, hi, weight] of [
      ['', minimum, maximum, bias],
      [',interval_min=' + Math.min(maximum, p), Math.min(maximum, p), maximum, bias],
      [',interval_max=' + Math.max(minimum, p), minimum, Math.max(minimum, p), bias],
      [',interval_max=' + p + ',interval_min=' + p + ',interval_bias=33', p, p, 33]
    ]) {
      model.restore('preset=' + p + ',version=5' + fields)
      for (let i = 0; i < 2; i++) {
        assert.equal(Math.round(meleeRange.seconds(model.get('interval_min')) * 1000), 1900 + 41 * lo)
        assert.equal(Math.round(meleeRange.seconds(model.get('interval_max')) * 1000), 1900 + 41 * hi)
        assert.equal(model.get('interval_bias'), weight)
        model.restore(model.snapshot().join(','))
      }
    }
  }
})

test('distance controls stop at the opposite bound and keep the weight when the range collapses', () => {
  const model = createPresetSettings()
  model.setPreference('melee_bias', 73)
  model.setPreference('melee_max', 25)
  assert.deepEqual(values(model), { ...defaults, melee_max: 50, melee_bias: 73 })
  model.setPreference('melee_min', 15)
  model.setPreference('melee_max', 65)
  model.setPreference('melee_min', 92)
  assert.deepEqual(distances(model), [65, 65, 73])
  model.setPreference('melee_min', 0)
  assert.deepEqual(distances(model), [0, 65, 73])
  assert.equal(model.preset, 50)
  assert.deepEqual(values(model), { ...defaults, melee_min: 0, melee_max: 65, melee_bias: 73 })
})

test('distance snapshots restore all three controls in either order without transient clipping', () => {
  const model = createPresetSettings()
  for (const position of [0, 50, 100]) {
    for (const [min, max, bias] of [[0, 0, 19], [0, 25, 75], [90, 96, 15], [100, 100, 80]]) {
      const range = ['melee_min=' + min, 'melee_max=' + max, 'melee_bias=' + bias]
      for (const fields of [range, range.toReversed()]) {
        model.restore('preset=' + position + ',version=4,' + fields.join(','))
        assert.deepEqual(distances(model), [min, max, bias])
        model.restore(model.snapshot().join(','))
        assert.deepEqual(distances(model), [min, max, bias])
      }
    }
  }
})

test('old template ranges adopt new bounds and customized legacy distances retain their intent', () => {
  const model = createPresetSettings()
  for (const position of [0, 50, 99, 100]) {
    model.setPreset(position)
    const expected = distances(model)
    for (const version of [2, 3]) {
      for (const fields of ['', ',difficulty=' + position]) {
        model.restore('preset=' + position + ',version=' + version + fields)
        assert.deepEqual(distances(model), expected)
      }
    }
  }
  for (const [old, expected] of [[0, [100,100,50]], [15, [0,100,100]], [30, [0,100,90]],
                                [70,[0,100,10]], [85,[0,100,0]], [100,[0,0,50]]]) {
    model.restore('preset=50,version=3,difficulty=' + old + ',troopers=1')
    assert.deepEqual(distances(model), expected)
    assert.equal(model.get('troopers'), true)
  }
})

test('adjustments persist over reload and every preset move replaces them, including quick reversals', () => {
  const m = createPresetSettings()
  const clean = createPresetSettings()
  for (const [start, end] of [[0, 1], [40, 39], [50, 100], [100, 99], [98, 0], [55, 55]]) {
    m.setPreset(start)
    m.setPreference('trooper_speed', 36)
    m.setPreference('idle_drain', false)
    m.setPreference('idle_rate', 32)
    m.setPreference('death', true)
    m.setPreference('fail_on_death', false)
    assert.equal(m.customized(), true)
    const before = values(m)
    m.restore(m.snapshot().join(','))
    assert.equal(m.preset, start)
    assert.deepEqual(values(m), before)
    m.setPreset(end)
    clean.setPreset(end)
    assert.deepEqual(values(m), values(clean))
    assert.equal(m.customized(), false)
  }
  m.setPreference('melee_bias', 22)
  m.reapply()
  assert.deepEqual(values(m), values(clean))
})

test('drain rate rises from 15% to 25% to 50%, and the easiest setting allows standing still', () => {
  const m = createPresetSettings()
  for (const [pos, enabled, rate] of [[0, false, 15], [1, true, 15], [25, true, 20], [50, true, 25],
                                      [75, true, 38], [100, true, 50]]) {
    m.setPreset(pos)
    assert.equal(m.get('idle_drain'), enabled)
    assert.equal(m.get('idle_rate'), rate)
  }
  m.setPreference('idle_rate', 42)
  m.setPreference('idle_drain', false)
  m.setPreference('idle_drain', true)
  assert.equal(m.get('idle_rate'), 42)
})

test('previous preset files migrate the choices that were active when the player quit', () => {
  const m = createPresetSettings()
  m.restore('preset=100,manual_difficulty=21,edge_trooper_speed=37,edge_fail_on_idle=0,edge_death_mode=1,timer=837')
  assert.equal(m.get('trooper_speed'), 37)
  assert.deepEqual(distances(m), [0, 100, 0])
  assert.equal(m.get('idle_drain'), false)
  assert.equal(m.get('death'), true)
  assert.equal(m.get('fail_on_death'), false)
  m.setPreset(99)
  assert.equal(m.get('trooper_speed'), 99)
  assert.equal(m.get('idle_drain'), true)
  m.restore('preset=65,manual_troopers=0,manual_fail_on_idle=1,manual_death_mode=2')
  assert.equal(m.get('troopers'), false)
  assert.equal(m.get('idle_drain'), true)
  assert.equal(m.get('death'), true)
  assert.equal(m.get('fail_on_death'), true)
  m.restore('preset=50')
  assert.deepEqual(values(m), { ...defaults, interval_min: 18 })
})

test('saved earlier drills keep their effective settings and load under the new Normal preset', () => {
  const model = createPresetSettings()
  const base = 'effects=0,cooldown=0,death=0,fail_on_death=0,trooper_active=0,camp_reactive=1'
  model.restore(base + ',difficulty=100,death=0,fail_on_death=0,fail_on_idle=1,troopers=1,trooper_count=3')
  assert.equal(model.preset, 50)
  assert.deepEqual(values(model), { ...defaults, interval_min: 18, melee_min: 0, melee_max: 0, cooldown: true, trooper_active: true,
    idle_drain: true, troopers: true, trooper_count: 3 })
  const before = values(model)
  model.restore(model.snapshot().join(','))
  assert.deepEqual(values(model), before)
  model.restore(base + ',difficulty=50')
  assert.deepEqual(values(model), { ...defaults, interval_min: 18 })
  model.restore(base + ',difficulty=0')
  assert.deepEqual(values(model), { ...defaults, interval_min: 18, melee_min: 100, effects: true, camp_reactive: false })
})

test('death can end the run for either source, and each source can also allow respawn', () => {
  const m = createPresetSettings()
  for (const position of [50, 100]) {
    m.setPreset(position)
    for (const drain of [true, false]) for (const lethal of [true, false]) for (const loss of [true, false]) {
      m.setPreference('death', lethal)
      m.setPreference('idle_drain', drain)
      m.setPreference('fail_on_death', loss)
      assert.deepEqual([m.get('death'), m.get('idle_drain'), m.get('fail_on_death')], [lethal, drain, loss])
    }
  }
})

test('soul penalties are independent and older saved presets keep charging zero until reapplied', () => {
  const model = createPresetSettings()
  const keys = ['penalty_hit', 'penalty_unparried', 'penalty_whiff']
  const penalties = () => keys.map(key => model.get(key))
  const off = [false, false, false]
  for (const [position, expected] of [[50, off], [69, off], [70, [true, false, false]],
    [84, [true, false, false]], [85, [true, true, false]], [99, [true, true, false]], [100, [true, true, true]]]) {
    model.setPreset(position)
    assert.deepEqual(penalties(), expected)
  }
  for (const saved of ['preset=100,version=2', 'preset=100,edge_trooper_speed=30']) {
    model.restore(saved)
    assert.deepEqual(penalties(), off)
    model.restore(model.snapshot().join(','))
    assert.deepEqual(penalties(), off)
    model.reapply()
    assert.deepEqual(penalties(), [true, true, true])
  }
  for (let mask = 0; mask < 8; mask++) {
    model.setPreset(50)
    const expected = keys.map((key, index) => {
      const enabled = Boolean(mask & (1 << index))
      assert.equal(model.setPreference(key, enabled), true)
      return enabled
    })
    model.restore(model.snapshot().join(','))
    assert.deepEqual(penalties(), expected)
  }
})

test('reject malformed slider or toggle values and update only affected gameplay controls', () => {
  const changes = []
  const model = createPresetSettings((key, value) => changes.push([key, value]))
  for (const v of [-1, '101', '12.4', null, '']) assert.equal(model.setPreset(v), false)
  for (const [k, v] of [['trooper_speed', 9], ['death_mode', 2], ['troopers', 8], ['hit_limit', 0],
    ['camp_tier', 4], ['fail_on_idle', 1], ['idle_rate', 14], ['idle_rate', 51], ['timer', 90], ['hero2', true], ['melee_min', -1], ['melee_bias', 101], ['melee_max', 0.1]]) assert.equal(model.setPreference(k, v), false)
  assert.deepEqual(changes, [])
  model.setPreference('melee_min', 100)
  assert.deepEqual(changes, [['melee_min', 100]])
  model.setPreference('fail_on_death', true)
  assert.deepEqual(changes.slice(1), [['fail_on_death', true]])
})
