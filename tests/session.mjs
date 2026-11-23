import assert from 'node:assert/strict'
import test from 'node:test'
import { PracticeSession, parseLimit } from '../session.ts'

test('a timed run counts three whole seconds before the clock starts', () => {
  const s = new PracticeSession()
  assert.equal(s.phase, 'ready')
  assert.equal(s.begin(parseLimit('timer 4'), 10), true)
  assert.equal(s.begin(parseLimit('goal 1'), 11), false)
  for (const [now, left] of [[10,3], [11,2], [12,1], [12.99,1]]) {
    s.tick(now, 0)
    assert.equal(s.phase, 'countdown')
    assert.equal(s.remaining(now), left)
  }
  s.tick(13, 0)
  assert.equal(s.phase, 'running')
  assert.equal(s.remaining(13), 4)
  s.tick(16.999, 0)
  assert.equal(s.phase, 'running')
  s.tick(17, 0)
  assert.equal(s.phase, 'finished')
  assert.equal(s.reason, 'time')
  assert.equal(s.remaining(80), 0)
})
test('the soul goal uses earned points after deductions and the next run starts fresh', () => {
  const s = new PracticeSession()
  s.begin({mode:'goal', parries:1, souls:2}, 0)
  s.tick(3, 0)
  s.parries = 1
  assert.equal(s.deductSouls(0, 3), 0)
  assert.equal(s.soulScore(1), 1)
  assert.equal(s.deductSouls(1, 2), 1)
  s.tick(4, 2)
  assert.equal(s.phase, 'running')
  s.tick(5, 3)
  assert.equal(s.reason, 'goal')
  s.begin({mode:'none'}, 8)
  assert.equal(s.soulsDeducted, 0)
  assert.equal(s.runId, 2)
})

test('a delayed first scored frame still gets the full time limit', () => {
  const s = new PracticeSession()
  s.begin(parseLimit('timer 1'), 10)
  s.tick(13.75, 0)
  s.tick(14, 0)
  assert.equal(s.phase, 'running')
  assert.equal(s.remaining(14), 1)
  s.tick(14.75, 0)
  assert.equal(s.reason, 'time')
})
test('goal, unlimited, manual stop and fresh defaults', () => {
  const s = new PracticeSession()
  s.begin(parseLimit('goal 2'), 1)
  s.tick(4, 0)
  s.parries++
  s.tick(1024, 0)
  assert.equal(s.phase, 'running')
  s.parries++
  s.tick(1025, 0)
  assert.equal(s.reason, 'goal')
  assert.equal(s.begin(parseLimit('none'), 1026), true)
  assert.equal(s.parries, 0)
  s.tick(1e6, 0)
  assert.equal(s.phase, 'running')
  s.finish('stopped', 1e6)
  s.reset()
  assert.equal(s.phase, 'ready')
  assert.equal(s.reason, undefined)
  assert.equal(s.limit.mode, 'none')
  assert.equal(s.remaining(1e6), 0)
})
test('accepts exactly one supported condition', () => {
  for (const input of ['none 5', 'timer', 'timer 0', 'goal -1', 'goal 10000', 'timer 86401',
    'timer 1 goal 1', 'time 30', 'goal 1.5', 'goal 01', '']) assert.equal(parseLimit(input), undefined, input)
  assert.deepEqual(parseLimit('timer 86400'), {mode:'timer',value:86400})
  assert.deepEqual(parseLimit('goal 9999'), {mode:'goal',parries:9999,souls:0})
})

test('either goal can finish on its own, and both can finish in either order', () => {
  for (const [command, milestones] of [
    ['goal 0 2', [[12,1], [12,2]]],
    ['goal 2 0', [[1,80], [2,80]]],
    ['goal 2 3', [[1,1], [2,2], [3,3]]],
    ['goal 2 3', [[0,3], [1,5], [2,5]]],
  ]) {
    const s = new PracticeSession()
    assert.equal(s.begin(parseLimit(command), 0), true)
    for (const [i, [parries, souls]] of milestones.entries()) {
      s.parries = parries
      s.tick(3 + i, souls)
      assert.equal(s.phase, i === milestones.length - 1 ? 'finished' : 'running', command)
    }
  }
  for (const input of ['goal 0', 'goal 0 0', 'goal 0 10000', 'goal 0 -1', 'goal 2 1 1', 'goal 01 01'])
    assert.equal(parseLimit(input), undefined, input)
})

