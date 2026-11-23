// Modlock owns the standard HUD parts (top bar, minimap, etc.). These are
// additional retail panels covered by the reference trainer's HUD stylesheet.
// Brief inline overrides are restored when waves/settings change or the layout unloads.
function ParryTrainerGuardRetailHud(game) {
    var changed = new Map(), previousRefresh = -Infinity;
    var ids = ['damage_indicator_offscreen_enemy', 'DataFeed', 'friendly_final_objective_container',
        'enemy_final_objective_container', 'objectives_health_friendly', 'objectives_health_enemy',
        'hintsPanel', 'HudExperimentsContainer', 'damage_impact', 'CitadelHudDamageReport', 'hud_hero_testing'];
    var panels = [], units, indicators, announcements, timer;

    function restore(panel, original) {
        if (panel.IsValid() && panel.style.visibility === 'collapse') panel.style.visibility = original;
    }
    function refresh() {
        if (!game.IsValid()) return;
        if (Date.now() - previousRefresh >= 1000) {
            previousRefresh = Date.now();
            panels = ids.map(function (id) { return game.FindChildTraverse(id); });
            var gameplay = game.FindChildTraverse('gameplay_hud');
            if (gameplay) panels = panels.concat(gameplay.FindChildrenWithClassTraverse('action_upgrade'));
            units = game.FindChildTraverse('unit_indicators_v2');
            indicators = game.FindChildTraverse('HudEventIndicatorsPanel');
            announcements = game.FindChildTraverse('ToastManager');
        }
        var hidden = new Set(panels);
        if (!ParryTrainerIsActive() || !(ParryTrainerPreset.get('troopers') || ParryTrainerPreset.get('camps'))) hidden.add(units);
        if (indicators && indicators.IsValid() && !ParryTrainerPreset.get('parried')) {
            indicators.Children().forEach(function (impact) {
                if (impact.BHasClass('Stunned')) hidden.add(impact);
            });
        }
        if (announcements && announcements.IsValid()) {
            announcements.Children().forEach(function (toast) {
                if (toast.paneltype === 'CitadelFlexUnlockMessage') hidden.add(toast);
            });
        }
        changed.forEach(function (original, panel) {
            if (!panel.IsValid() || !hidden.has(panel)) {
                restore(panel, original);
                changed.delete(panel);
            }
        });
        hidden.forEach(function (panel) {
            if (!panel || !panel.IsValid()) return;
            var visibility = panel.style.visibility;
            if (!changed.has(panel) || visibility !== 'collapse') changed.set(panel, visibility || null);
            if (visibility !== 'collapse') panel.style.visibility = 'collapse';
        });
        timer = $.Schedule(0.1, refresh);
    }
    refresh();
    return function () {
        if (timer !== undefined) $.CancelScheduled(timer);
        changed.forEach(function (original, panel) { restore(panel, original); });
        changed.clear();
    };
}
