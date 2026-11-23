// The template preview is local to its page. Individual sliders edit the live drill.
var ParryTrainerPreset = createPresetSettings();
var ParryTrainerSliders = {
    preset: { id: 'ParryTrainerPreset', min: 0, max: 100 },
    trooper_speed: { id: 'ParryTrainerTrooperSpeed', min: 10, max: 100 },
    idle_rate: { id: 'ParryTrainerIdleRate', min: 15, max: 50 }
};
function ParryTrainerRangeControl(prefix, panel, format) {
    return { id: 'ParryTrainer' + panel, min: prefix + '_min', bias: prefix + '_bias', max: prefix + '_max',
        selected: prefix + '_min', width: 0, format: format };
}
var ParryTrainerRanges = [
    ParryTrainerRangeControl('melee', 'Melee', ParryTrainerDistanceText),
    ParryTrainerRangeControl('interval', 'Interval', meleeRange.formatSeconds)
];
var ParryTrainerHandles = {};
ParryTrainerRanges.forEach(function (range) {
    ['min', 'bias', 'max'].forEach(function (part) {
        ParryTrainerHandles[range[part]] = { range: range, id: range.id + part.charAt(0).toUpperCase() + part.slice(1) };
    });
});
var ParryTrainerRingNames = { melee_min: 'min', melee_bias: 'favored', melee_max: 'max' };
var ParryTrainerRangePreview;
var ParryTrainerRangeCommand = '', ParryTrainerRangeSent = 0;
var ParryTrainerDrawingMelee = false;
var ParryTrainerPendingSlider;
var ParryTrainerDraftLevel;
var ParryTrainerPendingPreset;
var ParryTrainerAppliedFeedback = '';
var ParryTrainerPreviewSignature = '';

function ParryTrainerFlushSlider() {
    if (!ParryTrainerPendingSlider) return;
    $.CancelScheduled(ParryTrainerPendingSlider.timer);
    $.DispatchEvent('CitadelConCommand', ParryTrainerPendingSlider.command);
    ParryTrainerPendingSlider = undefined;
}

function ParryTrainerSend(command) {
    ParryTrainerFlushSlider();
    $.DispatchEvent('CitadelConCommand', command);
}

function ParryTrainerPreviewLevel() {
    return ParryTrainerDraftLevel === undefined ? ParryTrainerPreset.preset : ParryTrainerDraftLevel;
}

function ParryTrainerSetSlider(root, key, value) {
    if (!ParryTrainerSettingsReady) return;
    if (key === 'preset') {
        if (!root.BHasClass('OnPresets') || ParryTrainerIsActive() || ParryTrainerPreviewLevel() === value) return;
        ParryTrainerDiscardPreset(root);
        if (value !== ParryTrainerPreset.preset) ParryTrainerDraftLevel = value;
        ParryTrainerDrawPresetHint(root);
        return;
    }
    var previous = ParryTrainerPreset.get(key);
    if (previous === value || !ParryTrainerPreset.setPreference(key, value)) return;
    value = ParryTrainerPreset.get(key);
    if (value === previous) return;
    if (ParryTrainerPendingSlider && ParryTrainerPendingSlider.key !== key) ParryTrainerFlushSlider();
    if (ParryTrainerPendingSlider) $.CancelScheduled(ParryTrainerPendingSlider.timer);
    ParryTrainerPendingSlider = {
        key: key, command: 'parry_trainer_setting ' + key + ' ' + value, timer: $.Schedule(0.12, ParryTrainerFlushSlider)
    };
    ParryTrainerDrawPreset(root);
}

function ParryTrainerBindSliders(root) {
    Object.keys(ParryTrainerSliders).forEach(function (key) {
        var spec = ParryTrainerSliders[key];
        var slider = root.FindChildTraverse(spec.id);
        slider.SetPanelEvent('onvaluechanged', function () {
            var position = Math.max(0, Math.min(1, slider.value));
            ParryTrainerSetSlider(root, key, spec.min + Math.round(position * (spec.max - spec.min)));
        });
    });
    ParryTrainerRanges.forEach(function (range) { ParryTrainerBindRange(root, range); });
}