test('the chosen heavy hit ends the run and the next run can have no hit limit', () => {
  const s = new PracticeSession()
  s.begin({ mode: 'none' }, 0, 2)
  s.tick(3, 0)
  s.parries = 5
  s.hits = 1
  s.tick(4, 0)
  assert.equal(s.phase, 'running')
  assert.equal(s.begin({ mode: 'none' }, 4, 1), false)
  assert.equal(s.hitLimit, 2)
  s.hits++
  s.tick(5, 0)
  assert.equal(s.settlingHit, true)
  s.tick(5.016, 0)
  assert.equal(s.reason, 'hits')
  assert.equal(s.hits, 2)
  assert.equal(s.hitLimit, 2)
  s.begin({ mode: 'none' }, 6)
  assert.equal(s.hitLimit, 0)
  assert.equal(s.hits, 0)
  s.tick(9, 0)
  s.hits = 20
  s.tick(10, 0)
  assert.equal(s.phase, 'running')
})

test('death, hit limit, then wins decide simultaneous outcomes', () => {
  for (const limit of [{mode:'timer', value:1}, {mode:'goal', parries:1, souls:0}]) {
    for (const deathLoss of [false, true]) {
      const s = new PracticeSession()
      s.begin(limit, 0, 1)
      s.tick(3, 0)
      s.parries = s.hits = 1
      s.tick(4, 0, deathLoss)
      s.tick(4.016, 0)
      assert.equal(s.reason, deathLoss ? 'death' : 'hits')
      s.tick(5, 0, true)
      assert.equal(s.reason, deathLoss ? 'death' : 'hits')
      s.reset()
      assert.equal(s.hitLimit, 0)
    }
  }
})

test('the final contact resolves through the next native damage or parry callback', () => {
  const s = new PracticeSession()
  s.begin({mode:'none'}, 0, 1)
  s.hits++
  s.tick(4, 0)
  assert.equal(s.settlingHit, true)
  s.hits--
  s.parries++
  s.tick(4.016, 0)
  assert.equal(s.settlingHit, false)
  assert.equal(s.phase, 'running')
  s.hits++
  s.tick(5, 0)
  s.tick(5.016, 0, true)
  assert.equal(s.reason, 'death')
})

test('the HUD clock measures only the current scored session and freezes at its result', () => {
  const s = new PracticeSession()
  assert.equal(s.elapsed(600), 0)
  s.begin({mode:'none'}, 601)
  assert.equal(s.elapsed(603.9), 0)
  s.finish('stopped', 603.9)
  assert.equal(s.elapsed(800), 0)
  s.begin({mode:'goal', parries:2, souls:0}, 801)
  s.tick(804.5, 0)
  assert.equal(s.elapsed(804.99), 0)
  assert.equal(s.elapsed(867.8), 63)
  s.parries = 2
  s.tick(868.5, 0)
  assert.equal(s.elapsed(1e6), 64)
  s.begin({mode:'timer', value:5}, 1000)
  s.tick(1003.25, 0)
  assert.equal(s.remaining(1005.65), 3)
  assert.equal(s.elapsed(1005.65), 2)
  s.reset()
  assert.equal(s.elapsed(1006), 0)
})

