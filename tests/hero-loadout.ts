// Profile boundaries through the real item shop, ability progression, native hero matching and loadout restore.
import { addBot, items, log, onFrame, serverCommand, type Player } from 'modlock'
import { applyHeroLoadout, captureHeroLoadout, heroLoadoutKey, validHeroLoadout, type HeroLoadout } from '../hero-loadout'
import { prepareHero } from '../hero-practice'

export default function registerLoadoutProbe(trainee?: () => Player | undefined): void {
  let player: Player | undefined, fresh: HeroLoadout | undefined, saved: HeroLoadout | undefined
  let phase = 'spawn', since = -1, error = ''
  function finish(pass: boolean, detail: string): void {
    log(pass ? 'PARRY TRAINER PROBE PASS' : 'PARRY TRAINER PROBE FAIL', 'hero-loadout', phase, detail)
    phase = 'done'
    serverCommand('quit')
  }
  function apply(loadout: HeroLoadout, next: string): void {
    phase = 'applying ' + next
    applyHeroLoadout(player!, loadout, result => { error = result ?? ''; phase = next })
  }
  function sameItems(a: HeroLoadout, b: HeroLoadout): boolean {
    return heroLoadoutKey({hero: a.hero, items: a.items}) === heroLoadoutKey({hero: b.hero, items: b.items})
  }
  onFrame(({ timeSeconds: now }) => {
    if (phase === 'done') return
    if (since < 0) since = now
    if (now - since > 75 || error) { finish(false, error || 'timeout'); return }
    player ??= trainee ? trainee() : addBot({ name: 'Profile trainee', hero: 'hero_atlas', team: 2 })
    if (!player || phase.startsWith('applying')) return
    const live = captureHeroLoadout(player, true, true)
    if (!live) return
    if (phase === 'spawn') {
      fresh = live
      prepareHero(player)
      if (!player.trainAbility(0) || !player.adjustSouls(48600, true)) { finish(false, 'initial progression'); return }
      phase = 'buy'
    } else if (phase === 'buy' && live.abilities!.level === 36) {
      if (!player.trainAbility(0) || !player.trainAbility(1) ||
          !player.buyItem('upgrade_fleetfoot_boots') || !player.buyItem('upgrade_metal_skin') ||
          ![0, 1, 2, 3].some(slot => player!.buyItem('upgrade_magic_reach', slot))) {
        finish(false, 'shop purchase, imbue or skill upgrade'); return
      }
      // Fill a flex slot with ordinary retail purchases.
      for (const item of items.filter(i => i.tier === 1 && !i.active && !i.imbue)) {
        if (player.abilities().filter(a => a.name.startsWith('upgrade_')).length >= 10) break
        player.buyItem(item.name)
      }
      phase = 'capture'
    } else if (phase === 'capture') {
      if (live.items!.length < 10 || !live.items!.some(i => i.imbues?.length) || !live.items!.some(i => i.slot === 5) ||
          live.abilities!.slots[0].state !== 3 << 16) { finish(false, 'incomplete source ' + JSON.stringify(live)); return }
      saved = JSON.parse(JSON.stringify(live))
      if (!validHeroLoadout(saved) || validHeroLoadout({hero: saved.hero, items: [{id: 1, slot: 23, state: 65536}]})) {
        finish(false, 'saved loadout validation'); return
      }
      const reordered = { abilities: { ...saved.abilities!, slots: [...saved.abilities!.slots].reverse() },
        items: [...saved.items!].reverse().map(i => ({state: i.state, id: i.id, slot: i.slot, imbues: i.imbues})), hero: saved.hero }
      if (heroLoadoutKey(reordered) !== heroLoadoutKey(saved) ||
          heroLoadoutKey({hero: saved.hero}) === heroLoadoutKey({hero: saved.hero, items: []})) {
        finish(false, 'profile identity depends on representation'); return
      }
      apply({ hero: saved.hero, items: [] }, 'emptied')
    } else if (phase === 'emptied') {
      if (live.items!.length || JSON.stringify(live.abilities) !== JSON.stringify(saved!.abilities)) {
        finish(false, 'item-only profile changed abilities'); return
      }
      apply({ hero: saved!.hero, items: saved!.items }, 'items')
    } else if (phase === 'items') {
      if (!sameItems(live, saved!) || JSON.stringify(live.abilities) !== JSON.stringify(saved!.abilities)) {
        finish(false, 'slots, imbues or preserved abilities ' + JSON.stringify(live)); return
      }
      const other = { hero: live.hero === 'hero_wraith' ? 'hero_atlas' : 'hero_wraith', items: [] }
      if (player.connection()?.bot) {
        // Retail locks a bot to the hero it spawned as. Exercise the native refusal here.
        phase = 'applying bot switch'
        applyHeroLoadout(player, other, reason => {
          error = reason?.includes('could not switch') ? '' : 'expected native bot hero lock'
          phase = 'checked hero'
        })
      } else apply(other, 'switched')
    } else if (phase === 'switched') {
      if (live.hero === saved!.hero || live.items!.length) { finish(false, 'hero switch'); return }
      apply(saved!, 'checked hero')
    } else if (phase === 'checked hero') {
      if (heroLoadoutKey(live) !== heroLoadoutKey(saved!)) { finish(false, 'source build recovery'); return }
      apply(fresh!, 'fresh')
    } else if (phase === 'fresh') {
      apply(saved!, 'restored')
    } else if (phase === 'restored') {
      if (live.hero !== saved!.hero || !sameItems(live, saved!) || JSON.stringify(live.abilities) !== JSON.stringify(saved!.abilities)) {
        finish(false, 'same-hero round trip ' + JSON.stringify(live)); return
      }
      apply({ hero: fresh!.hero, abilities: fresh!.abilities }, 'abilities')
    } else if (phase === 'abilities') {
      if (!sameItems(live, saved!) || JSON.stringify(live.abilities) !== JSON.stringify(fresh!.abilities)) {
        finish(false, 'ability-only profile changed inventory or failed to restore starter skills'); return
      }
      // Even on the correct hero, a stale build can contain outdated skill IDs.
      const bad = { hero: live.hero,
        abilities: { ...fresh!.abilities!, slots: fresh!.abilities!.slots.map(row => ({ ...row, id: 1 })) } }
      phase = 'applying rejected loadout'
      applyHeroLoadout(player, bad, reason => { error = reason ? '' : 'invalid skills accepted'; phase = 'rejected' })
    } else if (phase === 'rejected') {
      finish(live.hero === saved!.hero && sameItems(live, saved!) && JSON.stringify(live.abilities) === JSON.stringify(fresh!.abilities),
        'level, unspent points, skills, two active slots, imbue, flex capacity, partial profiles and failed-load recovery')
    }
  })
}