function ParryTrainerBindRange(root, range) {
    [range.min, range.bias, range.max].forEach(function (key) {
        var slider = root.FindChildTraverse(ParryTrainerHandles[key].id);
        slider.SetPanelEvent('onvaluechanged', function () {
            // Discard late mouse motion from a hidden or interrupted native slider.
            if (ParryTrainerDrawingMelee || !slider.IsValid() || key !== range.selected || !ParryTrainerCanPreviewRange(root)) return;
            var min = ParryTrainerPreset.get(range.min), max = ParryTrainerPreset.get(range.max);
            var pos = Math.max(0, Math.min(100, slider.value * 100));
            var value = key === range.bias ? (max > min ? (pos - min) * 100 / (max - min) : ParryTrainerPreset.get(key))
                : key === range.min ? Math.min(max, pos) : Math.max(min, pos);
            value = Math.round(Math.max(0, Math.min(100, value)));
            if (ParryTrainerPreset.get(key) !== value) {
                ParryTrainerSetSlider(root, key, value);
                if ((!ParryTrainerRangePreview || ParryTrainerRangePreview.until) && ParryTrainerRangeHeld(slider))
                    ParryTrainerBeginRangePreview(root, key, false);
            } else ParryTrainerDrawRange(root, range); // Snap a thumb dragged past an unchanged bound.
        });
        // Only the selected native slider handles rail clicks; the other two expose their thumbs.
        ['SliderTrack', 'SliderTrackProgress', 'SliderDefault'].forEach(function (id) { slider.FindChildTraverse(id).hittest = false; });
        var thumb = slider.FindChildTraverse('SliderThumb');
        thumb.hittest = true;
        thumb.SetPanelEvent('onmouseover', function () { ParryTrainerSelectMelee(key, true); });
        // Native release can precede the final :active layout by one frame.
        $.RegisterEventHandler('SliderReleased', slider, function () {
            if (ParryTrainerRangePreview && ParryTrainerRangePreview.key === key) ParryTrainerRangePreview.released = true;
            if (!ParryTrainerRangeHeld(slider)) ParryTrainerEndRangePreview(root, key);
        });
    });
}

function ParryTrainerSetSliderPosition(root, key, value) {
    var spec = ParryTrainerSliders[key], slider = root.FindChildTraverse(spec.id);
    if (spec.min + Math.round(slider.value * (spec.max - spec.min)) !== value)
        slider.value = (value - spec.min) / (spec.max - spec.min);
}

function ParryTrainerStepPreset(direction) {
    var value = Math.max(0, Math.min(100, ParryTrainerPreviewLevel() + direction));
    ParryTrainerSetSlider(ParryTrainerRoot(), 'preset', value);
}

// A preview and permission to begin here belong to this visit to the tab.
function ParryTrainerDiscardPreset(root) {
    ParryTrainerDraftLevel = undefined;
    ParryTrainerPendingPreset = undefined;
    ParryTrainerAppliedFeedback = '';
    ParryTrainerPreviewSignature = '';
    root.SetHasClass('TemplateApplied', false);
}

function ParryTrainerLevelName(position) {
    var name = position === 0 ? 'Easiest' : position === 100 ? 'Hardest' : position === 50 ? 'Normal' : position < 50 ? 'Easier' : 'Harder';
    return name + ' · ' + position;
}

function ParryTrainerCurrentChoices() {
    return { hero1: ParryTrainerOpponents[1], hero2: ParryTrainerOpponents[2], limit_mode: ParryTrainerLimit.mode,
        timer: String(ParryTrainerLimit.timer), parries: String(ParryTrainerLimit.parries), souls: String(ParryTrainerLimit.souls) };
}

function ParryTrainerChoiceChanges() {
    var current = ParryTrainerCurrentChoices();
    return Object.keys(drillDefaults).filter(function (key) { return current[key] !== drillDefaults[key]; });
}

