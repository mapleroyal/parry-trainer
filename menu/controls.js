var ParryTrainerToggles = {
    cooldown: 'ParryTrainerCooldown', second: 'ParryTrainerSecond',
    stamina: 'ParryTrainerStamina', effects: 'ParryTrainerEffects', parried: 'ParryTrainerParried',
    death: 'ParryTrainerDeath', fail_on_death: 'ParryTrainerDeathOutcome', fail_on_hits: 'ParryTrainerHitLoss',
    penalty_hit: 'ParryTrainerPenaltyHit', penalty_unparried: 'ParryTrainerPenaltyUnparried', penalty_whiff: 'ParryTrainerPenaltyWhiff',
    idle_drain: 'ParryTrainerIdleDrain',
    troopers: 'ParryTrainerTroopers', camps: 'ParryTrainerCamps',
    trooper_active: 'ParryTrainerTrooperMode', camp_reactive: 'ParryTrainerCampMode'
};
// Playable heroes from this build's heroes.vdata, in display order.
var ParryTrainerHeroes = {
    "random": "Random",
    "hero_atlas": "Abrams",
    "hero_fencer": "Apollo",
    "hero_baba": "Baba",
    "hero_bebop": "Bebop",
    "hero_punkgoat": "Billy",
    "hero_nano": "Calico",
    "hero_unicorn": "Celeste",
    "hero_deadpack": "Deadman Danny",
    "hero_drifter": "Drifter",
    "hero_dynamo": "Dynamo",
    "hero_necro": "Graves",
    "hero_orion": "Grey Talon",
    "hero_haze": "Haze",
    "hero_astro": "Holliday",
    "hero_inferno": "Infernus",
    "hero_tengu": "Ivy",
    "hero_kelvin": "Kelvin",
    "hero_ghost": "Lady Geist",
    "hero_lash": "Lash",
    "hero_forge": "McGinnis",
    "hero_vampirebat": "Mina",
    "hero_mirage": "Mirage",
    "hero_krill": "Mo & Krill",
    "hero_nurse": "Nurse Harrow",
    "hero_bookworm": "Paige",
    "hero_chrono": "Paradox",
    "hero_synth": "Pocket",
    "hero_ratking": "Rat King",
    "hero_familiar": "Rem",
    "hero_gigawatt": "Seven",
    "hero_shiv": "Shiv",
    "hero_werewolf": "Silver",
    "hero_magician": "Sinclair",
    "hero_chessmaster": "Solomon",
    "hero_doorman": "The Doorman",
    "hero_priest": "Venator",
    "hero_frank": "Victor",
    "hero_hornet": "Vindicta",
    "hero_artist": "Violet",
    "hero_viscous": "Viscous",
    "hero_viper": "Vyper",
    "hero_warden": "Warden",
    "hero_wraith": "Wraith",
    "hero_yamato": "Yamato",
};
var ParryTrainerOpponents = { 1: drillDefaults.hero1, 2: drillDefaults.hero2 };
var ParryTrainerPicking = 0;

function ParryTrainerRoot() {
    var panel = $.GetContextPanel();
    while (panel && panel.id !== 'ParryTrainerControls') {
        var controls = panel.FindChildTraverse('ParryTrainerControls');
        if (controls) return controls;
        panel = panel.GetParent();
    }
    return panel;
}

// The standalone panel is a HUD child. A packaged layout has Modlock containers in between.
function ParryTrainerGameHud(controls) {
    var parent = controls.GetParent();
    for (var panel = parent; panel && panel.GetParent; panel = panel.GetParent()) {
        if (panel.paneltype === 'CitadelHud') return panel;
    }
    return parent;
}

function ParryTrainerOpenTab(name) {
    var root = ParryTrainerRoot();
    root.FindChildTraverse('ParryTrainerNav' + name).SetFocus();
    ParryTrainerPage(name);
}

// The scoreboard action still belongs to Deadlock, including custom bindings.
function ParryTrainerMenuVisible(root) {
    return ParryTrainerIsActive() ? root.BHasClass('gScoreboardOpen') && !root.BHasClass('PTMenuDismissed')
        : root.BHasClass('PTMenuLatched');
}

function ParryTrainerLatchMenu(root, open) {
    if (root.BHasClass('PTMenuLatched') === open) return;
    root.SetHasClass('PTMenuLatched', open);
    // Keep the real HUD cursor available for clicks and text entry after key-up.
    $.DispatchEvent('CitadelConCommand', 'hud_free_cursor ' + (open ? '1' : '0'));
}

