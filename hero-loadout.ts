// Profiles store game definition IDs and skill slots. Entity handles change with every hero.
import { heroes, heroNamed, items, onPlayerLeave, onRestored, readField, sequence,
  type Ability, type Player } from 'modlock'

interface SavedSlot { id: number; slot: number; state: number }
interface SavedItem extends SavedSlot { imbues?: number[] }
export interface HeroLoadout {
  hero: string
  items?: SavedItem[]
  abilities?: { level: number; points: number; unlocks: number; slots: SavedSlot[] }
}

function imbueSlots(row: SavedItem): number[] { return [...(row.imbues ?? [])].sort((a, b) => a - b) }

// Binding order matters for active items and skills; their enumeration order does not.
export function heroLoadoutKey(loadout: HeroLoadout): string {
  const equipment = loadout.items && [...loadout.items].sort((a, b) => a.id - b.id)
    .map(row => [row.id, row.slot, row.state, imbueSlots(row)])
  const skills = loadout.abilities
  const progression = skills && [skills.level, skills.points, skills.unlocks,
    [...skills.slots].sort((a, b) => a.slot - b.slot).map(row => [row.id, row.slot, row.state])]
  return JSON.stringify([loadout.hero, equipment ?? null, progression ?? null])
}

const shop = new Map(items.map(item => [item.id, item]))
const uint = (value: unknown, max = 0xffffffff): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max

function validSlot(row: unknown): row is SavedSlot {
  return !!row && typeof row === 'object' && 'id' in row && uint(row.id) && row.id > 0 &&
    'slot' in row && uint(row.slot, 23) && 'state' in row && uint(row.state)
}

export function validHeroLoadout(value: unknown): value is HeroLoadout {
  if (!value || typeof value !== 'object' || !('hero' in value) || typeof value.hero !== 'string' ||
      heroNamed(value.hero)?.name !== value.hero) return false
  if ('items' in value) {
    const list = value.items
    if (!Array.isArray(list) || list.length > 64) return false
    const ids = new Set<number>(), active = new Set<number>()
    for (const row of list) {
      if (!validSlot(row) || !shop.has(row.id) || ids.has(row.id)) return false
      ids.add(row.id)
      if (row.slot !== 23) {
        if (!shop.get(row.id)!.active || row.slot < 4 || row.slot > 7 || active.has(row.slot)) return false
        active.add(row.slot)
      }
      if ('imbues' in row && (!Array.isArray(row.imbues) || !shop.get(row.id)?.imbue ||
          row.imbues.length > 4 || !row.imbues.every(slot => uint(slot, 3)) ||
          new Set(row.imbues).size !== row.imbues.length)) return false
    }
  }
  if ('abilities' in value) {
    const skills = value.abilities
    if (!skills || typeof skills !== 'object' || !('level' in skills) || !uint(skills.level, 100) || !skills.level ||
        !('points' in skills) || !uint(skills.points, 0x7fffffff) || !('unlocks' in skills) || !uint(skills.unlocks, 0x7fffffff) ||
        !('slots' in skills) || !Array.isArray(skills.slots) || skills.slots.length !== 4 ||
        !skills.slots.every(row => validSlot(row) && row.slot < 4) || new Set(skills.slots.map(row => row.slot)).size !== 4)
      return false
  }
  return 'items' in value || 'abilities' in value
}

function savedSlot({ id, slot, state }: Ability): SavedSlot { return { id, slot, state } }

export function captureHeroLoadout(player: Player, includeItems: boolean, includeAbilities: boolean): HeroLoadout | undefined {
  const pawn = player.pawn()
  const hero = pawn?.hero && heroes.find(hero => hero.id === pawn.hero)
  if (!pawn || pawn.health <= 0 || !hero) return
  const result: HeroLoadout = { hero: hero.name }
  if (!includeItems && !includeAbilities) return
  const all = player.abilities(), skills = all.filter(a => a.slot >= 0 && a.slot < 4)
  if (skills.length !== 4) return
  if (includeItems) {
    result.items = []
    for (const item of all.filter(a => a.name.startsWith('upgrade_'))) {
      const row: SavedItem = savedSlot(item)
      if (item.imbues.length) {
        row.imbues = []
        for (const name of item.imbues) {
          const target = skills.find(skill => skill.name === name)
          if (!target) return
          row.imbues.push(target.slot)
        }
        row.imbues.sort((a, b) => a - b)
      }
      result.items.push(row)
    }
  }
  if (includeAbilities) {
    const level = readField(pawn.entity, 'CCitadelPlayerPawn', 'm_nLevel', 'int32')
    if (typeof level !== 'number') return
    result.abilities = { level, points: pawn.abilityPoints, unlocks: pawn.abilityUnlocks, slots: skills.map(savedSlot) }
  }
  return validHeroLoadout(result) ? result : undefined
}

type Done = (error?: string) => void
const restoring = new Map<number, Done>()
const applying = new Map<number, Done>()
onRestored((player, error) => {
  const callback = restoring.get(player.slot)
  restoring.delete(player.slot)
  callback?.(error)
})
onPlayerLeave(({ connection }) => {
  restoring.delete(connection.player.slot)
  const callback = applying.get(connection.player.slot)
  applying.delete(connection.player.slot)
  callback?.('Player left while loading the hero build.')
})

