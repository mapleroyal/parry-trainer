// Both the Modlock route and the standalone HUD feed the same authoritative snapshot.
function ParryTrainerApplyScoreFields(controls, sequence, stamp, field) {
    if (sequence <= ParryTrainerScore.appliedThrough) return true;
    var phase = field('SessionPhase');
    if (['ready', 'countdown', 'running', 'finished'].indexOf(phase) < 0) return false;
    function count(id) { return Number(field(id)) || 0; }
    ParryTrainerScore.appliedThrough = sequence;
    var runId = count('SessionRun');
    if (runId < ParryTrainerRun.id) return true;
    // Keep the first complete terminal score on both surfaces. Later polls
    // may still carry settings and profile responses for the same run.
    var alreadyFinished = phase === 'finished' && ParryTrainerRun.phase === 'finished' && runId === ParryTrainerRun.id;
    if (!alreadyFinished) {
        ParryTrainerShowStats(controls, count);
        ParryTrainerApplySession(phase, field('SessionMode'), count('SessionRemaining'), count('SessionGoal'),
            count('SessionParries'), count('SessionSoulGoal'), count('SessionSouls'), field('SessionEndReason'),
            stamp, count('SessionElapsed'), runId, { hitLimit: count('SessionHitLimit'), timerTarget: count('SessionTimerTarget'),
                respawnMs: count('SessionRespawnMs'), rulesChanged: Boolean(count('SessionRulesChanged')),
                failOnDeath: Boolean(count('SessionFailOnDeath')), deathCause: field('SessionDeathCause') });
    }
    ParryTrainerStartAvailability(controls, field('StartUnavailable'));
    ParryTrainerSavePending = field('SettingsSavePending') === '1';
    ParryTrainerUpdateSaveNotice(controls, field('SettingsSaveError'), field('SettingsSaveMessage'));
    ParryTrainerReceiveProfiles(controls, field);
    if (!ParryTrainerSettingsReady && !ParryTrainerProfiles.pending) {
        ParryTrainerRestoreSettings(controls, field('TrainerSettings'));
        if (controls.BHasClass('OnCharacter')) ParryTrainerProfileControls(controls);
    }
    return true;
}
