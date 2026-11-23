function ParryTrainerInitDrainSignal() {
    var panel = $.GetContextPanel();
    var previous;
    function publish() {
        var visible = panel.BHasClass('ParryTrainerDrainActive');
        if (visible === previous) return;
        previous = visible;
        // Modlock uses this global Panorama event for messages between layout scopes.
        $.DispatchEvent('PlaySoundEffect', visible ? 'ParryTrainer.DrainOn' : 'ParryTrainer.DrainOff');
    }
    $.RegisterEventHandler('StyleClassesChanged', panel, publish);
    publish();
}