function ParryTrainerPresetChanges(values) {
    return presetSettingKeys.filter(function (key) { return values[key] !== ParryTrainerPreset.get(key); }).concat(ParryTrainerChoiceChanges());
}

function ParryTrainerApplyPreset() {
    var root = ParryTrainerRoot();
    if (!root.BHasClass('OnPresets') || !ParryTrainerSettingsReady || ParryTrainerIsActive()) return;
    var level = ParryTrainerPreviewLevel();
    if (level === ParryTrainerPreset.preset) return;
    ParryTrainerPendingPreset = { level: level, count: ParryTrainerPresetChanges(presetValues(level)).length };
    ParryTrainerAppliedFeedback = '';
    ParryTrainerRequestRunChange(root, 'parry_trainer_setting preset ' + level);
    ParryTrainerDrawPresetHint(root);
}

// Called only after the server's configuration snapshot has been restored.
function ParryTrainerConfirmPreset(root) {
    var applied = ParryTrainerPendingPreset;
    ParryTrainerDiscardPreset(root);
    if (!applied) return;
    var confirmed = ParryTrainerPreset.preset === applied.level && !ParryTrainerPresetChanges(presetValues(applied.level)).length;
    root.SetHasClass('TemplateApplied', confirmed);
    if (!confirmed) ParryTrainerDraftLevel = applied.level;
    ParryTrainerAppliedFeedback = confirmed
        ? 'Applied ' + ParryTrainerLevelName(applied.level) + '.' + (applied.count ? ' ' + applied.count + (applied.count === 1 ? ' setting changed.' : ' settings changed.') : '')
        : 'Template was not applied.';
}

function ParryTrainerDistanceText(percent) {
    return meleeRange.formatUnits(meleeRange.units(percent));
}

function ParryTrainerCanPreviewRange(root) {
    return ParryTrainerSettingsReady && root.BHasClass('OnCombat') && ParryTrainerMenuVisible(root) &&
        !ParryTrainerPicking && !ParryTrainerRecap && !root.BHasClass('gShopOpen') && !root.BHasClass('InspectingLoadout') &&
        !root.BHasClass('gEditingBuilds') && !root.BHasClass('gItemDraftOpen');
}

// Panorama's native Slider captures the mouse before a panel onmousedown.
// Its stock :active selector persists through a held press. The invisible
// track fills the rail vertically only in that state (independent of UI scale).
function ParryTrainerRangeHeld(slider) {
    return slider.actuallayoutheight > 0 &&
        slider.FindChildTraverse('SliderTrack').actuallayoutheight > slider.actuallayoutheight / 2;
}

function ParryTrainerCheckRangeHold(root) {
    if ((ParryTrainerRangePreview && !ParryTrainerRangePreview.until) || !ParryTrainerCanPreviewRange(root)) return;
    ParryTrainerRanges.some(function (range) {
        if (!ParryTrainerRangeHeld(root.FindChildTraverse(ParryTrainerHandles[range.selected].id))) return false;
        ParryTrainerBeginRangePreview(root, range.selected, false);
        return true;
    });
}

function ParryTrainerWatchRangeLayout(root, open) {
    var visible = open && root.BHasClass('OnCombat');
    ParryTrainerRanges.forEach(function (range) {
        var width = visible ? root.FindChildTraverse(ParryTrainerHandles[range.min].id).actuallayoutwidth : 0;
        if (width && width !== range.width) ParryTrainerDrawRange(root, range, true);
        range.width = width;
    });
    if (visible) ParryTrainerCheckRangeHold(root);
}

function ParryTrainerMarkRange(root, key, active) {
    if (!ParryTrainerRingNames[key]) return;
    var id = ParryTrainerHandles[key].id;
    root.FindChildTraverse(id).SetHasClass('PTActiveRing', active);
    root.FindChildTraverse(id + 'Choice').SetHasClass('PTActiveRing', active);
    root.SetHasClass('PTRangePreview', active);
}