function ParryTrainerBindScoreboard(root) {
    $.RegisterForUnhandledEvent('CitadelScoreboardToggle', function (pressed) {
        if (!root.IsValid()) return;
        if (!pressed) root.SetHasClass('PTMenuDismissed', false);
        if (pressed && !ParryTrainerIsActive() && !ParryTrainerRecap &&
            !root.BHasClass('gShopOpen') && !root.BHasClass('gEditingBuilds') && !root.BHasClass('gItemDraftOpen'))
            ParryTrainerLatchMenu(root, !root.BHasClass('PTMenuLatched'));
    });
}

function ParryTrainerDismissMenu() {
    var root = ParryTrainerRoot();
    if (!ParryTrainerMenuVisible(root)) return;
    if (ParryTrainerIsActive()) root.SetHasClass('PTMenuDismissed', true);
    ParryTrainerLatchMenu(root, false);
    if (ParryTrainerProfiles.view !== 'main') ParryTrainerProfileOverview();
}

// The retail HUD maps physical arrows to MoveLeft/MoveRight on the focused panel.
// Scope them to the tab strip so text editors and the native HUD keep their keys.
function ParryTrainerBindNavKeys(root) {
    var buttons = root.FindChildrenWithClassTraverse('PTNav');
    var chat = ParryTrainerGameHud(root).FindChildTraverse('ChatInput');
    function available() {
        return !ParryTrainerPicking && !ParryTrainerRecap && ParryTrainerProfiles.view === 'main' &&
            !root.BHasClass('InspectingLoadout') &&
            !root.BHasClass('gShopOpen') && !root.BHasClass('gEditingBuilds') && !root.BHasClass('gItemDraftOpen');
    }
    buttons.forEach(function (button, index) {
        function move(direction) {
            if (!ParryTrainerMenuVisible(root) || !button.BHasKeyFocus() || !available()) return;
            var next = buttons[(index + buttons.length + direction) % buttons.length];
            ParryTrainerOpenTab(next.id.slice('ParryTrainerNav'.length));
        }
        button.SetPanelEvent('onmoveleft', function () { move(-1); });
        button.SetPanelEvent('onmoveright', function () { move(1); });
    });
    return function (open, wasOpen) {
        if (!open) {
            // A hidden Panorama button can otherwise keep consuming Enter in-game.
            if (wasOpen && root.BHasDescendantKeyFocus()) $.DispatchEvent('DropInputFocus');
        } else if (!available()) {
            if (buttons.some(function (button) { return button.BHasKeyFocus(); })) $.DispatchEvent('DropInputFocus');
        } else if (!wasOpen && !root.BHasDescendantKeyFocus() && !(chat && chat.IsValid() && chat.BHasKeyFocus())) {
            var selected = buttons.find(function (button) { return button.BHasClass('Selected'); });
            if (selected) selected.SetFocus();
        }
    };
}

function ParryTrainerBindDrainWarning(controls, nativeMode) {
    var nativeBox = ParryTrainerGameHud(controls).FindChildTraverse('cast_failed_box');
    if (!nativeBox) return;
    // Separate layout scope lets both warnings use Deadlock's stock IDs and styles.
    var host = nativeMode ? controls.FindChildTraverse('ParryTrainerDrainWarning') :
        $.CreatePanel('Panel', nativeBox.GetParent(), 'ParryTrainerDrainWarning');
    if (!host.BLoadLayout('file://{resources}/layout/parry_trainer_drain_warning.xml', false, false)) return;
    var box = host.FindChildTraverse('cast_failed_box');
    var draining = false;
    function draw() {
        if (box.IsValid()) box.SetHasClass('cast_failed', draining && !nativeBox.BHasClass('cast_failed'));
    }
    $.RegisterEventHandler('StyleClassesChanged', nativeBox, draw);
    if (nativeMode) {
        Modlock.route('draining', function (active) { draining = active === true; draw(); });
        return;
    }
    $.RegisterForUnhandledEvent('PlaySoundEffect', function (signal) {
        if (signal !== 'ParryTrainer.DrainOn' && signal !== 'ParryTrainer.DrainOff') return;
        draining = signal === 'ParryTrainer.DrainOn';
        draw();
    });
}

