const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { meleeRange } = require('../melee-range.js');
function metres(percent) {
    const distance = meleeRange.metres(percent);
    return distance.toFixed(distance < 1 ? 2 : 1) + ' m';
}

function trainerMenu(saved = '') {
    const timers = new Map();
    const commands = [];
    const results = [];
    const hudClasses = new Set();
    const existing = new Set(['ParryTrainerStatusImpact']);
    let focusedPanel;
    function classList(classes) {
        return {
            BHasClass: name => classes.has(name),
            SetHasClass(name, on) { if (on) classes.add(name); else classes.delete(name); }
        };
    }
    function layoutPanels(file) {
        const panels = new Map();
        function sliderPanel(id) {
            const children = new Map(['SliderThumb', 'SliderTrack', 'SliderTrackProgress', 'SliderDefault']
                .map(id => [id, { SetPanelEvent(event, fn) { this[event] = fn; } }]));
            return { id, value: 0, style: {}, ...classList(new Set()),
                IsValid() { return panels.get(id) === this; },
                FindChildTraverse: id => children.get(id), SetPanelEvent(event, fn) { this[event] = fn; } };
        }
        const layout = [file, ...(file === 'panel.xml' ? ['score-body.xml'] : [])]
            .map(name => fs.readFileSync(path.join(__dirname, name), 'utf8')).join('\n');
        for (const [, tag, attributes] of layout.matchAll(/<(\w+)\b([^<>]*)>/g)) {
            const id = attributes.match(/\sid="([^"]+)"/)?.[1];
            if (!id) continue;
            assert.ok(!panels.has(id), 'duplicate panel ID in ' + file + ': ' + id);
            if (tag === 'Slider') { panels.set(id, sliderPanel(id)); continue; }
            const panel = { id, style: {}, text: attributes.match(/\stext="([^"]*)"/)?.[1] ?? '', ...classList(new Set()) };
            panel.SetFocus = () => { focusedPanel = panel; };
            panel.BHasKeyFocus = () => focusedPanel === panel;
            if (id === 'ParryTrainerMeleeInputs' || id === 'ParryTrainerIntervalInputs') {
                const prefix = id.slice(0, -'Inputs'.length);
                const ids = ['Min', 'Bias', 'Max'].map(part => prefix + part);
                panel.RemoveAndDeleteChildren = () => ids.forEach(id => panels.delete(id));
                panel.BLoadLayoutSnippet = name => {
                    assert.equal(name, prefix + 'InputLayout');
                    ids.forEach(id => panels.set(id, sliderPanel(id)));
                    return true;
                };
            }
            panels.set(id, panel);
        }
        return id => {
            assert.ok(panels.has(id), 'missing panel in ' + file + ': ' + id);
            return panels.get(id);
        };
    }
    const panel = layoutPanels('panel.xml');
    const countdown = layoutPanels('countdown.xml');
    panel('ParryTrainerCountdown').FindChildTraverse = countdown;
    countdown('PausedCountdownLabel').TriggerClass = () => {};
    const indicators = { ...classList(hudClasses), GetChildCount: () => 1, GetChild: () => classList(existing) };
    const root = panel('ParryTrainerControls');
    root.IsValid = () => true;
    root.GetParent = () => ({ ...classList(hudClasses), FindChildTraverse(id) {
        assert.equal(id, 'HudEventIndicatorsPanel');
        return indicators;
    } });
    root.FindChildTraverse = panel;
    for (const name of ['Rows', 'Options']) {
        const list = panel('ParryTrainerProfile' + name);
        list.children = [];
        list.RemoveAndDeleteChildren = () => { list.children = []; };
    }
    let nextTimer = 0, scoreToken = 123, scoreFields;
    const hud = vm.createContext({ $: {
        GetContextPanel: () => root,
        Schedule(delay, fn) { timers.set(++nextTimer, { delay, fn }); return nextTimer; },
        CancelScheduled(id) { timers.delete(id); },
        RegisterEventHandler(event, panel, fn) { panel[event] = fn; },
        DispatchEvent(event, command) { assert.equal(event, 'CitadelConCommand'); commands.push(command); },
        CreatePanel(type, parent, id) {
            if (parent !== root) {
                const child = { id, children: [], ...classList(new Set()),
                    AddClass(name) { this.SetHasClass(name, true); },
                    SetPanelEvent(event, fn) { assert.equal(event, 'onactivate'); this.activate = fn; } };
                parent.children.push(child);
                return child;
            }
            assert.equal(type, 'Panel');
            assert.equal(parent, root);
            assert.equal(id, 'ParryTrainerScoreLoader');
            return {
                BLoadLayout: () => true,
                FindChildTraverse: key => Object.hasOwn(scoreFields, key) ? { text: String(scoreFields[key]) } : null,
                DeleteAsync() {}
            };
        }
    } });
    for (const file of ['../melee-range.js', '../difficulty-settings.js', 'presets.js', 'settings.js', 'controls.js', 'session.js', 'profiles.js', 'score-view.js', 'score.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), hud);
    }
    hud.ParryTrainerShowResult = (_, outcome) => results.push(outcome);
    hud.ParryTrainerClearResult = () => results.push('clear');
    hud.ParryTrainerRecap = false;
    hud.ParryTrainerSetSettingsReady(root, false);
    hud.ParryTrainerBindSliders(root);
    hud.ParryTrainerDrawSettings(root);
    if (saved !== null) hud.ParryTrainerRestoreSettings(root, saved);
    return {
        root, hud, commands, hudClasses, existing, results,
        snapshot(fields = {}, token = ++scoreToken) {
            scoreFields = { SessionPhase: 'ready', SessionMode: 'none', TrainerSettings: 'preset=50,version=2', ...fields };
            const now = Date.now();
            assert.equal(hud.ParryTrainerLoadScore(root, token, now), true);
            hud.ParryTrainerDrawSession(root, now);
        },
        move(value, id = 'Preset') {
            const slider = panel('ParryTrainer' + id);
            const spec = Object.values(hud.ParryTrainerSliders).find(entry => entry.id === 'ParryTrainer' + id);
            slider.value = spec ? (value - spec.min) / (spec.max - spec.min) : value / 100;
            slider.onvaluechanged();
        },
        apply(level) {
            hud.ParryTrainerPage('Presets');
            this.move(level);
            hud.ParryTrainerApplyPreset();
            this.snapshot({ TrainerSettings: 'preset=' + level + ',version=' + hud.presetFormatVersion });
        },
        label(id) { return root.FindChildTraverse('ParryTrainer' + id).text; },
        toggle(setting) { hud.ParryTrainerToggle(setting); },
        status(setting) { return panel(hud.ParryTrainerToggles[setting]).text; },
        settle(maxDelay = Infinity) {
            for (const [id, { delay, fn }] of [...timers])
                if (delay <= maxDelay && timers.delete(id)) fn();
        }
    };
}

test('the stillness warning yields to native ability warnings and ignores unrelated HUD signals', () => {
    const { hud } = trainerMenu();
    let onSignal, onNativeChange, nativeActive = false, displayed = false;
    const box = {
        IsValid: () => true,
        SetHasClass(name, value) { assert.equal(name, 'cast_failed'); displayed = value; }
    };
    const nativeBox = { GetParent: () => parent, BHasClass: () => nativeActive };
    const parent = { FindChildTraverse: () => nativeBox };
    const host = { BLoadLayout: () => true, FindChildTraverse: () => box };
    hud.$.CreatePanel = () => host;
    hud.$.RegisterForUnhandledEvent = (_, callback) => { onSignal = callback; };
    hud.$.RegisterEventHandler = (_, target, callback) => {
        assert.equal(target, nativeBox);
        onNativeChange = callback;
    };
    hud.ParryTrainerBindDrainWarning({ GetParent: () => parent });
    onSignal('ParryTrainer.DrainOn');
    assert.equal(displayed, true);
    onSignal('UI.Button');
    assert.equal(displayed, true);
    nativeActive = true; onNativeChange();
    assert.equal(displayed, false);
    nativeActive = false; onNativeChange();
    assert.equal(displayed, true);
    nativeActive = true; onNativeChange();
    onSignal('ParryTrainer.DrainOff');
    nativeActive = false; onNativeChange();
    assert.equal(displayed, false);
});

test('the scoreboard key latches between sessions and is held during countdown and training', () => {
    const menu = trainerMenu();
    const { hud, root, commands } = menu;
    let scoreboard;
    hud.$.RegisterForUnhandledEvent = (event, fn) => {
        assert.equal(event, 'CitadelScoreboardToggle');
        scoreboard = fn;
    };
    hud.ParryTrainerBindScoreboard(root);
    function key(pressed) {
        root.SetHasClass('gScoreboardOpen', pressed);
        scoreboard(pressed);
    }
    function tap() { key(true); key(false); }
    const visible = () => hud.ParryTrainerMenuVisible(root);
    tap();
    assert.equal(visible(), true);
    assert.deepEqual(commands, ['hud_free_cursor 1']);
    hud.ParryTrainerProfileView('save', 'save');
    hud.ParryTrainerDismissMenu();
    assert.equal(visible(), false);
    assert.equal(hud.ParryTrainerProfiles.view, 'main');
    assert.equal(commands.at(-1), 'hud_free_cursor 0');
    // Another Cancel while closed belongs to Deadlock.
    const before = commands.length;
    hud.ParryTrainerDismissMenu();
    assert.equal(commands.length, before);
    tap();
    assert.equal(visible(), true);
    tap();
    assert.equal(visible(), false);
    tap();
    menu.snapshot({ SessionPhase: 'countdown' });
    assert.equal(visible(), false);
    assert.equal(commands.at(-1), 'hud_free_cursor 0');
    for (const phase of ['countdown', 'running']) {
        menu.snapshot({ SessionPhase: phase });
        key(true);
        assert.equal(visible(), true);
        hud.ParryTrainerDismissMenu();
        assert.equal(visible(), false);
        assert.equal(root.BHasClass('gScoreboardOpen'), true);
        key(false);
        key(true);
        assert.equal(visible(), true);
        key(false);
        assert.equal(visible(), false);
    }
    menu.snapshot({ SessionPhase: 'finished', SessionEndReason: 'stopped' });
    for (const overlay of ['gShopOpen', 'gEditingBuilds', 'gItemDraftOpen']) {
        root.SetHasClass(overlay, true);
        tap();
        assert.equal(visible(), false);
        root.SetHasClass(overlay, false);
    }
    hud.ParryTrainerRecap = { id: 'result' };
    tap();
    assert.equal(visible(), false);
    hud.ParryTrainerRecap = null;
    tap();
    assert.equal(visible(), true);
});

test('previewing a drill template shows its settings without changing the active drill', () => {
    const menu = trainerMenu('preset=50,version=3,trooper_speed=40,hero1=hero_wraith');
    const { root, hud, label } = menu;
    assert.equal(label('PresetActive'), 'Active  Normal · 50 · Custom');
    assert.equal(label('Hero1'), 'Wraith ›');
    const before = hud.ParryTrainerPreset.snapshot().join(',');
    hud.ParryTrainerPage('Presets');
    for (const [level, name] of [[0, 'Easiest'], [25, 'Easier'], [50, 'Normal'], [75, 'Harder'], [100, 'Hardest']]) {
        menu.move(level);
        assert.equal(label('PresetValue'), name + ' · ' + level);
    }
    menu.settle();
    assert.equal(label('SummaryDistance'), metres(0) + ' – ' + metres(100));
    assert.equal(label('SummaryFavored'), '0.25 m');
    assert.equal(label('SummarySpeed'), '100%');
    assert.match(label('SummaryTroopers'), /4.*Chase/);
    assert.match(label('SummaryCamps'), /III.*Retaliate/);
    assert.equal(label('SummaryHitRule'), '1 hit');
    assert.equal(label('SummaryOpponentPicks'), 'Both random');
    assert.equal(label('SummaryDeath'), 'On');
    assert.equal(root.FindChildTraverse('ParryTrainerSummaryDeath').BHasClass('PTPreviewChanged'), true);
    assert.equal(menu.status('death'), 'Off');
    assert.equal(label('TrooperSpeedValue'), '40%');
    assert.equal(label('PresetActive'), 'Active  Normal · 50 · Custom');
    assert.equal(hud.ParryTrainerPreset.snapshot().join(','), before);
    assert.deepEqual(menu.commands, []);
    hud.ParryTrainerPage('Setup');
    hud.ParryTrainerPage('Presets');
    assert.equal(label('PresetValue'), 'Normal · 50');
    assert.equal(label('SummaryOpponentPicks'), 'Wraith');
    assert.equal(root.FindChildTraverse('ParryTrainerSummaryOpponentPicks').BHasClass('PTPreviewChanged'), false);
    assert.equal(root.FindChildTraverse('ParryTrainerPresetApply').enabled, false);
    hud.ParryTrainerApplyPreset(); // The active drill is customized, but the slider has not changed.
    assert.deepEqual(menu.commands, []);
    assert.equal(label('Hero1'), 'Wraith ›');
    assert.equal(label('TrooperSpeedValue'), '40%');
});