test('a life has one death and the final cause survives only a death loss', () => {
  const s = new PracticeSession()
  s.begin({mode:'none'}, 0)
  s.tick(3, 0)
  assert.equal(s.recordDeath('standing-drain', 6.5), true)
  assert.equal(s.recordDeath('other', 6.52), false)
  assert.equal(s.deaths, 1)
  s.tick(5, 0)
  assert.equal(s.phase, 'running')
  s.recordRespawn()
  assert.equal(s.deathCause, undefined)
  assert.equal(s.recordDeath('other', 9.5), true)
  s.rulesChanged = true
  s.tick(8, 0, true)
  assert.equal(s.reason, 'death')
  s.recordRespawn() // The game still respawns the hero after the run is over.
  assert.equal(s.deathCause, 'other')
  assert.equal(s.respawnAt, 0)
  assert.equal(s.rulesChanged, true)
  s.begin({mode:'none'}, 10)
  assert.equal(s.deaths, 0)
  assert.equal(s.deathCause, undefined)
  assert.equal(s.rulesChanged, false)
})

test('resetting options keeps elapsed time and scores, removes captured targets, and preserves a finished result', () => {
  const session = new PracticeSession()
  session.begin({ mode: 'goal', parries: 6, souls: 3 }, 10, 2)
  session.tick(13, 0)
  session.parries = 2
  session.hits = 2
  session.tick(17, 1)
  assert.equal(session.settlingHit, true)
  session.restoreUnlimitedRules()
  session.tick(18, 1)
  assert.equal(session.rulesChanged, true)
  assert.equal(session.phase, 'running')
  assert.equal(session.elapsed(18), 5)
  assert.equal(session.parries, 2)
  assert.equal(session.hits, 2)
  assert.equal(session.limit.mode, 'none')
  assert.equal(session.settlingHit, false)
  session.finish('stopped', 20)
  session.begin({ mode: 'timer', value: 5 }, 25)
  session.tick(28, 0)
  session.tick(33, 0)
  session.restoreUnlimitedRules()
  assert.deepEqual(session.limit, { mode: 'timer', value: 5 })
  assert.equal(session.reason, 'time')
});

test('bullet accuracy counts live pellets once, ignores expired misses, and freezes and resets with the session', () => {
  const run = new PracticeSession()
  const shoot = () => { run.bulletFired(); run.bulletHitTarget(); run.bulletRemoved() }
  shoot()
  run.begin({ mode: 'goal', souls: 1, parries: 0 }, 0)
  shoot()
  assert.deepEqual([run.bulletsHit, run.bulletsFired], [0, 0])
  run.tick(3, 0)
  run.bulletFired()
  run.bulletRemoved() // A world hit or an expired bullet.
  run.bulletHitTarget() // A late notification cannot reclaim the miss.
  run.bulletFired()
  run.bulletHitTarget()
  run.bulletHitTarget() // The same in-flight round touched a second target.
  run.bulletRemoved()
  run.tick(4, 0)
  assert.equal(run.phase, 'running')
  assert.deepEqual([run.bulletsHit, run.bulletsFired], [1, 2])
  run.tick(5, 1)
  shoot()
  assert.deepEqual([run.bulletsHit, run.bulletsFired], [1, 2])
  run.begin({ mode: 'none' }, 6)
  assert.deepEqual([run.bulletsHit, run.bulletsFired], [0, 0])
})

test('pre-session flights retire separately and a replaced pawn gets a fresh flight budget', () => {
  const run = new PracticeSession()
  run.setBulletOwner(10)
  run.bulletFired() // A shot still flying at Begin.
  run.begin({ mode: 'none' }, 0)
  run.bulletFired() // A second shot during the countdown.
  run.tick(3, 0)
  run.bulletFired()
  run.bulletRemoved() // A ready-room miss cannot consume the new bullet.
  run.bulletHitTarget() // The countdown shot reaches a new trooper.
  run.bulletRemoved()
  run.bulletHitTarget()
  run.bulletRemoved()
  assert.deepEqual([run.bulletsHit, run.bulletsFired], [1, 1])
  run.bulletFired()
  run.setBulletOwner(20)
  run.bulletHitTarget() // No newly fired round can account for this.
  assert.deepEqual([run.bulletsHit, run.bulletsFired], [1, 2])
  run.bulletFired()
  run.bulletHitTarget()
  run.bulletRemoved()
  assert.deepEqual([run.bulletsHit, run.bulletsFired], [2, 3])
})