// The drag and the game's detail-view key share one set of world rings.
function ParryTrainerPublishRange(mode) {
    var command = mode ? ['parry_trainer_range_preview', mode, ParryTrainerPreset.get('melee_min'),
        ParryTrainerPreset.get('melee_max'), ParryTrainerPreset.get('melee_bias')].join(' ') : '';
    var now = Date.now();
    if (command === ParryTrainerRangeCommand && (!command || now - ParryTrainerRangeSent < 400)) return;
    $.DispatchEvent('CitadelConCommand', command || 'parry_trainer_range_preview off');
    ParryTrainerRangeCommand = command;
    ParryTrainerRangeSent = now;
}

function ParryTrainerWatchRangeInspect(root) {
    if (ParryTrainerRangePreview && ParryTrainerRingNames[ParryTrainerRangePreview.key]) return;
    var inspecting = ParryTrainerSettingsReady && root.BHasClass('gDetailView') && !ParryTrainerIsActive() &&
        !ParryTrainerRecap && !root.BHasClass('gShopOpen') && !root.BHasClass('gEditingBuilds') && !root.BHasClass('gItemDraftOpen');
    ParryTrainerPublishRange(inspecting ? 'inspect' : '');
}

function ParryTrainerEndRangePreview(root, key) {
    var preview = ParryTrainerRangePreview;
    if (!preview || (key && key !== preview.key)) return;
    ParryTrainerRangePreview = undefined;
    if (preview.timer !== undefined) $.CancelScheduled(preview.timer);
    ParryTrainerMarkRange(root, preview.key, false);
    ParryTrainerWatchRangeInspect(root);
}

function ParryTrainerInterruptRangePreview(root) {
    var preview = ParryTrainerRangePreview;
    if (!preview) return;
    ParryTrainerEndRangePreview(root);
    if (preview.until || preview.released) return;
    // The game can route mouse-up to the world after the menu disappears.
    // Destroy the native owner of that interrupted capture before reopening.
    var range = ParryTrainerHandles[preview.key].range;
    var inputs = root.FindChildTraverse(range.id + 'Inputs');
    ParryTrainerDrawingMelee = true;
    inputs.RemoveAndDeleteChildren();
    inputs.BLoadLayoutSnippet(range.id + 'InputLayout');
    ParryTrainerBindRange(root, range);
    ParryTrainerDrawingMelee = false;
    range.width = 0;
}

function ParryTrainerBeginRangePreview(root, key, keyboard) {
    if (!ParryTrainerCanPreviewRange(root)) return;
    var range = ParryTrainerHandles[key].range;
    if (key === range.bias && ParryTrainerPreset.get(range.min) === ParryTrainerPreset.get(range.max)) return;
    if (ParryTrainerRangePreview && ParryTrainerRangePreview.key !== key) ParryTrainerEndRangePreview(root);
    if (keyboard && !ParryTrainerRingNames[key]) return;
    var until = keyboard ? Date.now() + 700 : 0;
    if (ParryTrainerRangePreview) {
        ParryTrainerRangePreview.until = until;
        return;
    }
    var preview = ParryTrainerRangePreview = { key: key, until: until };
    ParryTrainerMarkRange(root, key, true);
    // Send live values independently of the debounced settings save. Holding
    // a handle still renews the host preview, which also expires on HUD loss.
    function update() {
        if (preview !== ParryTrainerRangePreview) return;
        preview.timer = undefined;
        if (!root.IsValid()) {
            ParryTrainerRangePreview = undefined;
            return;
        }
        var now = Date.now();
        var slider = root.FindChildTraverse(ParryTrainerHandles[preview.key].id);
        if (!ParryTrainerCanPreviewRange(root)) {
            ParryTrainerInterruptRangePreview(root);
            return;
        }
        if (preview.until ? now >= preview.until : !ParryTrainerRangeHeld(slider)) {
            ParryTrainerEndRangePreview(root);
            return;
        }
        if (ParryTrainerRingNames[preview.key]) ParryTrainerPublishRange(ParryTrainerRingNames[preview.key]);
        preview.timer = $.Schedule(0.04, update);
    }
    update();
}