test('only applying a drill template replaces opponent and finish settings', () => {
    const saved = 'preset=50,version=3,hero1=hero_atlas,hero2=hero_wraith,limit_mode=timer,timer=90,parries=77,souls=4';
    const menu = trainerMenu(saved), { hud, root, label, snapshot, commands } = menu;
    const panel = name => root.FindChildTraverse('ParryTrainer' + name);
    hud.ParryTrainerOpenTab('Presets');
    assert.equal(panel('PresetApply').enabled, false);
    assert.equal(root.BHasClass('TemplateApplied'), false);
    menu.move(51);
    assert.equal(label('SummaryOpponentPicks'), 'Random');
    assert.equal(label('SummaryFinish'), 'Unlimited');
    assert.equal(label('SummaryTimer'), '5:00');
    assert.equal(label('SummaryGoals'), '10 parries · 0 souls');
    for (const key of ['OpponentPicks', 'Finish', 'Timer', 'Goals']) assert.ok(panel('Summary' + key).BHasClass('PTPreviewChanged'));
    assert.ok(panel('SummaryTimerRow').visible && panel('SummaryGoalsRow').visible);
    assert.ok(panel('PresetApply').enabled);
    assert.deepEqual(commands, []);
    hud.ParryTrainerApplyPreset(); hud.ParryTrainerApplyPreset();
    assert.equal(panel('PresetApply').enabled, false);
    assert.equal(root.BHasClass('TemplateApplied'), false);
    snapshot({ TrainerSettings: 'preset=51,version=3,hero2=hero_wraith' }); // Incomplete host response.
    assert.equal(label('DifficultyFeedback'), 'Template was not applied.');
    assert.equal(root.BHasClass('TemplateApplied'), false);
    assert.equal(panel('PresetApply').enabled, false);
    menu.move(52); hud.ParryTrainerApplyPreset();
    snapshot({ TrainerSettings: 'preset=52,version=' + hud.presetFormatVersion });
    assert.deepEqual(commands, ['parry_trainer_setting preset 51', 'parry_trainer_setting preset 52']);
    assert.match(label('DifficultyFeedback'), /Applied.*52/i);
    assert.equal(root.BHasClass('TemplateApplied'), true);
    assert.equal(panel('PresetApply').enabled, false);
    assert.equal(panel('SummaryGoalsRow').visible, false);
    assert.equal(panel('SummaryTimerRow').visible, false);
    assert.deepEqual(['Hero1','Hero2','LimitInput','ParryInput','SoulInput'].map(label), ['Random ›','Random ›','5:00','10','0']);
    assert.equal(hud.ParryTrainerLimit.mode, 'none');
    hud.ParryTrainerRunAction();
    assert.equal(commands.at(-1), 'parry_trainer_begin none');
});

test('custom melee bounds and weighting update the drill without applying a template', () => {
    const menu = trainerMenu(), { hud, root, commands, label } = menu;
    const readouts = () => ['Min', 'Bias', 'Max'].map(kind => label('Melee' + kind + 'Value'));
    const move = (kind, value) => hud.ParryTrainerSetSlider(root, 'melee_' + kind, value);
    assert.deepEqual(readouts(), [50, 75, 100].map(metres));
    move('min', 0);
    move('max', 50);
    move('bias', 0);
    menu.settle();
    assert.deepEqual(readouts(), [0, 0, 50].map(metres));
    assert.equal(menu.status('parried'), 'Off');
    assert.equal(label('PresetValue'), 'Normal · 50');
    assert.deepEqual(commands, ['parry_trainer_setting melee_min 0', 'parry_trainer_setting melee_max 50', 'parry_trainer_setting melee_bias 0']);
    const saved = hud.ParryTrainerPreset.snapshot().join(',');
    const restored = trainerMenu(saved);
    assert.deepEqual(['Min','Bias','Max'].map(kind => restored.label('Melee' + kind + 'Value')), readouts());
    assert.deepEqual(restored.commands, []);
    menu.apply(0);
    assert.deepEqual(readouts(), [100, 100, 100].map(metres));
    menu.apply(100);
    assert.deepEqual(readouts(), [0, 0, 100].map(metres));
});

test('melee handles share a physical scale and overlapping bounds can be separated with the keyboard', () => {
    const menu = trainerMenu(), { hud, root } = menu;
    hud.ParryTrainerOpenTab('Combat');
    root.SetHasClass('PTMenuLatched', true);
    const settings = () => ['melee_min', 'melee_max', 'melee_bias'].map(hud.ParryTrainerPreset.get);
    const biasChoice = root.FindChildTraverse('ParryTrainerMeleeBiasChoice');
    function drag(key, value) {
        hud.ParryTrainerSelectMelee(key);
        const slider = root.FindChildTraverse(hud.ParryTrainerHandles[key].id);
        slider.actuallayoutheight = 34;
        slider.FindChildTraverse('SliderTrack').actuallayoutheight = 34;
        menu.move(value, slider.id.slice('ParryTrainer'.length));
        slider.FindChildTraverse('SliderTrack').actuallayoutheight = 6;
        slider.SliderReleased();
    }
    drag('melee_bias', 80);
    assert.deepEqual(settings(), [50, 100, 60]); // 80% of world reach is 60% of the selected interval.
    drag('melee_max', 25); // Stop at the lower bound.
    assert.deepEqual(settings(), [50, 50, 60]);
    assert.equal(biasChoice.enabled, false);
    hud.ParryTrainerStepMelee('melee_bias', -1);
    assert.deepEqual(settings(), [50, 50, 60]);
    hud.ParryTrainerSelectMelee('melee_max');
    hud.ParryTrainerStepMelee('melee_max', 1);
    assert.ok(biasChoice.enabled);
    hud.ParryTrainerStepMelee('melee_bias', 1); // Relative weighting remains editable even inside a 1% interval.
    assert.deepEqual(settings(), [50, 51, 61]);
    assert.equal(menu.label('MeleeBiasValue'), metres(50.61));
    menu.settle();
    assert.deepEqual(menu.commands.filter(command => command.startsWith('parry_trainer_setting ')),
        ['parry_trainer_setting melee_bias 60', 'parry_trainer_setting melee_max 51', 'parry_trainer_setting melee_bias 61']);
});

test('interval bounds and favored wait share the seconds scale and keep world rings exclusive to distance', () => {
    const menu = trainerMenu(), { hud, root, commands, label } = menu;
    const values = () => ['Min', 'Bias', 'Max'].map(part => label('Interval' + part + 'Value'));
    const format = value => meleeRange.formatSeconds(value);
    assert.deepEqual(values(), ['1 s', '3.5 s', '6 s']);
    hud.ParryTrainerOpenTab('Combat');
    root.SetHasClass('PTMenuLatched', true);
    function drag(part, percent) {
        hud.ParryTrainerSelectMelee('interval_' + part.toLowerCase());
        const slider = root.FindChildTraverse('ParryTrainerInterval' + part);
        slider.actuallayoutheight = 34;
        const track = slider.FindChildTraverse('SliderTrack');
        track.actuallayoutheight = 34;
        hud.ParryTrainerCheckRangeHold(root);
        menu.move(percent, 'Interval' + part);
        assert.equal(root.BHasClass('PTRangePreview'), false);
        track.actuallayoutheight = 6;
        slider.SliderReleased();
    }
    drag('Min', 20);
    drag('Max', 80);
    drag('Bias', 65); // 65 on the full scale puts weighting 75% of the way from 20 to 80.
    assert.deepEqual(values(), [20, 65, 80].map(format));
    assert.equal(hud.ParryTrainerPreset.get('interval_bias'), 75);
    hud.ParryTrainerStepMelee('interval_bias', 1);
    menu.settle();
    assert.deepEqual(commands, ['parry_trainer_setting interval_min 20', 'parry_trainer_setting interval_max 80', 'parry_trainer_setting interval_bias 76']);
    const saved = trainerMenu(hud.ParryTrainerPreset.snapshot().join(','));
    assert.equal(saved.label('SummaryInterval'), format(20) + ' – ' + format(80));
    assert.equal(saved.label('SummaryFavoredInterval'), format(65.6));
    assert.deepEqual(['Min', 'Bias', 'Max'].map(part => label('Melee' + part + 'Value')), [50, 75, 100].map(metres));
    drag('Min', 90); // Endpoints may coincide. Select Maximum to separate them again.
    assert.equal(root.FindChildTraverse('ParryTrainerIntervalBiasChoice').enabled, false);
    assert.deepEqual(values(), [80, 80, 80].map(format));
    hud.ParryTrainerStepMelee('interval_max', 1);
    assert.equal(root.FindChildTraverse('ParryTrainerIntervalBiasChoice').enabled, true);
});

test('migrated interval readouts keep exact timing until the user steps onto an adjacent tick', () => {
    const { hud, label, commands, settle } = trainerMenu('preset=50,version=5,interval_min=16,interval_max=57');
    assert.equal(label('IntervalMinValue'), '2.56 s');
    assert.equal(label('IntervalMaxValue'), '4.24 s');
    hud.ParryTrainerStepMelee('interval_min', 1);
    hud.ParryTrainerStepMelee('interval_max', -1);
    settle();
    assert.deepEqual(commands, ['parry_trainer_setting interval_min 32', 'parry_trainer_setting interval_max 64']);
    assert.equal(label('IntervalMinValue'), '2.6 s');
    assert.equal(label('IntervalMaxValue'), '4.2 s');
});

test('closing the menu with the interval captured discards its native input without moving distance handles', () => {
    const menu = trainerMenu(), { hud, root, commands } = menu;
    hud.ParryTrainerOpenTab('Combat');
    root.SetHasClass('PTMenuLatched', true);
    const slider = root.FindChildTraverse('ParryTrainerIntervalMin'), distance = root.FindChildTraverse('ParryTrainerMeleeMin');
    slider.actuallayoutheight = slider.FindChildTraverse('SliderTrack').actuallayoutheight = 34;
    hud.ParryTrainerCheckRangeHold(root);
    root.SetHasClass('PTMenuLatched', false);
    menu.move(96, 'IntervalMin');
    menu.settle(0.04);
    assert.equal(slider.IsValid(), false);
    assert.equal(distance.IsValid(), true);
    root.SetHasClass('PTMenuLatched', true);
    slider.onvaluechanged();
    assert.equal(hud.ParryTrainerPreset.get('interval_min'), 0);
    assert.deepEqual(commands, []);
});

test('detail view shows live distances outside sessions, yields to an edit and resumes on release', () => {
    const layout = fs.readFileSync(path.join(__dirname, 'panel.xml'), 'utf8');
    assert.match(layout, /<GlobalClassListener classes="[^"]*\bgDetailView\b/);
    assert.match(layout, /class="PTRangeHelp[^"]*"[^>]*>[\s\S]*?<CitadelBinding action="ExtraInfo"/);
    const { hud, root, commands } = trainerMenu();
    let now = 1000;
    hud.Date = { now: () => now };
    function inspect() { hud.ParryTrainerWatchRangeInspect(root); }
    root.SetHasClass('gDetailView', true);
    inspect();
    inspect();
    assert.deepEqual(commands, ['parry_trainer_range_preview inspect 50 100 50']);
    assert.equal(root.BHasClass('PTRangePreview'), false);
    now += 500;
    inspect();
    assert.equal(commands.length, 2); // Keep a still, held inspection alive.
    hud.ParryTrainerOpenTab('Combat');
    root.SetHasClass('PTMenuLatched', true);
    hud.ParryTrainerStepMelee('melee_bias', 1);
    inspect();
    assert.equal(commands.at(-1), 'parry_trainer_range_preview favored 50 100 51');
    hud.ParryTrainerEndRangePreview(root);
    assert.equal(commands.at(-1), 'parry_trainer_range_preview inspect 50 100 51');
    root.SetHasClass('gDetailView', false);
    inspect();
    assert.equal(commands.at(-1), 'parry_trainer_range_preview off');
    root.SetHasClass('gDetailView', true);
    for (const phase of ['countdown', 'running']) {
        hud.ParryTrainerRun.phase = phase;
        inspect();
        assert.equal(commands.at(-1), 'parry_trainer_range_preview off');
    }
    hud.ParryTrainerRun.phase = 'finished';
    inspect();
    assert.equal(commands.at(-1), 'parry_trainer_range_preview inspect 50 100 51');
    root.SetHasClass('gShopOpen', true);
    inspect();
    assert.equal(commands.at(-1), 'parry_trainer_range_preview off');
});

