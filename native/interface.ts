import { heroes, jsx, show, type Child, type Player } from 'modlock'
import { characterAction, characterChanging, characterFields } from '../character'
import { beginTraining, simulationTime, stopTraining, waveSettings } from '../gameplay'
import { presetValues } from '../difficulty-settings.js'
import { meleeRange } from '../melee-range.js'
import { setRangePreview } from '../range-preview'
import { handleResultAudio } from '../result-audio'
import { scoreFields } from '../score-snapshot'
import { parseLimit, session } from '../session'
import { changeSetting, resetSettings, settingsSnapshot, trainerSetting } from '../trainer-settings'
import { exportTrainerData, profiles, validProfileName } from '../trainer-store'
import { soulStats } from '../waves'
import { backupProblem, importNativeDocument, nativeBackupAvailable, nativeLibraryStatus, nativeStorageLoading, retryNativeSave } from './storage'
import { button, clock, closeButton, column, heading, note, palette, row, text } from './ui'
import { arenaHud, scorecard } from './score-view'

const pages = ['Session', 'My hero', 'Opponents', 'Creeps', 'Saved', 'Templates', 'Score'] as const
const libraries = ['Drills', 'Hero builds', 'Backups'] as const
const heroNames = ['Random', ...heroes.map(hero => hero.title)]
const heroKeys = ['random', ...heroes.map(hero => hero.name)]

const menuStyle = { width: 850, horizontalAlign: 'center', verticalAlign: 'center' } as const
const plate = { width: '100%', background: palette.plate, borderColor: palette.border,
  borderWidth: 1, borderRadius: 6, padding: 20 } as const
const half = { width: 392, margin: [0, 12, 0, 0] } as const

/** TrainerInterface projects one trainee's live practice and library into typed nodes. */
export class TrainerInterface {
  draining = false
  private page: typeof pages[number] = 'Session'
  private library: typeof libraries[number] = 'Drills'
  private template?: number
  private savedName = ''
  private savedKind = 0
  private draft = new Map<string, string>()
  private backupText = ''
  private confirmation?: { label: string; apply: () => void }
  private message = ''
  private lastResult = -1
  private resultAt = -Infinity
  private recap = 0
  private next = -Infinity
  private drawn = ''
  private redraw = 0
  private previewRequest = 0

  readonly player: Player

  constructor(player: Player) {
    this.player = player
  }

  /** update reads the clock and scores after gameplay and redraws only on a visible change. */
  update(force = false): void {
    const now = simulationTime()
    if (!force && now < this.next) return
    this.next = now + 0.1
    const score = scoreFields(session, soulStats(), now, '')
    const storage = nativeLibraryStatus()
    const hero = this.player.pawn()
    const profile = this.page === 'Saved' ? characterFields(hero?.hero) : {}

    // Announce one natural finish, then ask the local renderer to open the recap.
    if (session.phase === 'finished' && session.reason !== 'stopped' && session.runId !== this.lastResult) {
      this.lastResult = session.runId
      this.resultAt = now
      handleResultAudio(this.player, session.reason === 'time' || session.reason === 'goal' ? 'win' : 'lose')
    }
    if (session.phase !== 'finished') this.resultAt = -Infinity
    const banner = now < this.resultAt + 1.9
    if (!banner && this.resultAt > -Infinity && this.recap !== this.lastResult) this.recap = this.lastResult
    const key = JSON.stringify([score, storage, profile, settingsSnapshot(), hero?.hero, !!hero?.health,
      this.draining, this.redraw, banner, this.recap])
    if (!force && key === this.drawn) return
    this.drawn = key
    show(this.player, [arenaHud(score, this.draining, banner), this.settingsMenu(storage), this.recapMenu(score)])
  }

  private refresh(): void {
    this.redraw++
    this.update(true)
  }

  private get active(): boolean { return session.phase === 'countdown' || session.phase === 'running' }
  private get locked(): boolean { return characterChanging() || nativeStorageLoading() }

  private change(key: string, value: string): void {
    if (this.locked) return
    this.message = changeSetting(key, value) ? '' : 'That setting cannot change right now.'
    this.refresh()
  }