function ParryTrainerSelectMelee(key, fromThumb) {
    var handle = ParryTrainerHandles[key], range = handle.range;
    if (!ParryTrainerSettingsReady || (key === range.bias && ParryTrainerPreset.get(range.min) === ParryTrainerPreset.get(range.max))) return;
    if (fromThumb && ParryTrainerRangePreview && !ParryTrainerRangePreview.until && key !== ParryTrainerRangePreview.key) return;
    var root = ParryTrainerRoot();
    if (!fromThumb) root.FindChildTraverse(handle.id + 'Choice').SetFocus();
    if (range.selected === key) return;
    range.selected = key;
    ParryTrainerDrawRange(root, range);
}

function ParryTrainerStepMelee(key, direction) {
    var range = ParryTrainerHandles[key].range;
    ParryTrainerSelectMelee(key);
    if (key === range.bias && ParryTrainerPreset.get(range.min) === ParryTrainerPreset.get(range.max)) return;
    var root = ParryTrainerRoot();
    // Migrated waits may start between ticks. A keypress selects the next tick in that direction.
    var current = ParryTrainerPreset.get(key);
    var next = direction > 0 ? Math.floor(current) + 1 : Math.ceil(current) - 1;
    ParryTrainerSetSlider(root, key, Math.max(0, Math.min(100, next)));
    ParryTrainerBeginRangePreview(root, key, true);
}

function ParryTrainerDrawRange(root, range, relayout) {
    var min = ParryTrainerPreset.get(range.min), max = ParryTrainerPreset.get(range.max);
    var positions = {};
    positions[range.min] = min;
    positions[range.bias] = meleeRange.favored(min, max, ParryTrainerPreset.get(range.bias));
    positions[range.max] = max;
    if (min === max && range.selected === range.bias) range.selected = range.min;
    var width = root.FindChildTraverse(range.id + 'Rail').actuallayoutwidth;
    root.FindChildTraverse(range.id + 'Before').style.width = min + '%';
    root.FindChildTraverse(range.id + 'Band').style.width = (max - min) + '%';
    ParryTrainerDrawingMelee = true;
    Object.keys(positions).forEach(function (key) {
        var id = ParryTrainerHandles[key].id, slider = root.FindChildTraverse(id);
        var selected = key === range.selected, available = key !== range.bias || min !== max;
        var choice = root.FindChildTraverse(id + 'Choice');
        choice.SetHasClass('PTMeleeEditing', selected);
        choice.enabled = available;
        slider.SetHasClass('PTMeleeEditing', selected);
        slider.enabled = available;
        slider.SetHasClass('PTMeleeFixed', !available);
        slider.hittest = selected;
        // Prioritize the selected handle where two hit areas overlap. The
        // three labeled choices can select either endpoint even at zero width.
        slider.hittestchildren = !selected && available && Math.abs(positions[key] - positions[range.selected]) > 3;
        ParryTrainerText(root, id + 'Value', range.format(positions[key]));
        // Panorama skips an equal value assignment. On the first visible frame
        // force it to calculate the thumb position using the real rail width.
        if (width !== 0) {
            var position = positions[key] / 100;
            if (relayout) slider.value = position < 0.5 ? 1 : 0;
            if (Math.abs(slider.value - position) > 0.00001) slider.value = position;
        }
    });
    ParryTrainerDrawingMelee = false;
}

function ParryTrainerTier(value) { return ['I', 'II', 'III'][value - 1]; }

function ParryTrainerPenaltyNames(val) {
    var penalties = [];
    if (val('penalty_hit')) penalties.push('Hit');
    if (val('penalty_unparried')) penalties.push('Unparried');
    if (val('penalty_whiff')) penalties.push('Empty parry');
    return penalties;
}