function ParryTrainerWatchMenu(nativeMode) {
    var controls = ParryTrainerRoot();
    if (!controls) return;
    ParryTrainerProfiles = ParryTrainerNewProfiles();
    ParryTrainerSetSettingsReady(controls, false);
    ParryTrainerInvalidateScore();
    ParryTrainerBindSliders(controls);
    ParryTrainerBindScoreboard(controls);
    ParryTrainerBindDrainWarning(controls, nativeMode);
    var focusTabs = ParryTrainerBindNavKeys(controls);
    ParryTrainerDrawSettings(controls);
    ParryTrainerPage('Setup');
    controls.FindChildTraverse('ParryTrainerCountdown').BLoadLayout('file://{resources}/layout/parry_trainer_countdown.xml', false, false);
    controls.FindChildTraverse('ParryTrainerResultHost').BLoadLayout('file://{resources}/layout/parry_trainer_result.xml', false, false);
    // The native Tab skill/item tooltips share the middle of the screen with setup.
    var gameHud = ParryTrainerGameHud(controls);
    var nativeControls = ['hud_signature', 'ActiveAbilitiesMenu', 'ModsContainer'].map(function (id) {
        return gameHud.FindChildTraverse(id);
    });
    var wasOpen = false;
    if (nativeMode) ParryTrainerNativeInitialize(controls, gameHud);
    function watch() {
        if (!controls.IsValid()) return;
        if (controls.BHasClass('gShopOpen')) ParryTrainerLatchMenu(controls, false);
        // After clicking the world, Escape reaches the native HUD directly,
        // bypassing the focused menu's Cancelled event.
        if (wasOpen && ParryTrainerMenuVisible(controls) && gameHud.BHasClass('ShowEscapeMenu')) {
            ParryTrainerDismissMenu();
            $.DispatchEvent('CitadelConCommand', 'gameui_hide');
        }
        var open = ParryTrainerMenuVisible(controls) && !controls.BHasClass('gShopOpen');
        controls.SetHasClass('InspectingLoadout', open && nativeControls.some(function (p) {
            return p && p.IsValid() && p.BHasHoverStyle();
        }));
        if (open && ParryTrainerInputDraft && ParryTrainerInputHadFocus) {
            var input = controls.FindChildTraverse(ParryTrainerFieldIds[ParryTrainerInputDraft]);
            if (!input.BHasKeyFocus() && !input.BHasDescendantKeyFocus()) {
                ParryTrainerInputHadFocus = false;
                ParryTrainerCommitField(ParryTrainerInputDraft);
            }
        }
        ParryTrainerWatchRangeLayout(controls, open);
        ParryTrainerWatchRangeInspect(controls);
        ParryTrainerPollScore(controls, open);
        if (!open && wasOpen) {
            ParryTrainerLeaveRules();
            ParryTrainerDiscardPreset(controls);
            ParryTrainerFlushSlider();
            ParryTrainerClosePicker();
        }
        focusTabs(open, wasOpen);
        wasOpen = open;
        ParryTrainerDrawSession(controls, Date.now());
        $.Schedule(0.1, watch);
    }
    watch();
}

function ParryTrainerShowToggle(root, setting) {
    var enabled = ParryTrainerPreset.get(setting);
    var value = enabled ? 'On' : 'Off';
    if (setting === 'idle_drain') root.SetHasClass('HasIdleDrain', enabled);
    if (setting === 'fail_on_death') {
        var hint = root.FindChildTraverse('ParryTrainerDeathHint');
        hint.visible = enabled;
        if (enabled) {
            var causes = [];
            if (ParryTrainerPreset.get('death')) causes.push('enemy attacks');
            if (ParryTrainerPreset.get('idle_drain')) causes.push('standing-still damage');
            hint.text = causes.length ? 'Any death ends this session, including death from ' + causes.join(' and ') + '.'
                : 'Any death ends this session. Both lethal enemy damage and standing-still drain are off in My hero.';
        }
    }
    if (setting === 'fail_on_hits') root.SetHasClass('HasHitLoss', enabled);
    if (setting === 'trooper_active') value = enabled ? 'Chase & attack' : 'Stationary';
    if (setting === 'camp_reactive') value = enabled ? 'Retaliate' : 'Stationary';
    if (setting === 'second') root.SetHasClass('ParryTrainerHasSecond', enabled);
    if (setting === 'parried') ParryTrainerSetStunVisibility(root, enabled);
    root.FindChildTraverse(ParryTrainerToggles[setting]).text = value;
}

function ParryTrainerSetStunVisibility(controls, enabled) {
    if (typeof ParryTrainerNativeInitialize === 'function') return; // Native indicator layout stays with Deadlock.
    var indicators = ParryTrainerGameHud(controls).FindChildTraverse('HudEventIndicatorsPanel');
    if (!indicators) return;
    indicators.SetHasClass('ParryTrainerShowStun', enabled);
    for (var i = 0; i < indicators.GetChildCount(); i++) {
        var child = indicators.GetChild(i);
        if (child.BHasClass('ParryTrainerStatusImpact')) child.SetHasClass('ParryTrainerHideStun', !enabled);
    }
}