  private settingsMenu(storage: ReturnType<typeof nativeLibraryStatus>): Child {
    const actions = row([
      button('Reset', () => { if (!this.locked) { resetSettings(); this.draft.clear(); this.template = undefined; this.refresh() } }, { disabled: this.locked }),
      closeButton(this.active ? 'Resume' : 'Close'),
      button(this.active ? session.phase === 'countdown' ? 'Cancel countdown' : 'End session' : 'Begin session', () => this.beginOrEnd(),
        { primary: true, disabled: !this.active && (this.locked || !(this.player.pawn()?.health)) }),
    ], { horizontalAlign: 'right', margin: [12, 0, 0] })
    const tabs = row(pages.map(page => button(page, () => {
      if (page !== this.page) this.template = undefined
      this.page = page
      this.confirmation = undefined
      this.message = ''
      this.refresh()
    }, { selected: this.page === page })))
    const body = this.confirmation ? this.confirm() : this.pageBody(storage)
    return jsx('menu', { mode: this.active ? 'hold' : 'toggle', openRequest: this.previewRequest, style: menuStyle,
      children: column([tabs, body, storage.message && note(storage.message, palette.warning),
        storage.retry && button('Retry account storage', () => { retryNativeSave(); this.refresh() }),
        this.message && note(this.message, palette.warning), actions], plate) }, 'trainer-menu')
  }

  private pageBody(storage: ReturnType<typeof nativeLibraryStatus>): Child {
    switch (this.page) {
      case 'Session': return this.practiceSettings()
      case 'My hero': return this.heroSettings()
      case 'Opponents': return this.opponents()
      case 'Creeps': return this.creeps()
      case 'Templates': return this.templates()
      case 'Saved': return this.saved(storage)
      case 'Score': return scorecard(scoreFields(session, soulStats(), simulationTime(), ''))
    }
  }

  private beginOrEnd(): void {
    if (this.active) { stopTraining(); this.refresh(); return }
    if (this.locked) return
    const mode = trainerSetting('limit_mode')
    const fields = mode === 'timer' ? ['timer'] : mode === 'goal' ? ['parries', 'souls'] : []
    for (const field of fields) {
      if (this.draft.has(field) && !this.commitNumber(field)) return
    }
    if (trainerSetting('fail_on_hits') && !this.commitNumber('hit_limit')) return
    const limit = parseLimit([mode, ...fields.map(trainerSetting)].join(' '))
    if (!limit) this.message = 'Enter a positive time or at least one goal.'
    else if (limit.mode === 'goal' && limit.souls > 0 && !waveSettings.troopers && !waveSettings.camps) {
      this.page = 'Creeps'
      this.message = 'Enable troopers or camps before starting a soul goal.'
    } else this.message = beginTraining(limit) ? '' : 'Wait for your hero to spawn, then begin again.'
    this.refresh()
  }

  private numeric(key: string, label: string): Child {
    const current = String(trainerSetting(key))
    const value = this.draft.get(key) ?? (key === 'timer' ? clock(Number(current)) : current)
    return row([text(label, { width: 150 }), jsx('entry', {
      value, maxLength: 9, style: { width: 96, height: 34, color: palette.ink, background: palette.row, padding: 5 },
      onChange: (_: Player, next: string) => { this.draft.set(key, next) },
    }, key), button('Set', () => { this.commitNumber(key); this.refresh() }, { key: `set-${key}` })], { margin: [5, 0] }, key)
  }

  private commitNumber(key: string): boolean {
    let value = this.draft.get(key)?.trim()
    if (value === undefined) return true
    if (key === 'timer') {
      const time = /^(\d{1,4}):([0-5]\d)$/.exec(value)
      if (time) value = String(Number(time[1]) * 60 + Number(time[2]))
    }
    if (!changeSetting(key, value)) { this.message = `Enter a valid ${key === 'timer' ? 'duration (m:ss)' : 'whole number'}.`; this.refresh(); return false }
    this.draft.delete(key)
    this.message = ''
    return true
  }

  private toggle(key: string, label: string): Child {
    return jsx('toggle', { on: Boolean(trainerSetting(key)), children: label, onChange: (_: Player, value: boolean) => this.change(key, value ? '1' : '0'),
      style: { width: '100%', minHeight: 30, fontSize: 17, color: palette.ink, margin: [3, 0] } }, key)
  }

  private slider(key: string, label: string, minimum: number, maximum: number, display?: string): Child {
    const value = Number(trainerSetting(key))
    return this.numberSlider(key, label, value, minimum, maximum, display ?? String(value), next => this.change(key, String(next)))
  }