function ParryTrainerDrawPreset(root) {
    var val = ParryTrainerPreset.get;
    Object.keys(ParryTrainerToggles).forEach(function (key) { ParryTrainerShowToggle(root, key); });
    ['trooper_speed', 'idle_rate'].forEach(function (key) { ParryTrainerSetSliderPosition(root, key, val(key)); });
    ParryTrainerRanges.forEach(function (range) { ParryTrainerDrawRange(root, range); });
    ParryTrainerText(root, 'ParryTrainerIdleRateValue', val('idle_rate') + '%');
    ParryTrainerText(root, 'ParryTrainerTrooperSpeedValue', val('trooper_speed') + '%');
    ParryTrainerText(root, 'ParryTrainerTrooperCount', String(val('trooper_count')));
    ParryTrainerText(root, 'ParryTrainerCampTier', ParryTrainerTier(val('camp_tier')));
    ParryTrainerDrawField(root, 'hit_limit');
    root.FindChildTraverse('ParryTrainerTrooperSettings').visible = val('troopers');
    root.FindChildTraverse('ParryTrainerCampSettings').visible = val('camps');
    root.FindChildTraverse('ParryTrainerTrooperSpeedControl').visible = val('troopers') && val('trooper_active');
    ParryTrainerPreviewSignature = '';
    ParryTrainerDrawPresetHint(root);
}