test('range preview follows a captured drag independently of saving and ends outside the rail', () => {
    const menu = trainerMenu(), { hud, root, commands } = menu;
    let now = 1000;
    hud.Date = { now: () => now };
    hud.ParryTrainerOpenTab('Combat');
    root.SetHasClass('PTMenuLatched', true);
    const slider = root.FindChildTraverse('ParryTrainerMeleeMin');
    slider.actuallayoutheight = 34;
    slider.FindChildTraverse('SliderTrack').actuallayoutheight = 34;
    const foreign = root.FindChildTraverse('ParryTrainerMeleeMax').FindChildTraverse('SliderThumb');
    hud.ParryTrainerCheckRangeHold(root);
    assert.equal(root.BHasClass('PTRangePreview'), true);
    assert.equal(slider.BHasClass('PTActiveRing'), true);
    assert.equal(root.FindChildTraverse('ParryTrainerMeleeMinChoice').BHasClass('PTActiveRing'), true);
    assert.deepEqual(commands, ['parry_trainer_range_preview min 50 100 50']);
    foreign.onmouseover();
    assert.equal(hud.ParryTrainerHandles.melee_min.range.selected, 'melee_min');
    menu.move(41, 'MeleeMin');
    menu.move(42, 'MeleeMin');
    now += 40;
    menu.settle(0.04);
    assert.deepEqual(commands, ['parry_trainer_range_preview min 50 100 50', 'parry_trainer_range_preview min 42 100 50']);
    now += 160;
    menu.settle();
    assert.equal(commands.at(-1), 'parry_trainer_setting melee_min 42');
    now += 240;
    menu.settle();
    assert.equal(commands.at(-1), 'parry_trainer_range_preview min 42 100 50');
    slider.SliderReleased(); // The native event arrives one layout frame before the physical style clears.
    hud.ParryTrainerCheckRangeHold(root);
    assert.equal(commands.at(-1), 'parry_trainer_range_preview min 42 100 50');
    slider.FindChildTraverse('SliderTrack').actuallayoutheight = 6;
    menu.settle(0.04);
    assert.equal(root.BHasClass('PTRangePreview'), false);
    assert.deepEqual(commands.slice(-2), ['parry_trainer_range_preview min 42 100 50', 'parry_trainer_range_preview off']);
    now += 1000;
    menu.settle();
    assert.equal(commands.at(-1), 'parry_trainer_range_preview off');
    hud.ParryTrainerCheckRangeHold(root); // Remaining over the same rail does not restart it.
    assert.equal(slider.BHasClass('PTActiveRing'), false);
    slider.FindChildTraverse('SliderTrack').actuallayoutheight = 34;
    hud.ParryTrainerCheckRangeHold(root); // Re-press without moving the cursor.
    assert.equal(commands.at(-1), 'parry_trainer_range_preview min 42 100 50');
    slider.FindChildTraverse('SliderTrack').actuallayoutheight = 6;
    slider.SliderReleased();
    assert.equal(commands.at(-1), 'parry_trainer_range_preview off');
    assert.equal(slider.IsValid(), true); // Normal release retains the native controls.
});

test('range preview is scoped to open Opponents, supports keyboard steps and clears after editing', () => {
    const menu = trainerMenu(), { hud, root, commands } = menu;
    let now = 1000;
    hud.Date = { now: () => now };
    let slider = root.FindChildTraverse('ParryTrainerMeleeMax');
    slider.actuallayoutheight = 34;
    slider.FindChildTraverse('SliderTrack').actuallayoutheight = 6;
    root.SetHasClass('PTMenuLatched', true);
    hud.ParryTrainerCheckRangeHold(root);
    assert.deepEqual(commands, []);
    hud.ParryTrainerOpenTab('Combat');
    slider.FindChildTraverse('SliderThumb').onmouseover();
    assert.deepEqual(commands, []);
    slider.FindChildTraverse('SliderTrack').actuallayoutheight = 34;
    hud.ParryTrainerCheckRangeHold(root);
    assert.equal(commands.at(-1), 'parry_trainer_range_preview max 50 100 50');
    hud.ParryTrainerOpenTab('Score');
    assert.equal(commands.at(-1), 'parry_trainer_range_preview off');
    assert.equal(slider.IsValid(), false);
    slider = root.FindChildTraverse('ParryTrainerMeleeMax');
    slider.actuallayoutheight = 34;
    hud.ParryTrainerOpenTab('Combat');
    slider.FindChildTraverse('SliderTrack').actuallayoutheight = 6;
    hud.ParryTrainerStepMelee('melee_bias', 1);
    assert.equal(commands.at(-1), 'parry_trainer_range_preview favored 50 100 51');
    now += 701;
    menu.settle(0.04);
    assert.equal(commands.at(-1), 'parry_trainer_range_preview off');
    assert.equal(slider.IsValid(), true); // A keyboard preview expiring requires no capture cleanup.
    slider.FindChildTraverse('SliderThumb').onmouseover();
    slider.FindChildTraverse('SliderTrack').actuallayoutheight = 34;
    hud.ParryTrainerCheckRangeHold(root);
    root.SetHasClass('PTMenuLatched', false);
    menu.move(10, 'MeleeMax'); // Releasing Tab warps the cursor before the game routes mouse-up.
    menu.settle(0.04);
    assert.equal(root.BHasClass('PTRangePreview'), false);
    assert.equal(commands.at(-1), 'parry_trainer_range_preview off');
    assert.equal(slider.IsValid(), false);
    root.SetHasClass('PTMenuLatched', true);
    slider.onvaluechanged();
    assert.equal(hud.ParryTrainerPreset.get('melee_max'), 100);
    hud.ParryTrainerSelectMelee('melee_min');
    menu.move(36, 'MeleeMin'); // A quick native rail click changes value before the :active layout frame.
    menu.move(20, 'MeleeMax'); // Only the selected, visible native input can update a bound.
    assert.equal(hud.ParryTrainerPreset.get('melee_min'), 36);
    assert.equal(hud.ParryTrainerPreset.get('melee_max'), 100);
});

test('returning the slider to its current value disables Apply; a new edit hides Begin again', () => {
    const menu = trainerMenu('preset=50,version=3,troopers=1'), { hud, root } = menu;
    hud.ParryTrainerOpenTab('Presets');
    const apply = root.FindChildTraverse('ParryTrainerPresetApply');
    menu.move(49);
    assert.ok(apply.enabled && apply.hittest);
    menu.move(50);
    assert.equal(apply.enabled, false);
    assert.equal(apply.hittest, false);
    hud.ParryTrainerApplyPreset();
    assert.deepEqual(menu.commands, []);
    menu.apply(60);
    assert.equal(apply.enabled, false);
    assert.equal(apply.hittest, false);
    assert.ok(root.BHasClass('TemplateApplied'));
    menu.move(61);
    assert.ok(apply.enabled && apply.hittest);
    assert.equal(root.BHasClass('TemplateApplied'), false);
    menu.move(60);
    assert.equal(apply.enabled, false);
    assert.equal(apply.hittest, false);
    hud.ParryTrainerRunAction();
    assert.deepEqual(menu.commands, ['parry_trainer_setting preset 60']);
});

test('Begin stays available on other tabs, while an active session can stop from Templates', () => {
    const css = fs.readFileSync(path.join(__dirname, 'difficulty.css'), 'utf8');
    assert.match(css, /\.OnPresets #ParryTrainerBegin\s*\{[^}]*visibility:\s*collapse/);
    for (const state of ['TemplateApplied', 'InSession']) {
        assert.match(css, new RegExp('\\.OnPresets\\.' + state + ' #ParryTrainerBegin[^{]*\\{[^}]*visibility:\\s*visible'));
    }
    const saved = 'preset=50,version=3,hero1=hero_wraith,limit_mode=timer,timer=90';
    const menu = trainerMenu(saved), { hud, commands, root } = menu;
    hud.ParryTrainerOpenTab('Presets');
    menu.move(27);
    hud.ParryTrainerRunAction(); // A stale activation must not start from an unconfirmed preview.
    assert.deepEqual(commands, []);
    hud.ParryTrainerOpenTab('Combat');
    hud.ParryTrainerRunAction();
    assert.deepEqual(commands, ['parry_trainer_begin timer 90']);
    menu.snapshot({ SessionPhase: 'countdown', SessionRemaining: 3, SessionMode: 'timer', TrainerSettings: saved });
    hud.ParryTrainerOpenTab('Presets');
    assert.equal(menu.label('Hero1'), 'Wraith ›');
    assert.equal(menu.label('SummaryFinish'), 'Timer');
    assert.equal(menu.label('BeginLabel'), 'Cancel countdown');
    assert.equal(root.FindChildTraverse('ParryTrainerPreset').enabled, false);
    menu.move(68); hud.ParryTrainerApplyPreset(); menu.settle();
    assert.deepEqual(commands, ['parry_trainer_begin timer 90']);
    assert.match(menu.label('PresetHint'), /End the session/);
    hud.ParryTrainerRunAction();
    assert.equal(commands.at(-1), 'parry_trainer_stop');
    menu.snapshot({ SessionPhase: 'running', SessionMode: 'timer', TrainerSettings: saved });
    assert.equal(menu.label('BeginLabel'), 'End session');
    hud.ParryTrainerRunAction();
    assert.equal(commands.at(-1), 'parry_trainer_stop');
});

test('changing tabs, closing the menu or resetting clears permission to Begin from Templates', () => {
    const menu = trainerMenu(), { hud, root } = menu;
    for (const level of [25, 40, 65]) {
        hud.ParryTrainerOpenTab('Presets');
        menu.apply(level);
        assert.ok(root.BHasClass('TemplateApplied'));
        if (level === 25) {
            hud.ParryTrainerOpenTab('Score');
            hud.ParryTrainerOpenTab('Presets');
        } else if (level === 40) {
            hud.ParryTrainerDiscardPreset(root); // Also called on scoreboard-key release.
        } else {
            hud.ParryTrainerReset();
            menu.snapshot();
        }
        assert.equal(root.BHasClass('TemplateApplied'), false);
        const before = menu.commands.length;
        hud.ParryTrainerRunAction();
        assert.equal(menu.commands.length, before);
    }
    menu.move(70); hud.ParryTrainerApplyPreset();
    hud.ParryTrainerOpenTab('Score'); hud.ParryTrainerOpenTab('Presets');
    menu.snapshot({ TrainerSettings: 'preset=70,version=3' });
    assert.equal(hud.ParryTrainerPreset.preset, 70);
    assert.equal(root.BHasClass('TemplateApplied'), false);
});

test('Session opens directly on the finish and loss controls', () => {
    const { root, hud, toggle, status, label, snapshot } = trainerMenu();
    hud.ParryTrainerPage('Setup');
    snapshot();
    assert.ok(root.BHasClass('OnSetup'));
    assert.ok(root.FindChildTraverse('ParryTrainerNavSetup').BHasClass('Selected'));
    hud.ParryTrainerSetLimit('goal');
    for (const [key, id, value] of [['parries', 'ParryInput', '1'], ['souls', 'SoulInput', '12']]) {
        root.FindChildTraverse('ParryTrainer' + id).text = value;
        hud.ParryTrainerEditField(key);
    }
    hud.ParryTrainerLeaveRules();
    assert.equal(hud.ParryTrainerLimit.parries, 1);
    assert.equal(hud.ParryTrainerLimit.souls, 12);
    assert.equal(status('fail_on_death'), 'Off');
    assert.equal(status('fail_on_hits'), 'Off');
    toggle('fail_on_death');
    assert.equal(status('death'), 'Off');
    assert.match(label('DeathHint'), /standing-still damage/);
    toggle('death'); toggle('fail_on_death');
    assert.equal(status('death'), 'On');
    assert.equal(root.FindChildTraverse('ParryTrainerDeathHint').visible, false);
    assert.equal(label('SummaryDeath'), 'On');
    assert.equal(label('SummaryDeathRule'), 'Off');
});

test('Session allows independent soul penalties during training, with feedback on Templates', () => {
    const menu = trainerMenu();
    const keys = ['penalty_hit', 'penalty_unparried', 'penalty_whiff'];
    assert.deepEqual(keys.map(menu.status), ['Off', 'Off', 'Off']);
    assert.equal(menu.label('SummarySoulPenalties'), 'Off');
    menu.snapshot({ SessionPhase: 'running' });
    for (const key of keys) menu.toggle(key);
    assert.deepEqual(keys.map(menu.status), ['On', 'On', 'On']);
    assert.equal(menu.label('SummarySoulPenalties'), 'Hit · Unparried · Empty parry');
    menu.toggle('penalty_unparried');
    assert.deepEqual(menu.commands, ['parry_trainer_setting penalty_hit 1', 'parry_trainer_setting penalty_unparried 1',
        'parry_trainer_setting penalty_whiff 1', 'parry_trainer_setting penalty_unparried 0']);
    assert.equal(menu.label('SummarySoulPenalties'), 'Hit · Empty parry');
    const restored = trainerMenu(menu.hud.ParryTrainerPreset.snapshot().join(','));
    assert.deepEqual(keys.map(restored.status), ['On', 'Off', 'On']);
});

test('a pending manual slider command reaches the host before Apply and a rejected change reports failure', () => {
    const menu = trainerMenu(), { hud } = menu;
    menu.move(35, 'IdleRate');
    assert.equal(menu.label('SummaryIdleDrain'), '35% HP / sec');
    hud.ParryTrainerPage('Presets');
    menu.move(51);
    hud.ParryTrainerApplyPreset();
    assert.deepEqual(menu.commands, ['parry_trainer_setting idle_rate 35', 'parry_trainer_setting preset 51']);
    menu.snapshot({ TrainerSettings: 'preset=50,version=3,idle_rate=35' });
    assert.equal(menu.label('IdleRateValue'), '35%');
    assert.match(menu.label('DifficultyFeedback'), /not applied|could not apply/i);
    assert.equal(menu.label('PresetValue'), 'Harder · 51');
    assert.equal(menu.root.FindChildTraverse('ParryTrainerPresetApply').enabled, true);
    assert.equal(menu.root.BHasClass('TemplateApplied'), false);
    hud.ParryTrainerApplyPreset();
    menu.snapshot({ TrainerSettings: 'preset=51,version=' + hud.presetFormatVersion });
    assert.ok(menu.root.BHasClass('TemplateApplied'));
});

test('session limits accept valid seconds, clock notation and whole parry counts', () => {
    const hud = vm.createContext({ drillDefaults: require('../difficulty-settings.js').drillDefaults });
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'session.js'), 'utf8'), hud);
    for (const [text, seconds] of [['0:01', 1], ['1:30', 90], ['86400', 86400], ['1440:00', 86400]]) {
        assert.equal(hud.ParryTrainerReadLimit('timer', text), seconds);
    }
    for (const text of ['0', '2:65', '1440:01', '1.5', 'soon', '']) assert.equal(hud.ParryTrainerReadLimit('timer', text), null);
    for (const text of ['10000', '1.2', '-1', '']) assert.equal(hud.ParryTrainerReadLimit('souls', text), null);
    assert.equal(hud.ParryTrainerReadLimit('souls', '0'), 0);
    assert.equal(hud.ParryTrainerReadLimit('parries', '9999'), 9999);
});