  private numberSlider(key: string, label: string, value: number, min: number, max: number, display: string, set: (value: number) => void): Child {
    return row([text(label, { width: 110, fontSize: 17 }), jsx('slider', { value, min, max, step: 1,
      disabled: min >= max, style: { width: 175, height: 30, margin: [0, 8, 0, 0] },
      onChange: (_: Player, next: number) => set(Math.round(next)),
    }, `${key}-slider`), text(display, { fontSize: 16, color: palette.green })], { margin: [2, 0] }, key)
  }

  private practiceSettings(): Child {
    const mode = trainerSetting('limit_mode')
    const finish = column([heading('Finish condition'), row([['none', 'Unlimited'], ['timer', 'Timer'], ['goal', 'Goals']].map(([key, label]) =>
      button(label, () => this.change('limit_mode', key), { selected: key === mode }))),
      mode === 'timer' && this.numeric('timer', 'Duration (m:ss)'),
      mode === 'goal' && [this.numeric('parries', 'Parry goal'), this.numeric('souls', 'Soul goal'), note('Set a goal to 0 to leave it out.')],
    ], half)
    const losses = column([heading('Loss conditions'), this.toggle('fail_on_death', 'Lose on death'),
      this.toggle('fail_on_hits', 'Heavy melee hit limit'), Boolean(trainerSetting('fail_on_hits')) && this.numeric('hit_limit', 'Maximum hits'),
      heading('Soul penalties'), this.toggle('penalty_hit', 'Heavy melee hits you'),
      this.toggle('penalty_unparried', 'Heavy goes unparried'), this.toggle('penalty_whiff', 'Parry catches nothing'),
      note('Each enabled penalty costs one secured soul. Penalties stack.')], half)
    return row([finish, losses], { verticalAlign: 'top' })
  }

  private heroSettings(): Child {
    return column([heading('My hero'), note('Use Escape → Swap Hero to choose a different hero.'),
      this.toggle('cooldown', 'Use normal ability cooldowns'), this.toggle('stamina', 'Fast stamina regeneration'),
      this.toggle('death', 'Enemy attacks can kill'), this.toggle('idle_drain', 'Standing still drains health'),
      Boolean(trainerSetting('idle_drain')) && this.slider('idle_rate', 'Drain rate', 15, 50, `${trainerSetting('idle_rate')}% max HP/s`),
      button('Set hero to max level', () => this.maxLevel(), { disabled: this.locked }),
    ], half)
  }

  private maxLevel(): void {
    const pawn = this.player.pawn()
    if (!pawn || this.locked) return
    this.message = this.player.restoreHero({ position: pawn.position, facing: pawn.eyeAngles, fresh: true, level: 36 }) ? '' : 'The game did not accept the level change.'
    this.refresh()
  }

  private pickHero(key: string, label: string): Child {
    return row([text(label, { width: 110 }), jsx('dropdown', { options: heroNames,
      selected: Math.max(0, heroKeys.indexOf(String(trainerSetting(key)))), style: { width: 200, height: 34 },
      onChange: (_: Player, index: number) => { if (heroKeys[index]) this.change(key, heroKeys[index]) },
    }, key)], { margin: [4, 0] }, key)
  }

  private range(prefix: 'melee' | 'interval', format: (v: number) => string): Child[] {
    const min = Number(trainerSetting(`${prefix}_min`)), max = Number(trainerSetting(`${prefix}_max`))
    const bias = Number(trainerSetting(`${prefix}_bias`))
    return [this.slider(`${prefix}_min`, 'Minimum', 0, max, format(min)),
      this.slider(`${prefix}_bias`, 'Favored', 0, 100, format(meleeRange.favored(min, max, bias))),
      this.slider(`${prefix}_max`, 'Maximum', min, 100, format(max))]
  }

  private opponents(): Child {
    return row([column([heading('Attackers'), this.pickHero('hero1', 'Opponent 1'),
      this.toggle('second', 'Second opponent'), Boolean(trainerSetting('second')) && this.pickHero('hero2', 'Opponent 2'),
      heading('Melee cues'), this.toggle('effects', 'Lunge trail and hand flash'),
      this.toggle('parried', 'Show opponent stun effects')], half),
    column([heading('Melee distance'), ...this.range('melee', value => meleeRange.formatUnits(meleeRange.units(value))),
      button('Show range rings', () => setRangePreview(`inspect ${trainerSetting('melee_min')} ${trainerSetting('melee_max')} ${trainerSetting('melee_bias')}`, simulationTime()), { disabled: this.active }),
      heading('Time between attacks'), ...this.range('interval', meleeRange.formatSeconds)], half),
    ], { verticalAlign: 'top' })
  }

