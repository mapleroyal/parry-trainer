// Panorama caches missing layouts as well as successful loads. Give a slow
// bridge a fresh path and more time on its next request.
var ParryTrainerScore = { next: 0, pending: 0, requested: 0, lastToken: 0, appliedThrough: 0, retry: false, retryAfter: 2500, synced: false };

function ParryTrainerInvalidateScore() {
    ParryTrainerScore.appliedThrough = Math.max(ParryTrainerScore.appliedThrough, ParryTrainerScore.lastToken);
    ParryTrainerScore.next = 0;
    ParryTrainerScore.pending = 0;
    ParryTrainerScore.synced = false;
    ParryTrainerScore.retry = false;
    ParryTrainerScore.retryAfter = 2500;
}

function ParryTrainerLoadScore(controls, token, stamp) {
    var sequence = parseInt(token, 10);
    if (sequence <= ParryTrainerScore.appliedThrough) return true;
    var loader = $.CreatePanel('Panel', controls, 'ParryTrainerScoreLoader');
    loader.visible = false;
    try {
        if (!loader.BLoadLayout('file://{resources}/layout/parry_trainer_score/score_' + token + '.xml', false, false)) return false;
        function field(id) {
            var label = loader.FindChildTraverse(id);
            return label ? label.text : '';
        }
        return ParryTrainerApplyScoreFields(controls, sequence, stamp, field);
    } finally {
        loader.DeleteAsync(0);
    }
}

function ParryTrainerPollScore(controls, open) {
    var state = ParryTrainerScore;
    if (state.followResult) ParryTrainerUpdateRecap(controls);
    var now = Date.now();
    if (state.pending) {
        if (now - state.requested < (state.retry ? state.retryAfter : 400)) return;
        var path = state.pending + (state.retry ? '_retry' : '');
        var loaded = ParryTrainerLoadScore(controls, path, state.requested);
        if (!loaded && !state.retry) { state.retry = true; return; }
        state.pending = 0;
        if (loaded) {
            state.synced = true;
            if (!state.retry) state.retryAfter = 2500;
        } else {
            state.synced = false;
            state.retryAfter = Math.min(30000, state.retryAfter * 2);
            state.next = 0;
        }
    }
    if (now < state.next || (!open && !state.followResult && !ParryTrainerProfiles.pending && !ParryTrainerIsActive() && state.synced)) return;
    state.requested = now;
    state.retry = false;
    state.lastToken = state.pending = Math.max(now, state.lastToken + 1);
    // The combat and soul counters are visible throughout every run.
    state.next = now + 850;
    var profiles = ParryTrainerProfiles.pending || (open && controls.BHasClass('OnCharacter'));
    $.DispatchEvent('CitadelConCommand', 'parry_trainer_score ' + state.pending + (profiles ? ' profiles' : ''));
}