test('score sync recovers from a dropped join request and delayed publications', () => {
    let time = 5000;
    let phase = 'ready';
    const requests = new Map();
    const attempts = new Set();
    const updates = [];
    const hud = vm.createContext({
        Date: { now: () => time },
        ParryTrainerRun: { phase: 'ready', mode: 'none' },
        ParryTrainerSettingsReady: true, ParryTrainerStartAvailability() {}, ParryTrainerUpdateSaveNotice() {}, ParryTrainerProfiles: { pending: '' }, ParryTrainerReceiveProfiles() {},
        ParryTrainerIsActive: () => false, ParryTrainerText: () => {}, ParryTrainerShowStats: () => {},
        ParryTrainerApplySession: (status) => updates.push(status),
        $: {
            DispatchEvent(_, command) {
                const token = command.split(' ')[1];
                requests.set(token, { status: phase, readyAt: requests.size ? time + 4000 : Infinity });
            },
            CreatePanel() {
                let response;
                return {
                    BLoadLayout(path) {
                        const token = path.match(/score_(\d+)(?:_retry)?\.xml/)[1];
                        assert.equal(attempts.has(path), false, 'negative-cached paths cannot be retried');
                        attempts.add(path);
                        response = requests.get(token);
                        return time >= response.readyAt;
                    },
                    FindChildTraverse: (id) => ({ text: id === 'SessionPhase' ? response.status : '' }),
                    DeleteAsync() {}
                };
            }
        }
    });
    for (const file of ['score-view.js', 'score.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), hud);
    const poll = (open) => hud.ParryTrainerPollScore({ BHasClass: () => false }, open);
    for (let i = 0; i < 100; i++, time += 100) poll(false);
    assert.deepEqual(updates, ['ready']);
    // A late pre-Begin reply cannot roll the HUD back to Ready.
    poll(true);
    const pendingBeforeStart = String(hud.ParryTrainerScore.pending);
    phase = 'running';
    hud.ParryTrainerInvalidateScore();
    for (let i = 0; i < 90; i++, time += 100) poll(false);
    assert.deepEqual(updates, ['ready', 'running']);
    assert.equal([...attempts].some(path => path.includes('score_' + pendingBeforeStart + '.xml') || path.includes('score_' + pendingBeforeStart + '_retry.xml')), false);
});

test('both creep behaviors follow a new preset after customization', () => {
    const menu = trainerMenu();
    const modes = () => [menu.status('trooper_active'), menu.status('camp_reactive')];
    assert.deepEqual(modes(), ['Stationary', 'Retaliate']);
    menu.apply(100); menu.toggle('camp_reactive');
    assert.deepEqual(modes(), ['Chase & attack', 'Stationary']);
    menu.apply(50);
    assert.deepEqual(modes(), ['Stationary', 'Retaliate']);
    menu.apply(0); menu.toggle('trooper_active');
    assert.deepEqual(modes(), ['Chase & attack', 'Stationary']);
    menu.apply(100);
    assert.deepEqual(modes(), ['Chase & attack', 'Retaliate']);
});

test('Creeps and Templates show active source options and keep dormant values through toggles and reload', () => {
    const menu = trainerMenu(), { hud, root, label, toggle } = menu;
    const visible = key => root.FindChildTraverse('ParryTrainer' + key).visible;
    const states = () => ['TrooperSettings', 'CampSettings', 'TrooperSpeedControl', 'SummarySpeedRow'].map(visible);
    assert.deepEqual(states(), [false, false, false, false]);
    assert.deepEqual([label('SummaryTroopers'), label('SummaryCamps')], ['Off','Off']);
    toggle('troopers');
    assert.deepEqual(states(), [true, false, false, false]);
    toggle('trooper_active'); menu.move(43, 'TrooperSpeed'); hud.ParryTrainerStep('TrooperCount', 1);
    assert.deepEqual(states(), [true, false, true, true]);
    toggle('camps'); hud.ParryTrainerStep('CampTier', 1);
    assert.equal(visible('CampSettings'), true);
    toggle('troopers'); toggle('camps');
    assert.deepEqual(states(), [false, false, false, false]);
    assert.deepEqual([label('SummaryTroopers'), label('SummaryCamps')], ['Off','Off']);
    const saved = hud.ParryTrainerPreset.snapshot().join(',');
    const restored = trainerMenu(saved);
    restored.toggle('troopers'); restored.toggle('camps');
    assert.deepEqual(['TrooperSpeedValue','TrooperCount','CampTier'].map(restored.label), ['43%', '2', 'II']);
    restored.apply(0);
    assert.equal(restored.root.FindChildTraverse('ParryTrainerTrooperSettings').visible, false);
    restored.apply(100);
    assert.equal(restored.root.FindChildTraverse('ParryTrainerSummarySpeedRow').visible, true);
    assert.equal(restored.root.FindChildTraverse('ParryTrainerCampSettings').visible, true);
    assert.equal(restored.label('TrooperSpeedValue'), '100%');
});

test('Training goals support parries, souls and both, with a source for soul orbs', () => {
    for (const [parries, souls] of [[5,0], [0,8], [2,4]]) {
        const { root, hud, commands, toggle, snapshot } = trainerMenu();
        hud.ParryTrainerSetLimit('goal');
        root.FindChildTraverse('ParryTrainerParryInput').text = String(parries);
        root.FindChildTraverse('ParryTrainerSoulInput').text = String(souls);
        if (souls) {
            hud.ParryTrainerRunAction();
            assert.equal(hud.ParryTrainerRun.phase, 'ready');
            assert.match(root.FindChildTraverse('ParryTrainerLimitError').text, /troopers or neutral camps/);
            toggle('troopers');
        }
        hud.ParryTrainerRunAction();
        assert.ok(commands.includes('parry_trainer_begin goal ' + parries + ' ' + souls));
        assert.equal(hud.ParryTrainerRun.phase, 'ready');
        snapshot({ SessionPhase: 'countdown', SessionMode: 'goal', SessionGoal: parries, SessionSoulGoal: souls });
        assert.equal(hud.ParryTrainerRun.phase, 'countdown');
    }
    const { root, hud } = trainerMenu();
    hud.ParryTrainerSetLimit('goal');
    root.FindChildTraverse('ParryTrainerParryInput').text = '0';
    hud.ParryTrainerRunAction();
    assert.equal(hud.ParryTrainerRun.phase, 'ready');
    assert.match(root.FindChildTraverse('ParryTrainerLimitError').text, /at least one goal/);
});

test('the top HUD always has parry and creep counts and adds each active goal', () => {
    const { root, hud } = trainerMenu();
    const stats = { SessionParries: 4, SessionHeavies: 7, SessionHits: 2, LaneKills: 3,
        LaneSecured: 2, LaneMissed: 1, CampKills: 1, CampSecured: 1, CampMissed: 0 };
    const label = id => root.FindChildTraverse('ParryTrainerHud' + id).text;
    hud.ParryTrainerShowStats(root, id => stats[id]);
    for (const [mode, parries, souls, caption, hudText] of [
        ['none', 0, 0, '', ''], ['timer', 0, 0, '', ''], ['goal', 5, 0, 'Goal', '4/5 parries'],
        ['goal', 0, 6, 'Goal', '3/6 souls'], ['goal', 5, 6, 'Goals', '4/5 parries  ·  3/6 souls'],
    ]) {
        hud.ParryTrainerApplySession('running', mode, 30, parries, 4, souls, 3, 'none', 1000);
        hud.ParryTrainerDrawSession(root, 1000);
        assert.equal(label('Text'), hudText);
        assert.equal(label('Caption'), caption);
        assert.equal(root.BHasClass('HasHudText'), mode === 'goal');
        assert.equal(label('Parries'), '4/7 · 2 hits taken');
        assert.equal(label('Troopers'), 'Trooper souls');
        assert.equal(label('LaneSouls'), '2 secured · 1 missed');
        assert.equal(label('Camps'), 'Camp souls');
        assert.equal(label('CampSouls'), '1 secured · 0 missed');
    }
});

test('the top clock counts only active training and freezes the host duration or remaining time upon finish', () => {
    const { root, hud, label } = trainerMenu();
    function frame(phase, mode, elapsed, remaining, at, drawAt) {
        hud.ParryTrainerApplySession(phase, mode, remaining, 0, 0, 0, 0, '', at, elapsed);
        hud.ParryTrainerDrawSession(root, drawAt);
        return [label('ClockCaption'), label('Clock')];
    }
    assert.deepEqual(frame('ready','none',0,0,1000,45000), ['Time elapsed','0:00']);
    assert.deepEqual(frame('countdown','none',0,3,1000,2500), ['Time elapsed','0:00']);
    assert.deepEqual(frame('running','none',0,0,4000,5500), ['Time elapsed','0:01']);
    assert.deepEqual(frame('running','goal',37,0,41000,43500), ['Time elapsed','0:39']);
    assert.deepEqual(frame('finished','goal',42,0,46000,101000), ['Time elapsed','0:42']);
    assert.deepEqual(frame('ready','none',0,0,102000,108000), ['Time elapsed','0:00']);
    hud.ParryTrainerSetLimit('timer');
    assert.deepEqual(frame('countdown','timer',0,2,1000,1200), ['Time left','5:00']);
    assert.deepEqual(frame('running','timer',13,287,14000,15000), ['Time left','4:46']);
    assert.equal(label('HudText'), '');
    assert.deepEqual(frame('finished','timer',23,277,24000,90000), ['Time left','4:37']);
});

test('Score uses the same snapshot as the top bar and separates lane and camp souls', () => {
    const { root, hud, label, snapshot } = trainerMenu();
    const stats = { SessionParries: 3, SessionHeavies: 5, SessionHits: 1, LaneSecured: 2, LaneMissed: 4, LaneKills: 6, CampSecured: 3, CampMissed: 1, CampKills: 4 };
    hud.ParryTrainerShowStats(root, id => stats[id] || 0);
    assert.deepEqual(['Parries','Heavies','Hits','ParryRate'].map(name => label('Score' + name)), ['3','5','1','60%']);
    assert.deepEqual(['LaneSecured','LaneMissed','LaneKills','CampSecured','CampMissed','CampKills'].map(name => label('Score' + name)), ['2','4','6','3','1','4']);
    snapshot({ SessionPhase: 'countdown', SessionRun: 1 });
    assert.equal(label('ScoreParryRate'), 'No incoming heavies');
    assert.equal(label('ScoreWeaponAccuracy'), '—');
    assert.equal(label('ScoreLaneSecured'), '0');
});

test('the server score fields reach each HUD counter', () => {
    const { PracticeSession } = require('../session.ts');
    const { scoreFields } = require('../score-snapshot.ts');
    const run = new PracticeSession();
    run.begin({ mode: 'goal', parries: 13, souls: 15 }, 0, 9);
    run.tick(3, 0);
    run.heavy = 17;
    run.parries = 5;
    run.hits = 3;
    run.damageTaken = 412;
    run.bulletsFired = 9;
    run.bulletsHit = 6;
    run.deaths = 2;
    run.deductSouls(11, 3);
    run.finish('stopped', 20);
    const souls = { troopers: { secured: 4, missed: 2, kills: 6 }, camps: { secured: 7, missed: 1, kills: 8 } };
    const fields = scoreFields(run, souls, 21, 'preset=72,version=2,hero1=hero_atlas');
    const menu = trainerMenu(null);
    menu.snapshot(fields);
    const { label } = menu;
    assert.equal(label('Phase'), 'Finished');
    assert.equal(label('HudCaption'), 'Training ended');
    assert.equal(label('HudText'), '5/13 parries  ·  8/15 souls');
    assert.deepEqual(['Damage','Deaths','Deductions','NetSouls'].map(key => label('Score' + key)), ['412 HP','2','3','8']);
    assert.equal(label('HudParries'), '5/17 · 3/9 hits taken');
    assert.equal(label('ScoreParryRate'), '29%');
    assert.equal(label('ScoreWeaponAccuracy'), '67% (6/9)');
    assert.deepEqual(['Parries', 'Heavies', 'Hits'].map(metric => label('Score' + metric)), ['5', '17', '3']);
    for (const [source, expected] of [['Lane', ['4', '2', '6']], ['Camp', ['7', '1', '8']]]) {
        assert.deepEqual(['Secured', 'Missed', 'Kills'].map(metric => label('Score' + source + metric)), expected);
    }
    assert.equal(label('PresetValue'), 'Harder · 72');
    assert.equal(label('Hero1'), 'Abrams ›');
});

test('a death failure displays frozen progress with the final stats and replay action', () => {
    const { root, hud } = trainerMenu();
    const label = id => root.FindChildTraverse('ParryTrainer' + id).text;
    const stats = { SessionParries: 2, SessionHeavies: 6, SessionHits: 3, LaneSecured: 4, CampMissed: 1 };
    hud.ParryTrainerShowStats(root, id => stats[id] || 0);
    for (const [mode, expected] of [
        ['timer', 'to train again'], ['goal', '2/5 parries  ·  4/8 souls'], ['none', 'to train again']
    ]) {
        hud.ParryTrainerApplySession('finished', mode, 17, 5, 2, 8, 4, 'death', 1000);
        hud.ParryTrainerDrawSession(root, 27000);
        assert.equal(label('Phase'), 'Failed · You died');
        assert.equal(label('HudCaption'), 'Failed · You died');
        assert.equal(label('HudText'), expected);
        assert.equal(label('BeginLabel'), 'Train again');
        assert.equal(label('HudParries'), '2/6 · 3 hits taken');
        assert.equal(label('HudLaneSouls'), '4 secured · 0 missed');
        assert.equal(label('HudCampSouls'), '0 secured · 1 missed');
    }
});

test('a legacy profile keeps its effective setup at Normal difficulty and restores goals and heroes silently', () => {
    const saved = 'effects=1,fail_on_death=1,difficulty=100,death=0,fail_on_death=0,second=1,hero1=hero_atlas,hero2=hero_inferno,' +
        'parried=1,stamina=0,troopers=1,trooper_count=4,camps=1,camp_tier=2,camp_reactive=0,limit_mode=goal,timer=905,parries=23,souls=9';
    const menu = trainerMenu(null);
    const { root, hud } = menu;
    const label = id => root.FindChildTraverse('ParryTrainer' + id).text;
    assert.equal(root.FindChildTraverse('ParryTrainerBegin').enabled, false);
    menu.toggle('second'); hud.ParryTrainerRunAction();
    assert.deepEqual(menu.commands, []);
    hud.ParryTrainerRestoreSettings(root, saved);
    assert.equal(root.FindChildTraverse('ParryTrainerBegin').enabled, true);
    assert.equal(menu.status('effects'), 'On');
    assert.equal(menu.status('fail_on_death'), 'Off');
    assert.equal(menu.status('death'), 'Off');
    assert.equal(menu.status('second'), 'On');
    assert.equal(root.BHasClass('ParryTrainerHasSecond'), true);
    assert.equal(menu.status('stamina'), 'Off');
    assert.equal(menu.hudClasses.has('ParryTrainerShowStun'), true);
    assert.deepEqual([label('Hero1'), label('Hero2')], ['Abrams ›', 'Infernus ›']);
    assert.deepEqual(['MeleeMinValue', 'MeleeMaxValue'].map(label), ['0.25 m', '0.25 m']);
    assert.equal(menu.status('troopers'), 'On');
    assert.equal(menu.status('camps'), 'On');
    assert.deepEqual([label('TrooperCount'), label('CampTier')], ['4', 'II']);
    assert.deepEqual([label('TrooperMode'), label('CampMode')], ['Chase & attack', 'Stationary']);
    assert.equal(root.BHasClass('GoalLimit'), true);
    assert.deepEqual([label('LimitInput'), label('ParryInput'), label('SoulInput')], ['15:05', '23', '9']);
    assert.deepEqual(menu.commands, []);
    assert.equal(label('PresetValue'), 'Normal · 50');
    hud.ParryTrainerSetSlider(root, 'melee_max', 50);
    assert.equal(menu.status('fail_on_death'), 'Off');
    assert.equal(menu.status('trooper_active'), 'Chase & attack');
    menu.toggle('second');
    hud.ParryTrainerRestoreSettings(root, saved); // A subsequent poll cannot restore over a new choice.
    assert.equal(menu.status('second'), 'Off');
    assert.deepEqual(['MeleeMinValue', 'MeleeMaxValue'].map(label), [0, 50].map(metres));
    assert.deepEqual(menu.commands, ['parry_trainer_setting melee_max 50', 'parry_trainer_setting second 0']);
});

test('Reset is locked until the first snapshot and waits for the host settings after a request', () => {
    const { hud, root, commands, status, snapshot } = trainerMenu(null);
    const reset = root.FindChildTraverse('ParryTrainerReset');
    const begin = root.FindChildTraverse('ParryTrainerBegin');
    hud.ParryTrainerReset();
    assert.equal(reset.enabled, false);
    assert.deepEqual(commands, []);
    const saved = 'difficulty=100,troopers=1';
    snapshot({ TrainerSettings: saved });
    assert.equal(status('troopers'), 'On');
    assert.equal(reset.enabled, true);

    for (const settings of [saved, 'preset=50,version=2']) {
        hud.ParryTrainerScore.pending = 42; // Bypass a score request that predates Reset.
        hud.ParryTrainerReset();
        assert.equal(hud.ParryTrainerScore.pending, 0);
        assert.equal(status('troopers'), 'On');
        assert.equal(reset.enabled, false);
        assert.equal(begin.enabled, false);
        hud.ParryTrainerReset(); hud.ParryTrainerRunAction();
        snapshot({ TrainerSettings: settings });
        assert.equal(reset.enabled, true);
        assert.equal(begin.enabled, true);
    }
    assert.deepEqual(commands, ['parry_trainer_reset', 'parry_trainer_reset']);
    assert.equal(status('troopers'), 'Off');
});

test('only fresh wins and losses play a result, once, even across score retries and fast runs', () => {
    const { snapshot, results, hud } = trainerMenu();
    const show = (id, phase, reason = 'none') =>
        snapshot({ SessionRun: id, SessionPhase: phase, SessionEndReason: reason });
    show(4, 'finished', 'death');
    assert.deepEqual(results, []);
    show(5, 'countdown');
    show(5, 'finished', 'stopped');
    assert.deepEqual(results, ['clear']);
    show(6, 'running');
    show(6, 'finished', 'time');
    show(6, 'finished', 'time');
    hud.ParryTrainerPage('Score');
    show(6, 'finished', 'time');
    show(7, 'finished', 'hits'); // Intermediate snapshots were unavailable.
    show(7, 'finished', 'hits');
    show(8, 'countdown');
    show(8, 'finished', 'goal');
    show(9, 'running');
    show(9, 'finished', 'death');
    show(9, 'ready');
    assert.deepEqual(results, ['clear', 'clear', 'victory', 'defeat', 'clear', 'victory', 'clear', 'defeat', 'clear']);
});

test('both score surfaces keep a single terminal score and disregard older runs', () => {
    const { snapshot, hud, label } = trainerMenu();
    let recap;
    hud.ParryTrainerShowResult = (_, outcome, values) => { recap = values; };
    snapshot({ SessionRun: 12, SessionPhase: 'running' });
    snapshot({ SessionRun: 12, SessionPhase: 'finished', SessionEndReason: 'goal', SessionMode: 'goal',
        SessionGoal: 2, SessionSoulGoal: 3, SessionParries: 2, SessionHeavies: 4, SessionSouls: 3,
        LaneSecured: 4, CampSecured: 2, SessionSoulsDeducted: 3, SessionElapsed: 31 });
    assert.deepEqual([recap.Status, recap.Elapsed, recap.Target, recap.GrossSouls, recap.Deductions, recap.NetSouls],
        ['Victory', 'Elapsed  0:31', '2/2 parries  ·  3/3 souls', '6', '3', '3']);
    snapshot({ SessionRun: 11, SessionPhase: 'countdown' });
    snapshot({ SessionRun: 12, SessionPhase: 'finished', SessionEndReason: 'time', SessionParries: 99 });
    for (const key of Object.keys(recap)) assert.equal(label('Score' + key), recap[key], key);
    snapshot({ SessionRun: 12, SessionPhase: 'ready' }); // A fresh trainee connection can keep the host session ID.
    assert.equal(label('ScoreStatus'), 'No session yet');
    snapshot({ SessionRun: 12, SessionPhase: 'finished', SessionEndReason: 'goal' }, 124); // A delayed response from the previous connection.
    assert.equal(label('ScoreStatus'), 'No session yet');
    snapshot({ SessionRun: 13, SessionPhase: 'running' });
    snapshot({ SessionRun: 13, SessionPhase: 'finished', SessionEndReason: 'stopped' });
    assert.equal(label('ScoreStatus'), 'Session stopped');
    snapshot({ SessionRun: 14, SessionPhase: 'finished', SessionEndReason: 'hits', SessionHits: 3, SessionHitLimit: 3 });
    assert.equal(label('ScoreReason'), '3 of 3 heavy hits taken.');
});

test('ordinary native death shows continuing play, preserves goals and freezes a lethal drain cause', () => {
    const { snapshot, hud, hudClasses, root, label } = trainerMenu();
    const recovered = () => root.FindChildTraverse('ParryTrainerHudRecovery').visible;
    const state = { SessionRun: 3, SessionPhase: 'running', SessionMode: 'goal', SessionGoal: 2,
        SessionParries: 1, SessionRulesChanged: 0, SessionFailOnDeath: 0 };
    snapshot(state);
    assert.equal(recovered(), false);
    hudClasses.add('dead');
    hud.ParryTrainerDrawSession(root, Date.now());
    assert.ok(recovered());
    assert.equal(label('ScoreStatus'), 'Respawning · session continues');
    assert.equal(label('HudText'), '1/2 parries');
    hudClasses.delete('dead');
    snapshot({ ...state, SessionRespawnMs: 400, SessionRulesChanged: 1 });
    assert.equal(recovered(), false);
    assert.equal(label('ScoreStatus'), 'In progress');
    hudClasses.add('dead');
    snapshot({ ...state, SessionFailOnDeath: 1, SessionRulesChanged: 1 });
    assert.equal(recovered(), false);
    let recap;
    hud.ParryTrainerShowResult = (_, outcome, values) => { recap = values; };
    snapshot({ ...state, SessionPhase: 'finished', SessionEndReason: 'death', SessionDeathCause: 'standing-drain', SessionRulesChanged: 1 });
    assert.equal(recovered(), false);
    assert.equal(recap.Reason, 'Standing still drained your remaining health.');
    assert.equal(recap.Changes, 'Rules changed during this session');
    assert.equal(label('ScoreChanges'), recap.Changes);
    snapshot({ SessionRun: 4, SessionPhase: 'countdown' });
    assert.equal(label('ScoreChanges'), '');
});

test('Train again keeps the death result until the host starts another run', () => {
    const { root, hud, commands, label, snapshot } = trainerMenu();
    const finalScore = { SessionPhase: 'finished', SessionEndReason: 'death', SessionParries: 4, SessionHeavies: 7 };
    snapshot(finalScore);
    for (const response of [finalScore, { SessionPhase: 'countdown', SessionRemaining: 3 }]) {
        hud.ParryTrainerRunAction();
        assert.equal(root.BHasClass('Counting'), false);
        assert.equal(label('ScoreParries'), '4');
        assert.equal(label('HudCaption'), 'Failed · You died');
        assert.equal(root.FindChildTraverse('ParryTrainerBegin').enabled, false);
        hud.ParryTrainerRunAction();
        snapshot(response);
    }
    assert.equal(root.BHasClass('Counting'), true);
    assert.equal(label('ScoreParries'), '0');
    assert.deepEqual(commands, ['parry_trainer_begin none', 'parry_trainer_begin none']);
});

test('a combined goal keeps its last creep source until enough souls have been secured', () => {
    const { root, commands, toggle, status, snapshot } = trainerMenu(null);
    snapshot({ SessionPhase: 'countdown', SessionMode: 'goal', SessionSoulGoal: 3, TrainerSettings: 'preset=55,version=2' });
    const sourceButton = id => root.FindChildTraverse('ParryTrainer' + id + 'Choice');
    assert.equal(sourceButton('Troopers').enabled, false);
    toggle('troopers'); toggle('camps'); toggle('troopers');
    assert.equal(status('troopers'), 'Off');
    assert.equal(status('camps'), 'On');
    snapshot({ SessionPhase: 'running', SessionMode: 'goal', SessionGoal: 5, SessionSoulGoal: 3, SessionSouls: 2 });
    assert.equal(sourceButton('Camps').enabled, false);
    toggle('camps');
    assert.deepEqual(commands, ['parry_trainer_setting camps 1', 'parry_trainer_setting troopers 0']);
    snapshot({ SessionPhase: 'running', SessionMode: 'goal', SessionGoal: 5, SessionSoulGoal: 3, SessionSouls: 3 });
    assert.equal(root.BHasClass('LastSoulSource'), false);
    assert.equal(sourceButton('Camps').enabled, true);
    toggle('camps');
    assert.equal(commands.at(-1), 'parry_trainer_setting camps 0');
    // The target is currently met and both sources were deliberately turned off.
    toggle('penalty_unparried');
    assert.ok(root.BHasClass('MissingSoulSource'));
    assert.equal(status('troopers'), 'Off');
    assert.equal(status('camps'), 'Off');
    toggle('troopers');
    assert.equal(root.BHasClass('MissingSoulSource'), false);
    assert.equal(sourceButton('Troopers').enabled, false);
    toggle('troopers');
    assert.equal(commands.at(-1), 'parry_trainer_setting troopers 1');
    toggle('penalty_unparried');
    assert.equal(sourceButton('Troopers').enabled, true);
});

test('a reloaded HUD restores the saved custom values until the next preset change', () => {
    const menu = trainerMenu('preset=100,version=2,trooper_speed=37,difficulty=21,idle_rate=32,timer=837');
    const { root, hud, status, move, commands, label } = menu;
    assert.equal(label('PresetValue'), 'Hardest · 100');
    assert.equal(label('TrooperSpeedValue'), '37%');
    assert.equal(label('IdleRateValue'), '32%');
    assert.deepEqual(['MeleeMinValue', 'MeleeMaxValue'].map(label), [0, 100].map(metres));
    assert.equal(status('death'), 'On');
    assert.deepEqual(commands, []);
    menu.apply(40);
    assert.deepEqual(['MeleeMinValue','MeleeBiasValue','MeleeMaxValue'].map(label), [60, 80, 100].map(metres));
    assert.equal(label('TrooperSpeedValue'), '42%');
    hud.ParryTrainerSetSettingsReady(root, false);
    hud.ParryTrainerRestoreSettings(root, '');
    assert.equal(label('PresetValue'), 'Normal · 50');
    assert.equal(label('LimitInput'), '5:00');
    assert.equal(label('TrooperSpeedValue'), '50%');
    assert.deepEqual(commands, ['parry_trainer_setting preset 40']);
});

test('typing stays local until submit, leaving a valid field, or an explicit step', () => {
    const { root, hud, commands } = trainerMenu();
    hud.ParryTrainerSetLimit('timer');
    const input = root.FindChildTraverse('ParryTrainerLimitInput');
    for (const raw of ['1', '1:', '1:4', '1:40', '0100']) {
        input.text = raw;
        hud.ParryTrainerEditField('timer');
        assert.equal(input.text, raw);
        assert.deepEqual(commands, ['parry_trainer_setting limit_mode timer']);
    }
    hud.ParryTrainerAdjustLimit('timer', 1);
    assert.equal(input.text, '2:10');
    hud.ParryTrainerEditField('timer'); // Native change event from formatting the step.
    hud.ParryTrainerSetLimit('goal');
    root.FindChildTraverse('ParryTrainerSoulInput').text = '7';
    hud.ParryTrainerEditField('souls');
    hud.ParryTrainerAdjustLimit('parries', -1);
    assert.deepEqual(commands, ['parry_trainer_setting limit_mode timer', 'parry_trainer_setting timer 130', 'parry_trainer_setting limit_mode goal', 'parry_trainer_setting souls 7', 'parry_trainer_setting parries 9']);
    assert.equal(hud.ParryTrainerRun.phase, 'ready');
});


test('hit limits accept completed values, lock at Begin, and stay visible on the final score', () => {
    const menu = trainerMenu();
    const { commands, root, hud, toggle } = menu;
    const label = name => root.FindChildTraverse('ParryTrainer' + name);
    toggle('fail_on_hits');
    assert.ok(root.BHasClass('HasHitLoss'));
    assert.equal(label('HitLimitInput').text, '3');
    label('HitLimitInput').text = '0';
    hud.ParryTrainerRunAction();
    assert.equal(hud.ParryTrainerRun.phase, 'ready');
    assert.match(label('LimitError').text, /1 to 9999/);
    label('HitLimitInput').text = '4';
    hud.ParryTrainerEditField('hit_limit'); hud.ParryTrainerCommitField('hit_limit');
    hud.ParryTrainerAdjustLimit('hit_limit', -1);
    hud.ParryTrainerRunAction();
    assert.deepEqual(commands, ['parry_trainer_setting fail_on_hits 1', 'parry_trainer_setting hit_limit 4', 'parry_trainer_setting hit_limit 3', 'parry_trainer_begin none']);
    menu.snapshot({ SessionPhase: 'countdown', SessionRemaining: 3, SessionHitLimit: 3,
        TrainerSettings: 'preset=50,version=2,fail_on_hits=1' });
    assert.equal(label('HudParries').text, '0/0 · 0/3 hits taken');
    assert.equal(label('HitLimitFields').enabled, false);
    assert.equal(label('HitLossChoice').enabled, false);
    const before = commands.length;
    toggle('fail_on_hits'); hud.ParryTrainerAdjustLimit('hit_limit', 1); hud.ParryTrainerEditField('hit_limit');
    assert.equal(commands.length, before);
    hud.ParryTrainerApplySession('finished', 'none', 0, 0, 1, 0, 0, 'hits', 1000);
    const stats = {SessionParries: 1, SessionHeavies: 4, SessionHits: 3, SessionHitLimit: 3};
    hud.ParryTrainerShowStats(root, id => stats[id] || 0);
    hud.ParryTrainerDrawSession(root, 1000);
    hud.ParryTrainerAdjustLimit('hit_limit', 1);
    assert.equal(label('HitLimitInput').text, '4');
    assert.equal(label('HudParries').text, '1/4 · 3/3 hits taken');
    assert.equal(label('HudCaption').text, 'Failed · Hit limit reached');
    assert.equal(label('HitLimitFields').enabled, true);
});

test('legacy inactivity saves migrate into the separate Combat drain; Reset restores the Normal template', () => {
    const menu = trainerMenu('fail_on_idle=0,fail_on_hits=1,hit_limit=7');
    assert.equal(menu.status('idle_drain'), 'Off');
    assert.equal(menu.status('fail_on_hits'), 'On');
    assert.equal(menu.label('HitLimitInput'), '7');
    assert.deepEqual(menu.commands, []);
    menu.toggle('idle_drain');
    assert.ok(menu.root.BHasClass('HasIdleDrain'));
    menu.move(34, 'IdleRate');
    assert.equal(menu.label('IdleRateValue'), '34%');
    menu.hud.ParryTrainerReset();
    menu.snapshot();
    assert.equal(menu.status('idle_drain'), 'On');
    assert.equal(menu.label('IdleRateValue'), '25%');
    assert.equal(menu.status('fail_on_hits'), 'Off');
    assert.equal(menu.root.BHasClass('HasHitLoss'), false);
});

function profileSnapshot(menu, inventory, fields = {}) {
    menu.snapshot({ ProfileList: JSON.stringify(inventory), ProfileHero: 'hero_atlas', ProfileFeedback: '',
        ProfileBusy: '0', ProfileRevision: '0', ...fields });
}

test('Saved groups builds by hero, preserves selection on polling, and confirms the exact entry', () => {
    const menu = trainerMenu();
    const { root, hud, commands } = menu;
    hud.ParryTrainerOpenTab('Character');
    hud.ParryTrainerLibrarySection('builds');
    const rows = root.FindChildTraverse('ParryTrainerProfileRows');
    const options = root.FindChildTraverse('ParryTrainerProfileOptions');
    profileSnapshot(menu, []);
    assert.equal(rows.children.length, 0);
    assert.equal(root.FindChildTraverse('ParryTrainerProfilesEmpty').visible, true);
    const a = { id: '11', name: 'Profile 1', hero: 'hero_atlas', inventory: true, abilities: true, settings: false };
    const list = [a, { ...a, id: '12', name: 'Profile 2' }, { ...a, id: '21', hero: 'hero_haze' }];
    profileSnapshot(menu, list);
    assert.deepEqual(rows.children.map(p => p.id), ['ParryTrainerProfileRow_hero_atlas', 'ParryTrainerProfileRow_hero_haze']);
    const sameRow = rows.children[0];
    profileSnapshot(menu, list);
    assert.equal(sameRow, rows.children[0]);
    sameRow.children.find(p => p.id.includes('Picker')).activate();
    assert.equal(hud.ParryTrainerProfiles.view, 'choose');
    options.children[1].activate();
    assert.equal(hud.ParryTrainerProfiles.selected.hero_atlas, '12');
    rows.children[0].children.find(p => p.id.endsWith('Delete12')).activate();
    assert.equal(hud.ParryTrainerProfiles.view, 'confirm');
    assert.deepEqual(commands, []);
    hud.ParryTrainerProfileProceed();
    assert.deepEqual(commands, ['parry_trainer_profile delete 12']);
});

test('Save build captures only selected build parts, while Save drill optionally attaches the current hero', () => {
    const menu = trainerMenu(), { hud, root, commands, label } = menu;
    profileSnapshot(menu, []);
    hud.ParryTrainerOpenTab('Character');
    hud.ParryTrainerLibrarySection('builds');
    hud.ParryTrainerProfileSaveForm();
    assert.equal(label('ProfileNewLabel'), 'Save build');
    assert.ok(root.FindChildTraverse('ParryTrainerBuildParts').visible);
    assert.equal(root.FindChildTraverse('ParryTrainerDrillBuildChoice').visible, false);
    hud.ParryTrainerProfileTogglePart(1); hud.ParryTrainerProfileTogglePart(2);
    assert.equal(root.FindChildTraverse('ParryTrainerProfileSave').enabled, false);
    hud.ParryTrainerProfileTogglePart(2);
    root.FindChildTraverse('ParryTrainerProfileNameInput').text = 'R&D; été';
    hud.ParryTrainerProfileSave();
    assert.deepEqual(commands, ['parry_trainer_profile save skills:hero_atlas R%26D%3B%20%C3%A9t%C3%A9']);
    const build = { id: '9', name: 'Lab', hero: 'hero_atlas', abilities: true, settings: false, level: 30 };
    profileSnapshot(menu, [build], { ProfileFeedback: 'Already saved as “Lab”.', ProfileSelected: '9' });
    assert.equal(hud.ParryTrainerProfiles.selected.hero_atlas, '9');
    hud.ParryTrainerOpenTab('Character');
    hud.ParryTrainerLibrarySection('drills');
    hud.ParryTrainerProfileSaveForm();
    assert.equal(label('ProfileNewLabel'), 'Save drill');
    assert.equal(hud.ParryTrainerProfiles.mask, 0);
    assert.equal(root.FindChildTraverse('ParryTrainerBuildParts').visible, false);
    assert.match(label('DrillBuildLabel'), /Abrams/);
    hud.ParryTrainerProfileTogglePart(3); hud.ParryTrainerProfileSave();
    assert.equal(commands.at(-1), 'parry_trainer_profile save drill-build:hero_atlas Drill%201');
    const combined = { ...build, id:'10', name:'Drill 1', settings:true, drill:'preset=50,version=3' };
    profileSnapshot(menu, [build, combined], { ProfileSelected:'10' });
    assert.deepEqual(root.FindChildTraverse('ParryTrainerProfileRows').children.map(p => p.id), ['ParryTrainerProfileRow_10']);
    hud.ParryTrainerOpenTab('Character');
    hud.ParryTrainerLibrarySection('builds');
    assert.deepEqual(root.FindChildTraverse('ParryTrainerProfileRows').children.map(p => p.id), ['ParryTrainerProfileRow_hero_atlas']);
});
test('builds offer to switch heroes and an attached build can be loaded or skipped', () => {
    const menu = trainerMenu(), { hud, commands, label, root } = menu;
    const build = { id:'5', hero:'hero_haze', name:'Skills', inventory:false, abilities:true, settings:false, level:22 };
    const drill = { ...build, id:'6', name:'Mixups', settings:true, drill:'preset=65,version=3,limit_mode=timer,timer=90' };
    profileSnapshot(menu, [drill, build]);
    hud.ParryTrainerOpenTab('Character');
    hud.ParryTrainerLibrarySection('builds');
    const drillOnly = root.FindChildTraverse('ParryTrainerProfileDrillOnly');
    assert.equal(root.FindChildTraverse('ParryTrainerProfileRows').children[0].children.find(r=>r.id.endsWith('Load5')).enabled, true);
    hud.ParryTrainerProfileConfirm('apply', build);
    assert.match(label('ProfileConfirmDetail'), /Switch to Haze/);
    assert.equal(drillOnly.visible, false);
    hud.ParryTrainerProfileProceed();
    assert.deepEqual(commands, ['parry_trainer_profile apply 5']);
    profileSnapshot(menu, [drill, build]);
    hud.ParryTrainerOpenTab('Character');
    hud.ParryTrainerLibrarySection('drills');
    hud.ParryTrainerProfileConfirm('apply', drill);
    assert.match(label('ProfileConfirmDetail'), /Switch to Haze/);
    assert.equal(label('ProfileConfirmLabel'), 'Load drill and build');
    assert.equal(drillOnly.visible, true);
    assert.equal(hud.ParryTrainerProfileSummary(drill), '1:30 timer · 1 opponent · Template 65 · Haze build');
    hud.ParryTrainerProfileProceed();
    assert.equal(commands.at(-1), 'parry_trainer_profile apply 6');
    profileSnapshot(menu, [drill, build]);
    hud.ParryTrainerProfileConfirm('apply', drill);
    hud.ParryTrainerProfileProceed(true);
    assert.equal(commands.at(-1), 'parry_trainer_profile drill-only 6');
    profileSnapshot(menu, [drill, build], { ProfileHero:'hero_haze' });
    hud.ParryTrainerProfileConfirm('apply', drill);
    assert.match(label('ProfileConfirmDetail'), /load Haze’s level and abilities/);
    hud.ParryTrainerProfileProceed();
    assert.equal(commands.at(-1), 'parry_trainer_profile apply 6');
});
test('Overwrite confirms a named drill or build, preserving an attached build on a different hero', () => {
    const menu = trainerMenu(), { hud, commands, label, root } = menu;
    const build = { id:'3', hero:'hero_haze', name:'Night kit', inventory:true, abilities:false, settings:false };
    const combined = { ...build, id:'4', name:'Footwork', settings:true, drill:'preset=75,version=4' };
    const plain = { ...combined, id:'7', name:'Warmup', hero:'', inventory:false };
    const list = [build, combined, plain];
    const entries = () => root.FindChildTraverse('ParryTrainerProfileRows').children.flatMap(row => row.children);
    const button = id => entries().find(entry => entry.id.endsWith('Overwrite' + id));
    profileSnapshot(menu, list);
    hud.ParryTrainerOpenTab('Character');
    button('7').activate();
    assert.equal(label('ProfileConfirmTitle'), 'Overwrite “Warmup”?');
    assert.equal(label('ProfileConfirmLabel'), 'Overwrite');
    hud.ParryTrainerProfileOverview();
    assert.deepEqual(commands, []);
    button('4').activate();
    assert.match(label('ProfileConfirmDetail'), /Keep the attached Haze build/);
    hud.ParryTrainerProfileProceed();
    assert.deepEqual(commands, ['parry_trainer_profile overwrite-drill-only 4']);
    profileSnapshot(menu, list);
    hud.ParryTrainerLibrarySection('builds');
    assert.equal(button('3').enabled, false);
    profileSnapshot(menu, list, { ProfileHero:'hero_haze' });
    button('3').activate();
    assert.match(label('ProfileConfirmDetail'), /Haze’s current inventory/);
    profileSnapshot(menu, list, { ProfileHero:'hero_atlas' });
    assert.equal(hud.ParryTrainerProfiles.view, 'main');
    hud.ParryTrainerProfileProceed();
    assert.equal(commands.length, 1);
    profileSnapshot(menu, list, { ProfileHero:'hero_haze' });
    button('3').activate();
    hud.ParryTrainerProfileProceed();
    assert.equal(commands.at(-1), 'parry_trainer_profile overwrite 3');
    profileSnapshot(menu, list, { ProfileHero:'hero_haze' });
    hud.ParryTrainerLibrarySection('drills');
    button('4').activate();
    assert.match(label('ProfileConfirmDetail'), /update Haze’s saved inventory/);
    hud.ParryTrainerProfileProceed();
    assert.equal(commands.at(-1), 'parry_trainer_profile overwrite 4');
});
test('a drill can be saved during a session and importing a backup waits for the host to restore settings', () => {
    const menu = trainerMenu(), { hud, commands, label, root } = menu;
    profileSnapshot(menu, [], { SessionPhase: 'running' });
    hud.ParryTrainerProfileSend('apply', '11'); hud.ParryTrainerProfileConfirm('import');
    assert.deepEqual(commands, []);
    hud.ParryTrainerProfileSaveForm(); hud.ParryTrainerProfileSave();
    assert.deepEqual(commands, ['parry_trainer_profile save drill Drill%201']);
    profileSnapshot(menu, []);
    menu.move(64, 'TrooperSpeed');
    hud.ParryTrainerProfileConfirm('import'); hud.ParryTrainerProfileOverview();
    assert.equal(commands.length, 1);
    hud.ParryTrainerProfileConfirm('import'); hud.ParryTrainerProfileProceed();
    assert.deepEqual(commands, ['parry_trainer_profile save drill Drill%201', 'parry_trainer_setting trooper_speed 64', 'parry_trainer_profile import confirm']);
    profileSnapshot(menu, [], { ProfileBusy: '1' });
    assert.equal(root.FindChildTraverse('ParryTrainerBegin').enabled, false);
    profileSnapshot(menu, [], { ProfileRevision: '1', TrainerSettings: 'preset=81,version=2' });
    assert.equal(root.FindChildTraverse('ParryTrainerBegin').enabled, true);
    assert.equal(label('TrooperSpeedValue'), '81%');
    menu.snapshot({ TrainerSettings: 'preset=23,version=2' });
    assert.equal(label('TrooperSpeedValue'), '81%');
});

test('native hero changes update Saved and clear a stale build form without prompting', () => {
    const menu = trainerMenu(), { hud, label, commands } = menu;
    profileSnapshot(menu, []);
    hud.ParryTrainerOpenTab('Character');
    hud.ParryTrainerLibrarySection('builds');
    hud.ParryTrainerProfileSaveForm();
    profileSnapshot(menu, [], { ProfileHero: 'hero_haze' });
    assert.equal(label('ProfileHero'), 'Haze');
    assert.equal(hud.ParryTrainerProfiles.view, 'main');
    assert.deepEqual(commands, []);
});

test('one collapsed save notice explains only a confirmed error and waits for retry acknowledgement', () => {
    const menu = trainerMenu(), { hud, root, label, commands } = menu;
    const notice = root.FindChildTraverse('ParryTrainerSaveNotice');
    const css = fs.readFileSync(path.join(__dirname, 'controls.css'), 'utf8');
    assert.match(css, /\.PTSaveNotice\s*\{[^}]*visibility:\s*collapse/);
    menu.snapshot();
    assert.equal(notice.BHasClass('SaveFailed'), false);
    hud.ParryTrainerRetrySave();
    assert.deepEqual(commands, []);

    menu.snapshot({ SettingsSaveError: 'write' });
    assert.ok(notice.BHasClass('SaveFailed') && notice.BHasClass('CanRetry'));
    assert.match(label('SaveNoticeText'), /could not be saved for next time/);
    hud.ParryTrainerRetrySave(); hud.ParryTrainerRetrySave();
    assert.deepEqual(commands, ['parry_trainer_setting retry_save 1']);
    assert.equal(label('RetrySaveLabel'), 'Saving…');
    menu.snapshot({ SettingsSaveError: 'write' });
    assert.equal(label('RetrySaveLabel'), 'Save settings again');
    hud.ParryTrainerRetrySave(); menu.snapshot();
    assert.equal(notice.BHasClass('SaveFailed'), false);
    menu.snapshot({ SettingsSaveError: 'damaged' });
    assert.ok(notice.BHasClass('SaveFailed'));
    assert.equal(notice.BHasClass('CanRetry'), false);
    assert.match(label('SaveNoticeText'), /Saved → Backups/);
    hud.ParryTrainerRetrySave();
    assert.deepEqual(commands, ['parry_trainer_setting retry_save 1', 'parry_trainer_setting retry_save 1']);
});

test('a damaged on-disk library still permits importing a backup and exporting an empty healthy library', () => {
    const menu = trainerMenu(), { hud, commands } = menu;
    profileSnapshot(menu, [], { ProfileList: '', ProfileFeedback: 'Import a backup to recover.' });
    hud.ParryTrainerProfileConfirm('import');
    assert.equal(hud.ParryTrainerProfiles.view, 'confirm');
    hud.ParryTrainerProfileProceed();
    profileSnapshot(menu, []);
    hud.ParryTrainerProfileConfirm('export'); hud.ParryTrainerProfileProceed();
    assert.deepEqual(commands, ['parry_trainer_profile import confirm', 'parry_trainer_profile export']);
});

test('a blocked net-soul goal links to a source before Begin and returns to the same rules', () => {
    const { hud, root, commands, label, toggle } = trainerMenu();
    let focused;
    for (const page of ['Setup', 'Creeps']) root.FindChildTraverse('ParryTrainerNav' + page).SetFocus = () => { focused = page; };
    hud.ParryTrainerOpenTab('Setup');
    hud.ParryTrainerSetLimit('goal');
    hud.ParryTrainerAdjustLimit('souls', 1);
    assert.ok(root.BHasClass('MissingSoulSource'));
    assert.ok(root.FindChildTraverse('ParryTrainerNavSetup').BHasClass('Selected'));
    hud.ParryTrainerRunAction();
    assert.ok(root.BHasClass('OnSetup'));
    assert.match(label('LimitError'), /Creeps/);
    hud.ParryTrainerChooseSoulSource(); toggle('troopers');
    assert.equal(focused, 'Creeps');
    assert.ok(root.BHasClass('ChoosingSoulSource'));
    assert.equal(root.BHasClass('MissingSoulSource'), false);
    hud.ParryTrainerOpenTab('Setup');
    assert.equal(focused, 'Setup');
    assert.equal(root.BHasClass('ChoosingSoulSource'), false);
    assert.equal(label('SoulInput'), '1');
    hud.ParryTrainerRunAction();
    assert.equal(commands.at(-1), 'parry_trainer_begin goal 10 1');
});

test('waiting for a spawned hero explains why Begin is blocked, then clears on recovery', () => {
    const { hud, root, commands, snapshot, label } = trainerMenu();
    snapshot({StartUnavailable: 'Waiting for your hero to spawn.'});
    hud.ParryTrainerRunAction();
    assert.ok(root.BHasClass('OnSetup'));
    assert.match(label('StartError'), /spawn/);
    assert.deepEqual(commands, []);
    snapshot(); hud.ParryTrainerRunAction();
    assert.equal(commands.at(-1), 'parry_trainer_begin none');
});

test('one global Reset restores settings on the current tab and keeps the session score', () => {
    const { hud, root, commands, label, snapshot } = trainerMenu('preset=75,version=3');
    const live = { SessionRun: 9, SessionPhase: 'running', SessionHits: 2, SessionParries: 3 };
    snapshot(live);
    hud.ParryTrainerPage('Score'); hud.ParryTrainerReset(); hud.ParryTrainerReset();
    assert.deepEqual(commands, ['parry_trainer_reset']);
    snapshot({ ...live, TrainerSettings: 'preset=50,version=3' });
    assert.ok(root.BHasClass('OnScore'));
    assert.equal(label('ScoreParries'), '3');
    assert.equal(label('ScoreHits'), '2');
    assert.equal(label('ResetLabel'), 'Restored');
    const xml = fs.readFileSync(path.join(__dirname, 'panel.xml'), 'utf8');
    assert.equal((xml.match(/onactivate="ParryTrainerReset\(\)"/g) || []).length, 1);
    assert.doesNotMatch(xml, /ProfileChangeHero|Switch hero|KeepBuild|ResetPart/);
});

test('a declined Begin leaves an actionable message and permits retry', () => {
    const { hud, root, label, commands, snapshot } = trainerMenu();
    snapshot(); hud.ParryTrainerRunAction(); snapshot();
    assert.ok(root.BHasClass('OnSetup'));
    assert.match(label('StartError'), /Try Begin session again/);
    hud.ParryTrainerRunAction(); snapshot({ SessionRun: 1, SessionPhase: 'countdown' });
    assert.deepEqual(commands, ['parry_trainer_begin none', 'parry_trainer_begin none']);
    assert.equal(label('StartError'), '');
});

test('native arrows navigate focused tabs and release keyboard ownership when the menu closes', () => {
    const { root, hud } = trainerMenu();
    const xml = fs.readFileSync(path.join(__dirname, 'panel.xml'), 'utf8');
    const nav = [...xml.matchAll(/<Button id="(ParryTrainerNav\w+)" class="PTNav"[^>]*><Label text="([^"]+)"/g)];
    const buttons = nav.map(([, id]) => root.FindChildTraverse(id));
    assert.deepEqual(nav.map(([, , label]) => label), ['Session', 'My hero', 'Opponents', 'Creeps', 'Saved', 'Templates', 'Score']);
    const scale = xml.match(/id="ParryTrainerPresetControl"[\s\S]*?ParryTrainerDifficultyEnds">([\s\S]*?)<\/Panel>/)[1];
    assert.deepEqual([...scale.matchAll(/<Label text="([^"]+)"/g)].map(([, value]) => value), ['Easiest', 'Normal', 'Hardest']);
    assert.match(xml, /id="ParryTrainerPresetApply"[^>]*>\s*<Label text="Apply"/);
    assert.doesNotMatch(xml, /id="ParryTrainerPresetDiscard"/);
    let focused = '', drops = 0;
    for (const button of buttons) {
        button.BHasKeyFocus = () => focused === button.id;
        button.SetFocus = () => { focused = button.id; };
        button.SetPanelEvent = (event, callback) => { button[event] = callback; };
    }
    root.FindChildrenWithClassTraverse = () => buttons;
    root.BHasDescendantKeyFocus = () => focused.startsWith('ParryTrainer');
    const chat = { IsValid: () => true, BHasKeyFocus: () => focused === 'ChatInput' };
    const parent = root.GetParent();
    root.GetParent = () => ({ FindChildTraverse: id => id === 'ChatInput' ? chat : parent.FindChildTraverse(id) });
    hud.$.DispatchEvent = event => { assert.equal(event, 'DropInputFocus'); drops++; focused = ''; };
    hud.ParryTrainerRecap = null;
    const update = hud.ParryTrainerBindNavKeys(root);
    root.SetHasClass('PTMenuLatched', true);
    hud.ParryTrainerPage('Setup');
    update(true, false);
    assert.equal(focused, buttons[0].id);
    buttons[0].onmoveright();
    assert.equal(focused, buttons[1].id);
    assert.ok(root.BHasClass('OnHero'));
    hud.ParryTrainerOpenTab('Score'); // Mouse activation moves keyboard focus off the old tab.
    assert.equal(focused, buttons.at(-1).id);
    assert.ok(root.BHasClass('OnScore'));
    buttons.at(-1).onmoveleft();
    assert.ok(root.BHasClass('OnPresets'));
    assert.equal(focused, buttons.at(-2).id);
    buttons.at(-2).onmoveright();
    assert.equal(focused, buttons.at(-1).id);
    root.SetHasClass('PTMenuLatched', false);
    buttons.at(-1).onmoveright();
    assert.ok(root.BHasClass('OnScore'));
    update(false, true);
    assert.equal(focused, '');
    assert.equal(drops, 1);
    root.SetHasClass('PTMenuLatched', true);
    for (const overlay of ['gShopOpen', 'gEditingBuilds', 'gItemDraftOpen', 'InspectingLoadout']) {
        root.SetHasClass(overlay, true);
        update(true, false);
        assert.equal(focused, '');
        root.SetHasClass(overlay, false);
    }
    hud.ParryTrainerProfiles.view = 'save';
    update(true, false);
    assert.equal(focused, '');
    hud.ParryTrainerProfiles.view = 'main';
    hud.ParryTrainerRecap = { id: 'recap' };
    update(true, false);
    assert.equal(focused, '');
    hud.ParryTrainerRecap = null;
    for (const textEntry of ['ParryTrainerParryInput', 'ChatInput']) {
        focused = textEntry;
        update(true, false);
        assert.equal(focused, textEntry);
    }
    update(false, true);
    assert.equal(focused, 'ChatInput');
    assert.equal(drops, 1);
});

test('incomplete timer editing can be abandoned without replacing the accepted interval', () => {
    const { hud, root, commands, label } = trainerMenu();
    hud.ParryTrainerPage('Setup'); hud.ParryTrainerSetLimit('timer');
    const timer = root.FindChildTraverse('ParryTrainerLimitInput');
    timer.text = '1:45'; hud.ParryTrainerEditField('timer'); hud.ParryTrainerCommitField('timer');
    timer.text = '2:'; hud.ParryTrainerEditField('timer'); hud.ParryTrainerRunAction();
    assert.match(label('LimitError'), /Enter/);
    hud.ParryTrainerPage('Combat');
    assert.equal(label('LimitInput'), '1:45');
    assert.deepEqual(commands, ['parry_trainer_setting limit_mode timer', 'parry_trainer_setting timer 105']);
});

test('the packaged menu uses Modlock score replies through Begin, confirmation and the final recap', () => {
    const { hud, root, commands, label, results } = trainerMenu(null);
    const routes = new Map();
    let unload, restored = 0;
    hud.Modlock = { route: (name, cb) => routes.set(name, cb), onUnload: cb => { unload = cb; } };
    hud.ParryTrainerGuardRetailHud = () => () => { restored++; };
    hud.ParryTrainerNativeBackupInitialize = () => {};
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../native/hud.js'), 'utf8'), hud);
    hud.ParryTrainerNativeInitialize(root, root.GetParent());
    const score = routes.get('score');
    const report = (seq, fields = {}) => score({ SessionPhase: 'ready', SessionMode: 'none',
        SessionRun: 0, TrainerSettings: 'preset=50,version=2', ScoreSequence: seq, ...fields });
    hud.ParryTrainerPollScore(root, false);
    const loading = hud.ParryTrainerScore.pending;
    report(loading, { StorageLoading: 1, StartUnavailable: 'Loading your trainer settings…' });
    assert.equal(hud.ParryTrainerSettingsReady, false);
    assert.equal(hud.ParryTrainerStartBlock, 'Loading your trainer settings…');
    hud.ParryTrainerScore.next = 0;
    hud.ParryTrainerPollScore(root, false);
    const initial = hud.ParryTrainerScore.pending;
    report(initial, { TrainerSettings: 'preset=72,version=2' });
    assert.equal(hud.ParryTrainerPreset.preset, 72);
    assert.equal(hud.ParryTrainerSettingsReady, true);
    hud.ParryTrainerRunAction();
    assert.ok(commands.includes('parry_trainer_begin none'));
    report(initial);
    assert.equal(hud.ParryTrainerSettingsReady, false);
    hud.ParryTrainerPollScore(root, false);
    report(hud.ParryTrainerScore.pending, { SessionPhase: 'countdown', SessionRun: 1, SessionRemaining: 3 });
    assert.equal(hud.ParryTrainerRun.phase, 'countdown');
    hud.ParryTrainerScore.next = 0;
    hud.ParryTrainerPollScore(root, false);
    report(hud.ParryTrainerScore.pending, { SessionPhase: 'finished', SessionEndReason: 'goal',
        SessionHeavies: 4, SessionParries: 3, SessionRun: 1 });
    assert.equal(label('ScoreParries'), '3');
    assert.deepEqual(results, ['victory']);
    hud.ParryTrainerOpenTab('Character');
    hud.ParryTrainerPollScore(root, true);
    assert.match(commands.at(-1), /^parry_trainer_score [0-9]+ profiles$/);
    report(hud.ParryTrainerScore.pending, { SessionPhase: 'finished', SessionRun: 1, ProfileList: '[]', ProfileHero: 'hero_atlas' });
    assert.equal(hud.ParryTrainerProfiles.hero, 'hero_atlas');
    assert.equal(label('ScoreParries'), '3');
    unload();
    assert.equal(restored, 1);
});

test('native HUD restores stock markers and leaves player parry feedback alone', () => {
    const hud = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../native/retail-hud.js'), 'utf8'), hud);
    const panel = () => ({ style: {}, IsValid: () => true });
    const units = panel(), badge = { ...panel(), BHasClass: c => c === 'Stunned' };
    const player = { ...panel(), BHasClass: () => false };
    const indicators = { ...panel(), Children: () => [badge, player] };
    const damage = panel();
    damage.style.visibility = 'visible';
    const lookup = { unit_indicators_v2: units, HudEventIndicatorsPanel: indicators, damage_impact: damage };
    const game = { ...panel(), FindChildTraverse: id => lookup[id] };
    let tick, canceled, enabled = new Set();
    hud.$ = { Schedule: (_, cb) => { tick = cb; return 1; }, CancelScheduled: id => { canceled = id; } };
    hud.ParryTrainerIsActive = () => true;
    hud.ParryTrainerPreset = { get: key => enabled.has(key) };
    const restore = hud.ParryTrainerGuardRetailHud(game);
    assert.equal(damage.style.visibility, 'collapse');
    assert.equal(units.style.visibility, 'collapse');
    assert.equal(badge.style.visibility, 'collapse');
    assert.equal(player.style.visibility, undefined);
    enabled = new Set(['parried', 'troopers']);
    tick();
    assert.equal(badge.style.visibility, null);
    assert.equal(units.style.visibility, null);
    restore();
    assert.equal(damage.style.visibility, 'visible');
    assert.equal(canceled, 1);
});

test('an offline account disables library writes while Begin, Reset and account reconnect stay available', () => {
    const menu = trainerMenu(null), { hud, root, commands } = menu;
    hud.ParryTrainerOpenTab('Character');
    menu.snapshot({ SettingsSaveError: 'offline', ProfileBusy: 0, ProfileList: '' });
    assert.equal(root.FindChildTraverse('ParryTrainerProfileNew').enabled, false);
    assert.equal(root.FindChildTraverse('ParryTrainerProfileImport').enabled, false);
    assert.match(menu.label('ProfilesEmpty'), /Account library unavailable/);
    assert.equal(root.FindChildTraverse('ParryTrainerReset').enabled, true);
    assert.equal(root.FindChildTraverse('ParryTrainerBegin').enabled, true);
    assert.equal(menu.label('RetrySaveLabel'), 'Reconnect account');
    hud.ParryTrainerRetrySave();
    assert.ok(commands.includes('parry_trainer_setting retry_save 1'));
    menu.snapshot({ SettingsSaveError: 'capacity', ProfileBusy: 0, ProfileList: '[]' });
    assert.equal(root.FindChildTraverse('ParryTrainerSaveNotice').BHasClass('CanRetry'), false);
    assert.match(menu.label('SaveNoticeText'), /library is full/);
    menu.snapshot({ ProfileBusy: 0, ProfileList: '[]' });
    assert.equal(root.FindChildTraverse('ParryTrainerSaveNotice').BHasClass('SaveFailed'), false);
    assert.equal(root.FindChildTraverse('ParryTrainerProfileNew').enabled, true);
    menu.snapshot({ SettingsSavePending: 1 });
    assert.equal(menu.label('Phase'), 'Saving to your account…');
    menu.snapshot();
    assert.equal(menu.label('Phase'), '');
});