  private creeps(): Child {
    return row([column([heading('Lane troopers'), this.toggle('troopers', 'Spawn lane troopers'),
      this.slider('trooper_count', 'Troopers', 1, 4), this.toggle('trooper_active', 'Chase and attack'),
      this.slider('trooper_speed', 'Move speed', 10, 100, `${trainerSetting('trooper_speed')}%`)], half),
    column([heading('Neutral camps'), this.toggle('camps', 'Spawn neutral camps'), this.slider('camp_tier', 'Camp tier', 1, 3),
      this.toggle('camp_reactive', 'Fight back when attacked'), note('Parry while securing or denying souls.')], half),
    ], { verticalAlign: 'top' })
  }

  private templates(): Child {
    const chosen = this.template ?? Number(trainerSetting('preset'))
    const preview = presetValues(chosen)
    const label = chosen === 0 ? 'Easiest' : chosen === 50 ? 'Normal' : chosen === 100 ? 'Hardest' : chosen < 50 ? 'Easier' : 'Harder'
    return column([heading('Training templates'), this.numberSlider('template', 'Difficulty', chosen, 0, 100, label, next => {
      this.template = next
      this.refresh()
    }), note('Preview a template before replacing your settings.'),
      note(`Melee every ${meleeRange.formatSeconds(preview.interval_min)} to ${meleeRange.formatSeconds(preview.interval_max)}`),
      note(`${preview.second ? 2 : 1} attacker${preview.second ? 's' : ''} · ${preview.troopers ? `${preview.trooper_count} troopers` : 'No troopers'} · ${preview.camps ? `Tier ${preview.camp_tier} camp` : 'No camps'}`),
      note(`${preview.fail_on_death ? 'Death ends a run' : 'Respawn on death'} · ${preview.fail_on_hits ? `Lose after ${preview.hit_limit} heavy hits` : 'No heavy hit limit'}`),
      row([0, 25, 50, 75, 100].map((value, index) => button(['Easiest', 'Easier', 'Normal', 'Harder', 'Hardest'][index], () => { this.template = value; this.refresh() }, { selected: value === chosen }))),
      button('Apply template', () => this.ask('Replace your current trainer settings?', () => {
        this.draft.clear()
        this.change('preset', String(chosen))
      }), { primary: true, disabled: this.active || this.locked }),
    ])
  }

  private ask(label: string, apply: () => void): void {
    this.confirmation = { label, apply }
    this.refresh()
  }

  private confirm(): Child {
    const pending = this.confirmation!
    return column([heading(pending.label), row([
      button('Cancel', () => { this.confirmation = undefined; this.refresh() }),
      button('Confirm', () => {
        if (this.confirmation !== pending) return
        this.confirmation = undefined
        pending.apply()
        this.refresh()
      }, { primary: true, disabled: this.locked }),
    ])], { padding: [18, 0] })
  }

  private profile(args: string): void {
    const storage = nativeLibraryStatus()
    if (!storage.ready || storage.busy || this.locked) return
    characterAction(this.player, args)
    this.refresh()
  }