function ParryTrainerDrawPresetHint(root) {
    var active = ParryTrainerIsActive(), editing = root.BHasClass('OnPresets') && !active;
    var level = editing ? ParryTrainerPreviewLevel() : ParryTrainerPreset.preset;
    var signature = [editing, active, level, ParryTrainerSettingsReady].join(',');
    if (signature === ParryTrainerPreviewSignature) return;
    ParryTrainerPreviewSignature = signature;
    var previewing = editing && level !== ParryTrainerPreset.preset;
    var values = previewing ? presetValues(level) : undefined;
    var changed = previewing ? ParryTrainerPresetChanges(values) : [];
    var val = previewing ? function (key) { return values[key]; } : ParryTrainerPreset.get;
    var choices = previewing ? drillDefaults : ParryTrainerCurrentChoices();
    root.FindChildTraverse('ParryTrainerPreviewIdentity').visible = previewing;
    function summary(name, text, keys) {
        var id = 'ParryTrainerSummary' + name;
        ParryTrainerText(root, id, text);
        root.FindChildTraverse(id).SetHasClass('PTPreviewChanged', keys.some(function (key) { return changed.indexOf(key) >= 0; }));
    }
    function toggle(name, key) { summary(name, val(key) ? 'On' : 'Off', [key]); }
    ParryTrainerSetSliderPosition(root, 'preset', level);
    var custom = ParryTrainerPreset.customized() || ParryTrainerChoiceChanges().length > 0;
    ParryTrainerText(root, 'ParryTrainerPresetActive', 'Active  ' + ParryTrainerLevelName(ParryTrainerPreset.preset) + (custom ? ' · Custom' : ''));
    ParryTrainerText(root, 'ParryTrainerPresetValue', ParryTrainerLevelName(level));
    function rangeSummary(range, bounds, favored) {
        var min = val(range.min), max = val(range.max);
        summary(bounds, min === max ? range.format(min) + ' fixed' : range.format(min) + ' – ' + range.format(max), [range.min, range.max]);
        root.FindChildTraverse('ParryTrainerSummary' + favored + 'Row').visible = min !== max;
        summary(favored, range.format(meleeRange.favored(min, max, val(range.bias))), [range.min, range.max, range.bias]);
    }
    rangeSummary(ParryTrainerRanges[0], 'Distance', 'Favored');
    rangeSummary(ParryTrainerRanges[1], 'Interval', 'FavoredInterval');
    summary('Opponents', val('second') ? '2' : '1', ['second']);
    var opponentPicks = ParryTrainerHeroes[choices.hero1] || choices.hero1;
    if (val('second')) opponentPicks = choices.hero1 === 'random' && choices.hero2 === 'random' ? 'Both random'
        : opponentPicks + ' / ' + (ParryTrainerHeroes[choices.hero2] || choices.hero2);
    summary('OpponentPicks', opponentPicks, ['hero1', 'hero2']);
    toggle('Effects', 'effects');
    toggle('Parried', 'parried');
    toggle('Cooldown', 'cooldown');
    toggle('Stamina', 'stamina');
    toggle('Death', 'death');
    summary('IdleDrain', val('idle_drain') ? val('idle_rate') + '% HP / sec' : 'Off', ['idle_drain', 'idle_rate']);
    var chasing = val('troopers') && val('trooper_active');
    root.FindChildTraverse('ParryTrainerSummarySpeedRow').visible = chasing;
    summary('Troopers', val('troopers') ? val('trooper_count') + (chasing ? ' · Chase & attack' : ' · Stationary') : 'Off',
        ['troopers', 'trooper_count', 'trooper_active']);
    summary('Speed', val('trooper_speed') + '%', ['trooper_speed']);
    summary('Camps', val('camps') ? 'Tier ' + ParryTrainerTier(val('camp_tier')) + (val('camp_reactive') ? ' · Retaliate' : ' · Stationary') : 'Off',
        ['camps', 'camp_tier', 'camp_reactive']);
    summary('Finish', { none: 'Unlimited', goal: 'Goals', timer: 'Timer' }[choices.limit_mode], ['limit_mode']);
    var showTimer = choices.limit_mode === 'timer' || changed.indexOf('timer') >= 0;
    var showGoals = choices.limit_mode === 'goal' || changed.indexOf('parries') >= 0 || changed.indexOf('souls') >= 0;
    root.FindChildTraverse('ParryTrainerSummaryTimerRow').visible = showTimer;
    root.FindChildTraverse('ParryTrainerSummaryGoalsRow').visible = showGoals;
    summary('Timer', ParryTrainerFormatTime(Number(choices.timer)), ['timer']);
    summary('Goals', choices.parries + (choices.parries === '1' ? ' parry' : ' parries') + ' · ' +
        choices.souls + (choices.souls === '1' ? ' soul' : ' souls'), ['parries', 'souls']);
    toggle('DeathRule', 'fail_on_death');
    summary('HitRule', val('fail_on_hits') ? String(val('hit_limit')) + (val('hit_limit') === 1 ? ' hit' : ' hits') : 'Off',
        ['fail_on_hits', 'hit_limit']);
    summary('SoulPenalties', ParryTrainerPenaltyNames(val).join(' · ') || 'Off', soulPenaltyKeys);
    var unlocked = !active && ParryTrainerSettingsReady;
    root.FindChildTraverse('ParryTrainerPreset').enabled = unlocked;
    root.FindChildTraverse('ParryTrainerPresetMinus').enabled = unlocked && level > 0;
    root.FindChildTraverse('ParryTrainerPresetPlus').enabled = unlocked && level < 100;
    var apply = root.FindChildTraverse('ParryTrainerPresetApply');
    apply.enabled = unlocked && previewing;
    apply.hittest = apply.enabled;
    var feedback = ParryTrainerPendingPreset ? 'Applying template…' : ParryTrainerAppliedFeedback;
    ParryTrainerText(root, 'ParryTrainerDifficultyFeedback', feedback);
    root.FindChildTraverse('ParryTrainerDifficultyFeedback').visible = Boolean(feedback);
    var hint = active ? 'End the session to apply a template.' : 'Move the slider to preview a built-in template.';
    if (previewing) hint = changed.length ? 'Apply replaces your trainer settings (' + changed.length + (changed.length === 1 ? ' change).' : ' changes).')
        : 'Apply to use this template.';
    ParryTrainerText(root, 'ParryTrainerPresetHint', hint);
    root.FindChildTraverse('ParryTrainerPresetHint').visible = !feedback || previewing;
}