function ParryTrainerNeedsSoulSource() {
    return ParryTrainerIsActive() && ParryTrainerRun.mode === 'goal' &&
        needsSoulSource(ParryTrainerRun.soulGoal, ParryTrainerRun.souls, ParryTrainerPreset.get);
}

function ParryTrainerDrawSourceLock(root) {
    var needed = ParryTrainerNeedsSoulSource();
    var troopers = ParryTrainerPreset.get('troopers'), camps = ParryTrainerPreset.get('camps');
    var required = needed && soleSoulSource(troopers, camps);
    root.SetHasClass('LastSoulSource', Boolean(required));
    var plannedSouls = ParryTrainerInputDraft === 'souls' ? ParryTrainerReadLimit('souls', root.FindChildTraverse('ParryTrainerSoulInput').text) : ParryTrainerLimit.souls;
    var planned = !ParryTrainerIsActive() && ParryTrainerLimit.mode === 'goal' && plannedSouls > 0;
    root.SetHasClass('MissingSoulSource', (needed || planned) && !troopers && !camps);
    root.FindChildTraverse('ParryTrainerTroopersChoice').enabled = required !== 'troopers';
    root.FindChildTraverse('ParryTrainerCampsChoice').enabled = required !== 'camps';
}

function ParryTrainerToggle(setting) {
    var label = ParryTrainerToggles[setting];
    if (!label || !ParryTrainerSettingsReady) return;
    if (ParryTrainerNeedsSoulSource() && setting === soleSoulSource(ParryTrainerPreset.get('troopers'), ParryTrainerPreset.get('camps'))) return;
    if (setting === 'fail_on_hits' && ParryTrainerIsActive()) return;
    var root = ParryTrainerRoot();
    ParryTrainerLeaveRules();
    var enabled = !ParryTrainerPreset.get(setting);
    ParryTrainerPreset.setPreference(setting, enabled);
    ParryTrainerSend('parry_trainer_setting ' + setting + (enabled ? ' 1' : ' 0'));
    ParryTrainerDrawPreset(root);
    ParryTrainerDrawSourceLock(root);
    if (enabled && (setting === 'troopers' || setting === 'camps')) root.FindChildTraverse('ParryTrainerLimitError').text = '';
}

function ParryTrainerClosePicker() {
    ParryTrainerPicking = 0;
    var root = ParryTrainerRoot();
    root.SetHasClass('ParryTrainerPicking', false);
}

function ParryTrainerPickHero(slot) {
    if (!ParryTrainerSettingsReady || (slot !== 1 && slot !== 2)) return;
    var root = ParryTrainerRoot();
    var grid = root.FindChildTraverse('ParryTrainerRoster');
    if (grid.GetChildCount() === 0) {
        var row;
        Object.keys(ParryTrainerHeroes).forEach(function (hero, index) {
            if (index % 4 === 0) {
                row = $.CreatePanel('Panel', grid, '');
                row.AddClass('ParryTrainerHeroRow');
            }
            var option = $.CreatePanel('Button', row, 'ParryTrainerPick_' + hero, { acceptsfocus: 'true' });
            option.AddClass('ParryTrainerHeroOption');
            var title = $.CreatePanel('Label', option, '');
            title.text = ParryTrainerHeroes[hero];
            option.SetPanelEvent('onactivate', function () { ParryTrainerChooseHero(hero); });
        });
    }
    Object.keys(ParryTrainerHeroes).forEach(function (hero) {
        grid.FindChildTraverse('ParryTrainerPick_' + hero).SetHasClass('SelectedHero', hero === ParryTrainerOpponents[slot]);
    });
    ParryTrainerPicking = slot;
    root.FindChildTraverse('ParryTrainerPickerTitle').text = 'Opponent ' + slot + ' hero';
    root.SetHasClass('ParryTrainerPicking', true);
}

function ParryTrainerChooseHero(hero) {
    var slot = ParryTrainerPicking;
    if ((slot !== 1 && slot !== 2) || !ParryTrainerHeroes[hero]) return;
    ParryTrainerOpponents[slot] = hero;
    ParryTrainerRoot().FindChildTraverse('ParryTrainerHero' + slot).text = ParryTrainerHeroes[hero] + ' ›';
    ParryTrainerSend('parry_trainer_setting hero' + slot + ' ' + hero);
    ParryTrainerClosePicker();
}
