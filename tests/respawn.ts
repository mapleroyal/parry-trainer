// Hold forward and primary fire through two real deaths, then through each native respawn.
import { addBot, Buttons, damage, log, onFrame, onKill, onSpawn, readField, serverCommand, vector, writeField,
  type Player, type Vector } from 'modlock'
import { setDeathEnabled, setFailOnDeath, testSubject } from '../gameplay'
import { session } from '../session'
import { stationaryDrain } from '../stationary-drain'

const weapon = 'CCitadel_Ability_PrimaryWeapon'
const aim = vector.level(0)

export default function registerRespawnProbe(): void {
  let trainee: Player | undefined, enemy: Player | undefined
  let phase: 'setup' | 'dying' | 'dead' | 'resuming' | 'settling' | 'done' = 'setup'
  let start = -1, deadAt = 0, aliveAt = 0, deadFrames = 0, healthAtSpawn = 0, kills = 0
  let pos: Vector | undefined, deadShots: number | undefined, deadClip: number | undefined
  let resumedShots = 0, combat = true, deadWeapons = 0, sentInput = 0
  let baseHealth = 0, equippedHealth = 0, startedPartial = false, combatHp = 0
  const durations: number[] = [], actionable: number[] = []

  function finish(ok: boolean, reason: string): void {
    phase = 'done'
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'respawn', reason, 'kills', kills, 'dead frames / weapons / inputs', deadFrames, deadWeapons, sentInput,
      'dead seconds', durations.join(', '), 'moved and fired after spawn', actionable.join(', '),
      'equipped respawn HP', healthAtSpawn, '/', equippedHealth, 'scored deaths and damage', session.deaths, session.damageTaken)
    serverCommand('quit')
  }
  onKill(hit => { if (trainee && hit.victimPlayer.slot === trainee.slot) kills++ })
  onSpawn((player, pawn) => {
    if (player.slot !== trainee?.slot || combat || phase !== 'dead') return
    // Exercise the partial-health spawn even on game builds that already fill this hero.
    startedPartial = writeField(pawn.entity, 'CBaseEntity', 'm_iHealth', 'int32', Math.floor(equippedHealth / 2))
  })
  onFrame(({ timeSeconds: now }) => {
    if (phase === 'done') return
    if (start < 0) start = now
    if (now - start > 20) { finish(false, 'timeout in ' + phase); return }
    if (!trainee) {
      trainee = addBot({ name: 'Respawn trainee', team: 2, hero: 'hero_wraith' })
      if (trainee) {
        trainee.seat({ hero: 'any', team: 2 }) // Match the normal client join path.
        testSubject(trainee)
        setDeathEnabled(true)
        setFailOnDeath(false)
        stationaryDrain.setEnabled(false)
      }
      return
    }
    enemy ??= addBot({ name: 'Lethal damage source', team: 3, hero: 'hero_warden' })
    const pawn = trainee.pawn()
    const gun = trainee.abilities().find(a => a.slot === 21)?.entity
    const clip = gun ? readField(gun, weapon, 'm_iClip', 'int32') : undefined
    const shot = gun ? readField(gun, weapon, 'm_nShotNumber', 'int32') : undefined
    if (phase === 'setup') {
      if (session.phase !== 'running' || !pawn?.hero || pawn.health <= 0 || !enemy?.pawn()?.hero ||
          typeof clip !== 'number' || clip <= 0 || typeof shot !== 'number') return
      phase = 'dying'
      combatHp = pawn.health
      damage({ victim: pawn.entity, attacker: enemy.pawn()!.entity, amount: 100000 })
      return
    }
    if (phase === 'settling') {
      if (!pawn || pawn.health <= 0) { finish(false, 'unexpected death before standing still'); return }
      trainee.drive({ facing: aim, forward: 0, left: 0, pressed: 0n, held: 0n })
      if (!baseHealth) {
        baseHealth = pawn.effectiveMaxHealth ?? pawn.maxHealth
        if (!trainee.buyItem('upgrade_health')) finish(false, 'could not buy a vitality item')
        return
      }
      equippedHealth = pawn.effectiveMaxHealth ?? pawn.maxHealth
      if (equippedHealth <= baseHealth) return
      if (Math.hypot(pawn.velocity.x, pawn.velocity.y, pawn.velocity.z) > 2) return
      combat = false
      setDeathEnabled(false)
      stationaryDrain.setRate(50)
      stationaryDrain.setEnabled(true)
      writeField(pawn.entity, 'CBaseEntity', 'm_iHealth', 'int32', 10)
      phase = 'dying'
      return
    }
    const life = pawn && readField(pawn.entity, 'CBaseEntity', 'm_lifeState', 'uint8')
    if (!pawn?.hero || pawn.health <= 0 || life !== 0) {
      if (phase === 'dying') {
        phase = 'dead'
        const fell = pawn && readField(pawn.entity, 'CBasePlayerPawn', 'm_flDeathTime', 'float32')
        const due = pawn && readField(pawn.entity, 'CCitadelPlayerPawn', 'm_flRespawnTime', 'float32')
        if (typeof fell !== 'number' || typeof due !== 'number' || Math.abs(due - fell - 1.5) > 0.03) {
          finish(false, 'stock death HUD deadline does not match the respawn'); return
        }
        if (Math.abs(session.respawnAt - now - 1.5) > .075 || session.deathCause !== (combat ? 'other' : 'standing-drain')) {
          finish(false, 'wrong scored death source or respawn deadline'); return
        }
        deadAt = fell
        pos = pawn?.position
        deadShots = typeof shot === 'number' ? shot : undefined
        deadClip = typeof clip === 'number' ? clip : undefined
      }
      if (phase !== 'dead') { finish(false, 'second death during recovery'); return }
      deadFrames++
      if (typeof clip === 'number' && typeof shot === 'number') deadWeapons++
      if ((pos && pawn && vector.flatDistance(pos, pawn.position) > 1) ||
          (deadShots !== undefined && typeof shot === 'number' && shot !== deadShots) ||
          (deadClip !== undefined && typeof clip === 'number' && clip < deadClip)) {
        log('dead input sample', now - deadAt, JSON.stringify({ pos, current: pawn?.position, deadShots, shot, deadClip, clip }))
        finish(false, 'movement or fire while dead'); return
      }
      if (trainee.drive({ facing: aim, forward: 1, left: 0, pressed: Buttons.attack, held: Buttons.attack })) sentInput++
      return
    }
    if (phase === 'dying') return
    if (phase === 'dead') {
      if (session.respawnAt) { finish(false, 'respawn state survived a live pawn'); return }
      const duration = now - deadAt
      durations.push(duration)
      const maximum = pawn.effectiveMaxHealth ?? pawn.maxHealth
      const expectedDamage = combatHp + (combat ? 0 : 10)
      if (session.deaths !== kills || Math.abs(session.damageTaken - expectedDamage) > 1) {
        finish(false, 'expected ' + kills + ' deaths and ' + expectedDamage + ' HP actually removed'); return
      }
      if (pawn.health !== maximum || (!combat && (!startedPartial || maximum < equippedHealth))) {
        finish(false, 'revived with ' + pawn.health + '/' + maximum + ' HP, equipped maximum ' + equippedHealth); return
      }
      if (duration < 1.49 || duration > 1.62 || session.phase !== 'running') { finish(false, 'invalid revival time or interrupted run'); return }
      phase = 'resuming'
      aliveAt = now
      pos = pawn.position
      healthAtSpawn = pawn.health
      resumedShots = typeof shot === 'number' ? shot : 0
    }
    trainee.drive({ facing: aim, forward: 1, left: 0, pressed: Buttons.attack, held: Buttons.attack })
    if (pawn.health < healthAtSpawn - (pawn.effectiveMaxHealth ?? pawn.maxHealth) * 0.07) {
      finish(false, 'dead time was charged after spawning'); return
    }
    if (now - aliveAt > 0.65) { finish(false, 'held movement and weapon did not resume promptly'); return }
    if (!pos || vector.flatDistance(pos, pawn.position) < 5 || typeof shot !== 'number' || shot === resumedShots) return
    actionable.push(now - aliveAt)
    if (!combat) { finish(kills === 2 && deadWeapons > 80 && sentInput > 80, 'combat and standing-drain deaths'); return }
    phase = 'settling'
  })
}
