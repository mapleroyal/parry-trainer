// Exercise the shop, native damage toggle, reset and a per-shell weapon on a live game server.
import { addBot, Buttons, damage, log, onFrame, readField, serverCommand, type Player } from 'modlock'
import { resetSettings } from '../trainer-settings'
import { activeTrainee, testSubject } from '../gameplay'
import { set } from 'modlock/console'
import { prepareHero, setDeathAllowed } from '../hero-practice'

export default function registerHeroProbe(): void {
  let active = true, start = -1, phase = 0, lastAction = 0
  let hero: Player | undefined, enemy: Player | undefined
  let baseClip = 0, startingSouls = 0, expandedClip = 0, resetPawn = 0
  const weaponClass = 'CCitadel_Ability_PrimaryWeapon'
  const facing = { pitch: 0, yaw: 0, roll: 0 }
  function finish(ok: boolean, detail: string): void {
    active = false
    log(ok ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'hero', detail)
    serverCommand('quit')
  }
  onFrame(({ timeSeconds: now }) => {
    if (!active) return
    if (start < 0) start = now
    if (now - start > 12) { finish(false, 'timeout in phase ' + phase); return }
    hero ??= addBot({ name: 'Shop trainee', hero: 'hero_atlas', team: 2 })
    enemy ??= addBot({ name: 'Damage tester', hero: 'hero_wraith', team: 3 })
    const me = hero?.pawn(), opponent = enemy?.pawn()
    if (!hero || !me?.hero || !opponent?.hero || now - lastAction < 0.18) return
    const abilities = hero.abilities()
    const skill = abilities.find(a => a.slot === 0)
    const activeItem = abilities.find(a => a.name === 'upgrade_fleetfoot_boots')
    const gun = abilities.find(a => a.slot === 21)?.entity
    if (!gun) return
    const clip = readField(gun, weaponClass, 'm_iClip', 'int32')
    const reloading = readField(gun, weaponClass, 'm_bInReload', 'bool')
    const level = readField(me.entity, 'CCitadelPlayerPawn', 'm_nLevel', 'int32')
    if (typeof clip !== 'number') return
    switch (phase) {
      case 0:
        if (clip <= 0 || reloading) return
        testSubject(hero, undefined, false)
        baseClip = clip
        startingSouls = me.souls
        hero.teleport({ x: 2300, y: 1800, z: 3 }, facing)
        prepareHero(hero)
        set('citadel_ability_cooldown_max', 0) // Observe native casts via their cooldowns.
        if (level !== 1 || !hero.trainAbility(0)) { finish(false, 'first ability unlock'); return }
        if (!hero.buyItem('upgrade_clip_size') || !hero.buyItem('upgrade_fleetfoot_boots')) {
          finish(false, 'native shop refused purchase'); return
        }
        break
      case 1:
        if (me.souls !== startingSouls || skill?.upgrades !== 1 || !activeItem) {
          finish(false, 'initial training or infinite-money shop'); return
        }
        hero.drive({ facing, forward: 0, left: 0, held: Buttons.ability1, pressed: Buttons.ability1 })
        break
      case 2: {
        if (!skill || skill.cooldownEnd <= now) return
        // IN_ITEM1, the stock first active-item binding.
        const firstItem = 1n << 37n
        hero.drive({ facing, forward: 0, left: 0, held: firstItem, pressed: firstItem })
        hero.adjustSouls(48600, true) // Exercise native progression up to the Sandbox level cap.
        break
      }
      case 3:
        if (level !== 36 || !activeItem || activeItem.cooldownEnd <= now) return
        if (me.abilityPoints < 1 || !hero.trainAbility(0)) { finish(false, 'max-level upgrade'); return }
        hero.drive({ facing, forward: 0, left: 0, held: 0n, pressed: 0n })
        break
      case 4:
        if (skill?.upgrades !== 3 || clip <= baseClip || reloading) { finish(false, 'upgrades'); return }
        expandedClip = clip
        hero.drive({ facing, forward: 0, left: 0, held: Buttons.attack, pressed: Buttons.attack })
        break
      case 5:
        if (clip >= expandedClip) return
        hero.drive({ facing, forward: 0, left: 0, held: 0n, pressed: 0n })
        prepareHero(hero)
        break
      case 6:
        if (clip !== expandedClip || reloading) { finish(false, 'Begin did not refill the gun'); return }
        damage({ victim: me.entity, attacker: opponent.entity, amount: 100000 })
        break
      case 7:
        if (me.health <= 0 || me.health >= me.maxHealth) { finish(false, 'native no-death'); return }
        setDeathAllowed(true)
        break
      case 8:
        damage({ victim: me.entity, attacker: opponent.entity, amount: 100000 })
        break
      case 9:
        if (me.health > 0) { finish(false, 'native death'); return }
        break
      case 10:
        if (me.health <= 0) return
        if (activeTrainee()?.slot !== hero.slot) { finish(false, 'reset target is not the trainee'); return }
        resetPawn = me.entity
        resetSettings()
        break
      case 11:
        if (me.entity !== resetPawn || level !== 36 || !activeItem || skill?.upgrades !== 3 || !abilities.some(a => a.name === 'upgrade_clip_size')) {
          finish(false, 'settings reset changed the equipped build'); return
        }
        finish(true, 'native shop, skill and item cast, level, magazine, death toggle and build retained on Reset')
        return
    }
    phase++
    lastAction = now
  })
}
