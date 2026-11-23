// These native indicators have their own layout and style scope.
function ParryTrainerInitStatusImpact() {
    var indicator = $.GetContextPanel();
    for (var parent = indicator.GetParent(); parent; parent = parent.GetParent()) {
        if (parent.id === 'HudEventIndicatorsPanel') {
            indicator.SetHasClass('ParryTrainerHideStun', !parent.BHasClass('ParryTrainerShowStun'));
            return;
        }
    }
}