export function applyHeroLoadout(player: Player, target: HeroLoadout, done: Done): void {
  if (!validHeroLoadout(target)) { done('Invalid hero loadout for this version of the game.'); return }
  if (applying.has(player.slot)) { done('A hero build is already loading.'); return }
  const before = captureHeroLoadout(player, true, true)
  if (!before) { done('Wait for a living hero with a complete loadout.'); return }
  const { generation, team } = player.pawn()!
  let changed = false
  const connected = () => player.connection()?.generation === generation && applying.get(player.slot) === done
  function finish(error?: string): void {
    if (!connected()) return
    applying.delete(player.slot)
    if (changed) player.freeze(false)
    done(error)
  }
  function apply(loadout: HeroLoadout, complete: Done): void {
    const pawn = player.pawn(), live = captureHeroLoadout(player, true, true)
    if (!pawn || !live || live.hero !== loadout.hero) { complete('The active hero changed.'); return }
    const hero = pawn.hero, skills = loadout.abilities, equipment = loadout.items
    const selected = { hero: live.hero, items: equipment && live.items, abilities: skills && live.abilities }
    if (heroLoadoutKey(loadout) === heroLoadoutKey(selected)) { complete(); return }
    if (skills && !skills.slots.every(row => live.abilities!.slots.some(own => own.slot === row.slot && own.id === row.id))) {
      complete('The saved skills do not match this hero in the installed game.'); return
    }
    const rebuildSkills = skills && heroLoadoutKey({ hero: live.hero, abilities: skills }) !==
      heroLoadoutKey({ hero: live.hero, abilities: live.abilities })
    // Native reset also clears equipment. An ability-only build must put the current inventory back.
    const itemsToRestore = equipment ?? (rebuildSkills ? live.items : undefined)
    const target = { position: pawn.position, facing: pawn.eyeAngles, fresh: true, level: skills?.level,
      abilities: skills?.slots, items: itemsToRestore, replaceItems: itemsToRestore !== undefined }
    function restore(): void {
      restoring.set(player.slot, error => {
        if (!connected()) return
        if (error) { complete(error); return }
        const current = player.pawn()
        if (!current || current.hero !== hero) { complete('The active hero changed.'); return }
        for (const row of itemsToRestore ?? []) {
          for (const slot of row.imbues ?? []) {
            if (!player.giveItem(shop.get(row.id)!.name, slot)) { complete('The hero could not equip a saved item binding.'); return }
          }
        }
        if (skills && !player.adjustAbilityPoints(skills.points - current.abilityPoints, skills.unlocks - current.abilityUnlocks)) {
          complete('Could not restore unspent skill points.'); return
        }
        complete()
      })
      if (!player.restoreHero(target)) {
        restoring.delete(player.slot)
        complete('The game refused the saved loadout.')
      }
    }
    player.freeze(true)
    changed = true
    if (rebuildSkills) {
      // Retail counts spent unlocks even after the skill slots are replaced. Reset the
      // current hero's native ledger before restoring a different progression.
      if (!player.resetHero(0)) { complete('Could not reset this hero’s ability points.'); return }
      sequence(attempt => {
        if (!connected()) return
        if (player.pawn()?.hero !== hero) { complete('The active hero changed.'); return }
        if (player.abilities().filter(a => a.slot >= 0 && a.slot < 4).length === 4) { restore(); return }
        if (attempt < 50) return 0.05
        complete('The hero’s abilities did not become ready.')
      })
      return
    }
    // A reused native item retains its old imbue until it is removed and granted again.
    const staleImbue = equipment && live.items!.some(own => own.imbues?.length && equipment.some(wanted =>
      own.id === wanted.id && imbueSlots(own).join(',') !== imbueSlots(wanted).join(',')))
    if (staleImbue && !player.clearItems()) { complete('Could not replace old item bindings.'); return }
    restore()
  }
  // Native selection replaces the pawn asynchronously. Its four skill slots may arrive
  // a frame later. A manual pick during the transition always belongs to the player.
  function selectAndApply(loadout: HeroLoadout, complete: Done): void {
    const hero = heroNamed(loadout.hero)!, previous = player.pawn()?.hero
    if (previous === hero.id) { apply(loadout, complete); return }
    if (player.selectHero(hero.id, team) !== hero.id) {
      complete('Deadlock could not switch to ' + hero.title + '.'); return
    }
    sequence(attempt => {
      if (!connected()) return
      const current = player.pawn()
      if (current?.hero === hero.id && captureHeroLoadout(player, true, true)) { apply(loadout, complete); return }
      if (current?.hero && current.hero !== previous && current.hero !== hero.id) {
        complete('The active hero changed.'); return
      }
      if (attempt < 160) return 0.05
      complete(hero.title + ' did not become ready.')
    })
  }
  applying.set(player.slot, done)
  selectAndApply(target, error => {
    if (!connected()) return
    const current = player.pawn()?.hero, switched = before.hero !== target.hero
    const shouldRecover = switched ? current === heroNamed(target.hero)!.id : changed && current === heroNamed(before.hero)!.id
    if (!error || !shouldRecover) { finish(error); return }
    selectAndApply(before, rollback => finish(rollback ? error + ' Could not restore your previous build. ' + rollback : error))
  })
}
