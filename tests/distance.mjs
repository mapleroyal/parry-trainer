import assert from 'node:assert/strict'
import { test } from 'node:test'
import { approachOffset, sampleDistance } from '../attack-distance.ts'
import { meleeRange } from '../melee-range.js'

const { closest, farthest } = meleeRange

test('melee waits use seconds, independent random rolls and the favored weight within both limits', () => {
  assert.deepEqual([0, 50, 100].map(p => meleeRange.seconds(p)), [1, 3.5, 6])
  assert.equal(meleeRange.formatSeconds(75), '4.75 s')
  for (const [min, max] of [[0, 100], [0, 25], [75, 100], [32, 32]]) {
    const shortest = meleeRange.seconds(min), longest = meleeRange.seconds(max)
    let previousMean = 0
    for (const bias of [0, 25, 50, 75, 100]) {
      const draw = roll => meleeRange.interval(min, max, bias, roll)
      assert.equal(draw(0.024), shortest)
      assert.equal(draw(0.976), longest)
      assert.equal(draw(0.025 + 0.95 * bias / 100), meleeRange.seconds(meleeRange.favored(min, max, bias)))
      let sum = 0, last = shortest
      for (let i = 0; i < 1000; i++) {
        const value = draw((i + 0.5) / 1000)
        assert.ok(last <= value && value <= longest)
        sum += value
        last = value
      }
      const mean = sum / 1000
      if (min !== max) assert.ok(mean > previousMean)
      if (bias === 50) assert.ok(Math.abs(mean - (shortest + longest) / 2) < 1e-9)
      previousMean = mean
    }
  }
})

test('fixed bounds start at the selected physical distance without drawing a random number', () => {
  for (const bound of [0, 40, 99, 100]) {
    for (const bias of [0, 50, 100]) {
      assert.equal(sampleDistance({ minimum: bound, maximum: bound, bias }, () => assert.fail()),
        closest + (farthest - closest) * bound / 100)
    }
  }
  assert.equal(meleeRange.metres(0), 10 * 0.0254)
  assert.equal(meleeRange.metres(100), 529.4 * 0.0254)
})

test('moving the favored distance shifts the mean while keeping all rolls inside the selected bounds', () => {
  for (const [minimum, maximum] of [[0, 100], [50, 100], [27, 28], [10, 64]]) {
    const lo = meleeRange.units(minimum), hi = meleeRange.units(maximum)
    for (const bias of [0, 10, 50, 77, 100]) {
      const draw = u => sampleDistance({ minimum, maximum, bias }, () => u)
      assert.equal(draw(0), lo)
      assert.equal(draw(1), hi)
      let sum = 0, previous = lo
      const count = 2000
      for (let i = 0; i < count; i++) {
        const d = draw((i + 0.5) / count)
        assert.ok(d >= previous && d <= hi)
        previous = d
        sum += d
      }
      const expected = lo + (hi - lo) * (1 + 2 * bias / 100) / 4
      assert.ok(Math.abs(sum / count - expected) < (hi - lo) / count)
    }
  }
})

test('middle weighting clusters around the center and an edge weight still includes the far half', () => {
  const range = { minimum: 0, maximum: 100, bias: 50 }
  const draw = u => sampleDistance(range, () => u)
  const mid = meleeRange.units(50)
  assert.equal(draw(0.5), mid)
  // Seven eighths of Normal's rolls land inside the middle half of its interval.
  assert.equal(draw(1 / 16), meleeRange.units(25))
  assert.equal(draw(15 / 16), meleeRange.units(75))
  for (const u of [0.001, 0.03, 0.25, 0.45])
    assert.ok(Math.abs(draw(u) + draw(1 - u) - 2 * mid) < 1e-8)
  range.bias = 0
  assert.equal(draw(7 / 8), mid) // One heavy in eight still originates beyond halfway.
  range.bias = 100
  assert.equal(draw(1 / 8), mid)
})

test('placing attacks at floor and in air preserves distance and limits only the longest bearings', () => {
  for (const distance of [closest, (closest + farthest) / 2, farthest]) {
    for (const aboveFloor of [0, 5, 200, 680]) {
      for (const elevation of [-1, 0, 1]) {
        for (let step = 0; step < 32; step++) {
          const azimuth = Math.PI * step / 16
          const { x, y, z } = approachOffset(distance, azimuth, elevation, aboveFloor)
          const h = Math.hypot(x, y)
          assert.ok(h >= 8 - 1e-9)
          assert.ok(z + aboveFloor >= 0)
          assert.ok(Math.abs(Math.hypot(x, y, z) - distance) < 1e-9)
          if (distance < 521) {
            assert.ok(Math.abs(x / h - Math.cos(azimuth)) < 1e-9)
            assert.ok(Math.abs(y / h - Math.sin(azimuth)) < 1e-9)
          } else if (distance === farthest) {
            assert.ok(Math.abs(Math.abs(x) - Math.abs(y)) < 1e-9)
          }
        }
      }
    }
  }
})

test('the upper reach retains all four directions and narrows them continuously', () => {
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const axis = quadrant * Math.PI / 2
    const diagonal = axis + Math.PI / 4
    for (const [distance, expected] of [[521, axis], [(521 + farthest) / 2, (axis + diagonal) / 2], [farthest, diagonal]]) {
      const p = approachOffset(distance, axis, 1, 0)
      assert.equal(p.z, 0)
      assert.ok(Math.abs(p.x - distance * Math.cos(expected)) < 1e-9)
      assert.ok(Math.abs(p.y - distance * Math.sin(expected)) < 1e-9)
    }
  }
})

test('long starts stay at the selected separation during a jump', () => {
  for (const [height, vz, expectedSide] of [[50, 220, 1], [80, 0, -1], [75, -220, -1], [700, 300, 1], [700, -200, -1]]) {
    const { x, y, z, verticalSpeed } = approachOffset(farthest, Math.PI, 0.8, height, vz)
    assert.equal(Math.sign(z), expectedSide)
    assert.ok(Math.abs(Math.hypot(x, y, z) - farthest) < 1e-9)
    assert.ok(height + z >= 0)
    if (expectedSide === 1) assert.ok(verticalSpeed < 0)
    if (height + z === 0) assert.equal(verticalSpeed, 0)
  }
})
