// The host replies to parry_trainer_score on a player-specific Modlock route. The sequence
// prevents an in-flight snapshot from rolling back a Begin, Reset or library edit.
var ParryTrainerScore = { next: 0, pending: 0, lastToken: 0, appliedThrough: 0, synced: false };

function ParryTrainerInvalidateScore() {
    var state = ParryTrainerScore;
    state.appliedThrough = state.lastToken;
    state.next = 0;
    state.pending = 0;
    state.synced = false;
}

function ParryTrainerPollScore(controls, open) {
    var state = ParryTrainerScore, now = Date.now();
    if (state.followResult) ParryTrainerUpdateRecap(controls);
    if (now < state.next) return;
    if (state.synced && !open && !ParryTrainerIsActive() && !ParryTrainerProfiles.pending &&
        !ParryTrainerStartBlock && !ParryTrainerSavePending && ParryTrainerSettingsReady) return;
    var profiles = ParryTrainerProfiles.pending || (open && controls.BHasClass('OnCharacter'));
    state.lastToken = state.pending = Math.max(now, state.lastToken + 1);
    state.next = now + 850;
    $.DispatchEvent('CitadelConCommand', 'parry_trainer_score ' + state.lastToken + (profiles ? ' profiles' : ''));
}

function ParryTrainerNativeInitialize(controls, gameHud) {
    var restoreHud = ParryTrainerGuardRetailHud(gameHud);
    Modlock.route('score', function (snapshot) {
        if (!snapshot || !controls.IsValid()) return;
        var state = ParryTrainerScore, sequence = Number(snapshot.ScoreSequence);
        if (!Number.isSafeInteger(sequence) || sequence <= state.appliedThrough || sequence > state.lastToken) return;
        function field(id) {
            var value = snapshot[id];
            return value === undefined || value === null ? '' : String(value);
        }
        if (Number(snapshot.StorageLoading)) {
            state.appliedThrough = sequence;
            state.synced = false;
            if (sequence === state.pending) state.pending = 0;
            ParryTrainerSetSettingsReady(controls, false);
            ParryTrainerStartAvailability(controls, field('StartUnavailable'));
            return;
        }
        if (ParryTrainerApplyScoreFields(controls, sequence, sequence, field)) {
            state.synced = true;
            if (sequence === state.pending) state.pending = 0;
        }
    });
    ParryTrainerNativeBackupInitialize(controls);
    Modlock.onUnload(function () {
        restoreHud();
        ParryTrainerClearResult(controls);
        ParryTrainerLatchMenu(controls, false);
    });
}
