var ParryTrainerResultExpiry = null;
var ParryTrainerRecap = null;

function ParryTrainerHideWipe(controls) {
    ParryTrainerStopResultAudio();
    if (!controls.IsValid()) return;
    var host = controls.FindChildTraverse('ParryTrainerResultHost');
    if (!host) return;
    host.visible = false;
    var visual = host.FindChildTraverse('ParryTrainerResultVisual');
    if (visual) visual.SetHasClass('MatchFinished', false);
}

function ParryTrainerClearResult(controls) {
    if (ParryTrainerResultExpiry !== null) {
        $.CancelScheduled(ParryTrainerResultExpiry);
        ParryTrainerResultExpiry = null;
    }
    ParryTrainerHideWipe(controls);
    var recap = ParryTrainerRecap;
    if (recap && recap.panel && recap.panel.IsValid()) $.DispatchEvent('UIPopupButtonClicked', recap.panel);
    ParryTrainerRecap = null;
    ParryTrainerScore.followResult = false;
}

function ParryTrainerUpdateRecap(controls) {
    var recap = ParryTrainerRecap;
    if (!recap || ParryTrainerResultExpiry !== null) return;
    if (recap.panel) {
        if (!recap.panel.IsValid()) {
            ParryTrainerRecap = null;
            ParryTrainerScore.followResult = false;
        }
        return;
    }
    if (!ParryTrainerSettingsReady || controls.BHasClass('gShopOpen') || controls.BHasClass('gEditingBuilds') || controls.BHasClass('gItemDraftOpen')) return;
    // The stock popup manager owns the cursor, input capture and Escape behavior.
    var root = controls;
    while (root.GetParent()) root = root.GetParent();
    var manager = root.FindChildTraverse('PopupManager');
    if (!manager) return;
    if (!recap.requested) {
        if (manager.Children().some(function (p) { return p.paneltype.indexOf('Popup') === 0; })) return;
        recap.requested = true;
        $.DispatchEvent('UIShowCustomLayoutPopup', recap.id, 'file://{resources}/layout/parry_trainer_summary.xml');
    }
    var panel = manager.FindChildTraverse(recap.id);
    if (panel && panel.FindChildTraverse('ParryTrainerScoreStatus')) {
        ParryTrainerRenderScore(panel, recap.values);
        recap.panel = panel;
    }
}

function ParryTrainerShowResult(controls, outcome, values, runId) {
    if (outcome !== 'victory' && outcome !== 'defeat') return;
    if (ParryTrainerResultExpiry !== null || ParryTrainerRecap) ParryTrainerClearResult(controls);
    var host = controls.FindChildTraverse('ParryTrainerResultHost');
    var visual = host && host.FindChildTraverse('ParryTrainerResultVisual');
    var won = outcome === 'victory';
    // The trainer seats the trainee on Amber. The retail HUD styles its wipe by winning team.
    if (visual) {
        visual.SetHasClass('Team1Victory', won);
        visual.SetHasClass('Team2Victory', !won);
        visual.FindChildTraverse('ParryTrainerVictoryLabel').visible = won;
        visual.FindChildTraverse('ParryTrainerDefeatLabel').visible = !won;
        visual.SetHasClass('MatchFinished', true);
        host.visible = true;
    }
    ParryTrainerRecap = { id: 'ParryTrainerRunSummary' + runId, values: values, panel: null, requested: false };
    ParryTrainerScore.followResult = true;
    ParryTrainerResultExpiry = $.Schedule(1.9, function () {
        ParryTrainerResultExpiry = null;
        ParryTrainerHideWipe(controls);
        if (controls.IsValid()) ParryTrainerUpdateRecap(controls);
    });
    ParryTrainerPlayResultAudio(won);
}