  private saved(storage: ReturnType<typeof nativeLibraryStatus>): Child {
    const nav = row(libraries.map(library => button(library, () => {
      this.library = library
      this.savedName = ''
      this.savedKind = 0
      this.message = ''
      this.refresh()
    }, { selected: this.library === library })))
    if (this.library === 'Backups') return column([nav, this.backups()])
    const drills = this.library === 'Drills'
    const { hero, feedback } = characterFields(this.player.pawn()?.hero)
    const available = storage.ready && !storage.busy && !this.locked
    const entries = storage.ready ? profiles().filter(profile => Boolean(profile.settings) === drills) : []
    const options = drills ? ['Drill only', 'Include current hero build'] : ['Inventory and abilities', 'Inventory only', 'Abilities only']
    return column([nav, heading(this.library), feedback && note(feedback),
      available && row([jsx('entry', { maxLength: 40, value: this.savedName, placeholder: 'Name',
        style: { width: 220, height: 36, color: palette.ink, background: palette.row, padding: 5 },
        onChange: (_: Player, value: string) => { this.savedName = value },
      }, 'library-name'), jsx('dropdown', { options, selected: this.savedKind, style: { width: 250, height: 36, margin: [0, 8] },
        onChange: (_: Player, value: number) => { this.savedKind = value; this.refresh() },
      }, 'library-kind'), button(drills ? 'Save drill' : 'Save build', () => {
        const name = this.savedName.trim(), kind = drills ? ['drill', 'drill-build'][this.savedKind] : ['build', 'items', 'skills'][this.savedKind]
        if (!validProfileName(name)) { this.message = 'Enter a name of 1–40 characters.'; this.refresh(); return }
        if (!kind || (kind !== 'drill' && !hero)) return
        this.profile(`save ${kind}${kind === 'drill' ? '' : ':' + hero} ${encodeURIComponent(name)}`)
      }, { primary: true })]),
      storage.ready && !entries.length && note(drills ? 'No saved drills yet.' : 'No saved hero builds yet.'),
      column(entries.map(entry => {
        const matching = !entry.loadout || entry.loadout.hero === hero
        return column([text(entry.name, { bold: true }), row([
          button(drills ? entry.loadout ? 'Load with build' : 'Load drill' : 'Load build', () => this.profile(`apply ${entry.id}`), { disabled: !available || this.active }),
          entry.settings && entry.loadout && button('Load drill only', () => this.profile(`drill-only ${entry.id}`), { disabled: !available || this.active }),
          button('Rename', () => {
            const name = this.savedName.trim()
            if (!validProfileName(name)) { this.message = 'Enter the new name above, then choose Rename.'; this.refresh(); return }
            this.profile(`rename ${entry.id} ${encodeURIComponent(name)}`)
          }, { disabled: !available }),
          (matching || entry.settings) && button(matching ? 'Overwrite' : 'Overwrite drill only', () =>
            this.ask(`Overwrite “${entry.name}”?`, () => this.profile(`${matching ? 'overwrite' : 'overwrite-drill-only'} ${entry.id}`)), { disabled: !available }),
          button('Delete', () => this.ask(`Delete “${entry.name}”?`, () => this.profile(`delete ${entry.id}`)), { disabled: !available }),
        ])], { padding: [6, 0] }, String(entry.id))
      }), { width: '100%', maxHeight: 270, overflowY: 'scroll' }),
    ])
  }

  private backups(): Child {
    return column([heading('Whole-trainer backup'), note('Copy an export into a file, or paste a backup to replace your settings, drills and builds.'),
      button('Export backup', () => {
        if (!nativeBackupAvailable(this.player, false)) return
        this.backupText = exportTrainerData(settingsSnapshot())
        this.refresh()
      }, { disabled: !nativeBackupAvailable(this.player, false) }),
      this.backupText && jsx('documentOutput', { text: this.backupText, style: { width: '100%', height: 112, fontSize: 16 } }, 'export'),
      this.active ? note('End the session before importing a backup.') : jsx('documentInput', {
        placeholder: 'Paste your trainer backup here', submitLabel: 'Review import',
        disabled: !nativeBackupAvailable(this.player, true), style: { width: '100%', flow: 'down', margin: [7, 0] },
        onSubmit: (player: Player, raw: string) => {
          if (this.confirmation || player.slot !== this.player.slot || this.page !== 'Saved' || this.library !== 'Backups' || this.active || !nativeBackupAvailable(player, true)) return
          const problem = backupProblem(raw)
          if (problem) { this.message = problem; this.refresh(); return }
          this.ask('Replace your settings, drills and hero builds?', () => {
            if (!this.active) importNativeDocument(this.player, raw, message => { this.message = message; this.refresh() })
          })
        },
      }, 'import'),
    ])
  }

  private recapMenu(score: ReturnType<typeof scoreFields>): Child {
    if (!this.recap || session.phase !== 'finished' || session.reason === 'stopped' || this.recap !== session.runId) return null
    return jsx('menu', { mode: 'manual', openRequest: this.recap, style: menuStyle,
      children: column([scorecard(score), row([note('Open Score to see this recap again.'), closeButton()], { horizontalAlign: 'right' })], plate),
    }, 'trainer-recap')
  }

  /** preview selects an actual trainer page in the disposable probe build. */
  preview(page: typeof pages[number], library?: typeof libraries[number]): void {
    this.page = page
    if (library) this.library = library
    this.previewRequest++
    this.refresh()
  }
}
