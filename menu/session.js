// The host owns run transitions. The HUD timestamps countdown/timer snapshots
// so the numbers keep ticking between score requests.
var ParryTrainerRun = { phase: 'ready', mode: 'none', goal: 0, soulGoal: 0, parries: 0, souls: 0, reason: '', remaining: 0, deadline: 0, elapsed: 0, startedAt: 0 };
function ParryTrainerDefaultLimit() {
    return { mode: drillDefaults.limit_mode, timer: Number(drillDefaults.timer),
        parries: Number(drillDefaults.parries), souls: Number(drillDefaults.souls) };
}
var ParryTrainerLimit = ParryTrainerDefaultLimit();
var ParryTrainerFieldIds = { timer: 'ParryTrainerLimitInput', parries: 'ParryTrainerParryInput', souls: 'ParryTrainerSoulInput', hit_limit: 'ParryTrainerHitLimitInput' };
var ParryTrainerDigit = 0;

function ParryTrainerPage(page) {
    var root = ParryTrainerRoot();
    if (page !== 'Combat') ParryTrainerInterruptRangePreview(root);
    if (page !== 'Setup') ParryTrainerLeaveRules();
    if (root.BHasClass('OnPresets') && page !== 'Presets') ParryTrainerDiscardPreset(root);
    if (page !== 'Creeps') root.SetHasClass('ChoosingSoulSource', false);
    ['Setup', 'Hero', 'Combat', 'Creeps', 'Character', 'Presets', 'Score'].forEach(function (name) {
        root.SetHasClass('On' + name, name === page);
        root.FindChildTraverse('ParryTrainerNav' + name).SetHasClass('Selected', name === page);
    });
    if (page === 'Presets') ParryTrainerDrawPresetHint(root);
    if (page === 'Character') ParryTrainerProfileControls(root);
    if (page !== 'Character' && ParryTrainerProfiles.view !== 'main') ParryTrainerProfileOverview();
    if (page === 'Score' || page === 'Character' || page === 'Hero') ParryTrainerScore.next = 0;
}

function ParryTrainerChooseSoulSource() {
    ParryTrainerOpenTab('Creeps');
    ParryTrainerRoot().SetHasClass('ChoosingSoulSource', true);
}

function ParryTrainerFormatTime(total) {
    var seconds = total % 60;
    return Math.floor(total / 60) + ':' + (seconds < 10 ? '0' : '') + seconds;
}

function ParryTrainerReadLimit(kind, raw) {
    var value = String(raw).trim();
    if (kind === 'timer' && /^\d{1,4}:[0-5]\d$/.test(value)) {
        var parts = value.split(':');
        value = String(Number(parts[0]) * 60 + Number(parts[1]));
    }
    if (!/^\d{1,5}$/.test(value)) return null;
    var count = Number(value);
    if (kind === 'timer') return count >= 1 && count <= 86400 ? count : null;
    return count >= (kind === 'hit_limit' ? 1 : 0) && count <= 9999 ? count : null;
}

function ParryTrainerLimitValue(kind) {
    return kind === 'hit_limit' ? ParryTrainerPreset.get(kind) : ParryTrainerLimit[kind];
}

function ParryTrainerDrawField(root, kind) {
    var value = ParryTrainerLimitValue(kind);
    ParryTrainerText(root, ParryTrainerFieldIds[kind], kind === 'timer' ? ParryTrainerFormatTime(value) : String(value));
}

function ParryTrainerSaveLimit(kind, value) {
    if (value === null || value === ParryTrainerLimitValue(kind)) return;
    if (kind === 'hit_limit') ParryTrainerPreset.setPreference(kind, value);
    else ParryTrainerLimit[kind] = value;
    ParryTrainerSend('parry_trainer_setting ' + (kind === 'mode' ? 'limit_mode' : kind) + ' ' + value);
    ParryTrainerDrawSourceLock(ParryTrainerRoot());
}

var ParryTrainerInputDraft = '';
var ParryTrainerInputHadFocus = false;

function ParryTrainerEditField(kind) {
    if (!ParryTrainerSettingsReady || ParryTrainerIsActive()) return;
    var root = ParryTrainerRoot(), raw = root.FindChildTraverse(ParryTrainerFieldIds[kind]).text;
    var saved = ParryTrainerLimitValue(kind);
    if (raw === (kind === 'timer' ? ParryTrainerFormatTime(saved) : String(saved))) {
        if (ParryTrainerInputDraft === kind) ParryTrainerInputDraft = '';
        return;
    }
    if (ParryTrainerInputDraft && ParryTrainerInputDraft !== kind) ParryTrainerLeaveRules();
    ParryTrainerInputDraft = kind;
    ParryTrainerInputHadFocus = true;
    root.FindChildTraverse('ParryTrainerLimitError').text = '';
    ParryTrainerDrawSourceLock(root);
}

function ParryTrainerFieldError(kind) {
    if (kind === 'hit_limit') return 'Set the heavy melee hit limit from 1 to 9999.';
    return kind === 'timer' ? 'Enter 0:01 to 1440:00, or seconds.' : 'Enter a whole number from 0 to 9999 for ' + kind + '.';
}

function ParryTrainerCommitField(kind) {
    if (!ParryTrainerSettingsReady || ParryTrainerIsActive() || ParryTrainerInputDraft !== kind) return;
    var root = ParryTrainerRoot();
    var value = ParryTrainerReadLimit(kind, root.FindChildTraverse(ParryTrainerFieldIds[kind]).text);
    if (value === null) {
        root.FindChildTraverse('ParryTrainerLimitError').text = ParryTrainerFieldError(kind);
        return;
    }
    ParryTrainerInputDraft = '';
    ParryTrainerSaveLimit(kind, value);
    ParryTrainerDrawField(root, kind);
    root.FindChildTraverse('ParryTrainerLimitError').text = '';
}

function ParryTrainerLeaveRules() {
    var kind = ParryTrainerInputDraft;
    if (!kind) return;
    ParryTrainerCommitField(kind);
    if (ParryTrainerInputDraft) {
        ParryTrainerInputDraft = '';
        ParryTrainerDrawField(ParryTrainerRoot(), kind);
        ParryTrainerRoot().FindChildTraverse('ParryTrainerLimitError').text = '';
    }
}

function ParryTrainerAcceptLimit() {
    var root = ParryTrainerRoot();
    var mode = ParryTrainerLimit.mode;
    var error = root.FindChildTraverse('ParryTrainerLimitError');
    error.text = '';
    var fields = mode === 'timer' ? ['timer'] : mode === 'goal' ? ['parries', 'souls'] : [];
    if (ParryTrainerPreset.get('fail_on_hits')) fields.push('hit_limit');
    for (var i = 0; i < fields.length; i++) {
        var kind = fields[i];
        var value = ParryTrainerReadLimit(kind, root.FindChildTraverse(ParryTrainerFieldIds[kind]).text);
        if (value === null) {
            error.text = ParryTrainerFieldError(kind);
            return false;
        }
        if (ParryTrainerInputDraft === kind) ParryTrainerInputDraft = '';
        ParryTrainerSaveLimit(kind, value);
        ParryTrainerDrawField(root, kind);
    }
    if (mode === 'goal' && !ParryTrainerLimit.parries && !ParryTrainerLimit.souls) {
        error.text = 'Set at least one goal above 0.';
        return false;
    }
    return true;
}

function ParryTrainerSetLimit(mode) {
    if (!ParryTrainerSettingsReady || ParryTrainerIsActive()) return;
    ParryTrainerLeaveRules();
    ParryTrainerSaveLimit('mode', mode);
    ParryTrainerDrawLimitMode(ParryTrainerRoot());
}

function ParryTrainerDrawLimitMode(root) {
    var mode = ParryTrainerLimit.mode;
    root.SetHasClass('TimerLimit', mode === 'timer');
    root.SetHasClass('GoalLimit', mode === 'goal');
    ['none', 'timer', 'goal'].forEach(function (key) {
        root.FindChildTraverse('ParryTrainerLimit' + key).SetHasClass('Selected', mode === key);
    });
    root.FindChildTraverse('ParryTrainerLimitError').text = '';
}

function ParryTrainerAdjustLimit(kind, direction) {
    if (!ParryTrainerSettingsReady || ParryTrainerIsActive()) return;
    var root = ParryTrainerRoot();
    var value = ParryTrainerReadLimit(kind, root.FindChildTraverse(ParryTrainerFieldIds[kind]).text);
    if (value === null) value = ParryTrainerLimitValue(kind);
    var timer = kind === 'timer';
    if (ParryTrainerInputDraft === kind) ParryTrainerInputDraft = '';
    else ParryTrainerLeaveRules();
    ParryTrainerSaveLimit(kind, Math.min(timer ? 86400 : 9999, Math.max(timer || kind === 'hit_limit' ? 1 : 0, value + direction * (timer ? 30 : 1))));
    ParryTrainerDrawField(root, kind);
    root.FindChildTraverse('ParryTrainerLimitError').text = '';
}

function ParryTrainerStep(type, direction) {
    if (!ParryTrainerSettingsReady) return;
    var trooper = type === 'TrooperCount';
    var key = trooper ? 'trooper_count' : 'camp_tier';
    var previous = ParryTrainerPreset.get(key);
    var value = Math.max(1, Math.min(trooper ? 4 : 3, previous + direction));
    if (value === previous) return;
    ParryTrainerPreset.setPreference(key, value);
    ParryTrainerSend('parry_trainer_setting ' + key + ' ' + value);
    ParryTrainerDrawPreset(ParryTrainerRoot());
}

function ParryTrainerIsActive() { return ParryTrainerRun.phase === 'running' || ParryTrainerRun.phase === 'countdown'; }

// Commands and the next score request travel on the same console channel. Keep
// showing the last confirmed run until that post-command snapshot arrives.
function ParryTrainerRequestRunChange(root, command) {
    ParryTrainerSend(command);
    ParryTrainerSetSettingsReady(root, false);
    ParryTrainerInvalidateScore();
}

function ParryTrainerRunAction() {
    if (!ParryTrainerSettingsReady) return;
    var root = ParryTrainerRoot();
    if (root.BHasClass('OnPresets') && !ParryTrainerIsActive() && !root.BHasClass('TemplateApplied')) return;
    ParryTrainerDiscardPreset(root);
    if (ParryTrainerIsActive()) {
        ParryTrainerRequestRunChange(root, 'parry_trainer_stop');
        return;
    }
    if (ParryTrainerStartBlock) { ParryTrainerPage('Setup'); return; }
    if (!ParryTrainerAcceptLimit()) { ParryTrainerPage('Setup'); return; }
    var mode = ParryTrainerLimit.mode;
    if (mode === 'goal' && ParryTrainerLimit.souls && !ParryTrainerPreset.get('troopers') && !ParryTrainerPreset.get('camps')) {
        ParryTrainerPage('Setup');
        root.FindChildTraverse('ParryTrainerLimitError').text = 'Enable lane troopers or neutral camps in Creeps to collect souls.';
        return;
    }
    var command = 'parry_trainer_begin ' + mode;
    if (mode === 'timer') command += ' ' + ParryTrainerLimit.timer;
    if (mode === 'goal') command += ' ' + ParryTrainerLimit.parries + ' ' + ParryTrainerLimit.souls;
    ParryTrainerAwaitingStart = ParryTrainerRun.id === undefined ? 0 : ParryTrainerRun.id;
    ParryTrainerStartFeedback = '';
    ParryTrainerRequestRunChange(root, command);
}

// Stock Sandbox Max Level action. The game awards levels and their unlocks.
function ParryTrainerMaxLevel() { ParryTrainerSend('givelevelupgold 36'); }

var ParryTrainerResetPending = false;
var ParryTrainerResetFeedbackUntil = 0;

function ParryTrainerCanReset() {
    return ParryTrainerSettingsReady && !ParryTrainerProfiles.pending && !ParryTrainerProfiles.busy;
}

function ParryTrainerReset() {
    if (!ParryTrainerCanReset()) return;
    var root = ParryTrainerRoot();
    ParryTrainerInputDraft = '';
    ParryTrainerDiscardPreset(root);
    ParryTrainerStartFeedback = '';
    ParryTrainerResetPending = true;
    ParryTrainerRequestRunChange(root, 'parry_trainer_reset');
}

var ParryTrainerStartBlock = '';
var ParryTrainerAwaitingStart = null;
var ParryTrainerStartFeedback = '';
function ParryTrainerStartAvailability(root, reason) {
    ParryTrainerStartBlock = reason;
    if (ParryTrainerAwaitingStart !== null) {
        if (!ParryTrainerIsActive() && ParryTrainerRun.id === ParryTrainerAwaitingStart) {
            ParryTrainerStartFeedback = reason ? '' : 'The host could not begin this session. Try Begin session again.';
            ParryTrainerPage('Setup');
        }
        ParryTrainerAwaitingStart = null;
    }
    if (ParryTrainerIsActive()) ParryTrainerStartFeedback = '';
    var message = root.FindChildTraverse('ParryTrainerStartError');
    message.text = reason || ParryTrainerStartFeedback;
    message.visible = Boolean(message.text);
}

function ParryTrainerApplySession(phase, mode, remaining, goal, parries, soulGoal, souls, reason, stamp, elapsed, runId, details) {
    details = details || {};
    var run = ParryTrainerRun;
    // An accepted Begin gets a new ID even if a short run finishes between polls.
    // Loading a panel over an already-finished run only restores its scoreboard.
    var newer = run.id !== undefined && runId > run.id;
    var freshFinish = phase === 'finished' && (ParryTrainerIsActive() || newer);
    if (phase !== 'finished' && run.phase === 'finished') ParryTrainerClearResult(ParryTrainerRoot());
    run.id = runId;
    elapsed = Math.max(0, Number(elapsed) || 0);
    // Whole-second samples can straddle a tick. Keep a stable start between samples.
    if (phase === 'running' && (run.phase !== 'running' || elapsed < run.elapsed ||
        Math.abs(stamp - run.startedAt - elapsed * 1000) >= 1000)) run.startedAt = stamp - elapsed * 1000;
    run.elapsed = elapsed;
    var duration = Math.max(0, remaining) * 1000;
    if (run.phase !== phase || run.mode !== mode || Math.abs(run.deadline - (stamp + duration)) > 1000)
        run.deadline = stamp + duration;
    run.phase = phase;
    if (ParryTrainerIsActive()) ParryTrainerLatchMenu(ParryTrainerRoot(), false);
    run.mode = mode;
    run.remaining = remaining;
    run.goal = goal;
    run.parries = parries;
    run.soulGoal = soulGoal;
    run.souls = souls;
    run.reason = reason;
    run.hitLimit = details.hitLimit || 0;
    run.timerTarget = details.timerTarget || 0;
    run.respawnBy = details.respawnMs ? stamp + details.respawnMs : 0;
    run.failOnDeath = details.failOnDeath;
    run.deathCause = details.deathCause;
    run.rulesChanged = details.rulesChanged;
    var context = ParryTrainerScoreContext(run);
    ParryTrainerRenderScore(ParryTrainerRoot(), context);
    if (freshFinish) {
        var outcome = { goal: 'victory', time: 'victory', hits: 'defeat', death: 'defeat' }[reason];
        if (outcome) ParryTrainerShowResult(ParryTrainerRoot(), outcome, Object.assign({}, ParryTrainerScoreMetrics, context), runId);
    }
}

function ParryTrainerText(root, id, value) {
    var label = root.FindChildTraverse(id);
    if (label.text !== value) label.text = value;
}

function ParryTrainerGoalProgress(run) {
    var targets = [];
    if (run.goal) targets.push(run.parries + '/' + run.goal + (run.goal === 1 ? ' parry' : ' parries'));
    if (run.soulGoal) targets.push(run.souls + '/' + run.soulGoal + (run.soulGoal === 1 ? ' soul' : ' souls'));
    return targets.join('  ·  ');
}

var ParryTrainerScoreMetrics = {};

function ParryTrainerRenderScore(panel, values) {
    Object.keys(values).forEach(function (key) {
        ParryTrainerText(panel, 'ParryTrainerScore' + key, values[key]);
    });
    if (values.Target !== undefined) panel.FindChildTraverse('ParryTrainerScoreTarget').visible = Boolean(values.Target);
    if (values.Reason !== undefined) panel.FindChildTraverse('ParryTrainerScoreReason').visible = Boolean(values.Reason);
    if (values.Changes !== undefined) panel.FindChildTraverse('ParryTrainerScoreChanges').visible = Boolean(values.Changes);
}

function ParryTrainerScoreContext(run) {
    var status = { ready: 'No session yet', countdown: 'Starting soon', running: 'In progress', finished: 'Session complete' }[run.phase];
    var reason = run.phase === 'ready' ? 'Begin a session to record a score.' : '';
    if (run.phase === 'finished') {
        if (run.reason === 'stopped') status = 'Session stopped';
        if (run.reason === 'hits' || run.reason === 'death') status = 'Defeat';
        if (run.reason === 'goal' || run.reason === 'time') status = 'Victory';
        reason = { death: 'You died.', hits: 'Heavy hit limit reached.', goal: 'Training goals reached.',
            time: 'Time limit reached.', stopped: 'Ended manually.' }[run.reason] || '';
        if (run.reason === 'death' && run.deathCause === 'standing-drain') reason = 'Standing still drained your remaining health.';
        if (run.reason === 'hits' && run.hitLimit) reason = ParryTrainerScoreMetrics.Hits + ' of ' + run.hitLimit +
            (run.hitLimit === 1 ? ' heavy hit taken.' : ' heavy hits taken.');
    }
    var target = '';
    if (run.mode === 'goal') target = ParryTrainerGoalProgress(run);
    if (run.mode === 'timer') target = run.timerTarget ? 'Timer target · ' + ParryTrainerFormatTime(run.timerTarget) :
        'Time remaining · ' + ParryTrainerFormatTime(run.remaining);
    return { Status: status, Reason: reason, Target: target, Changes: run.rulesChanged ? 'Rules changed during this session' : '',
        Elapsed: run.phase === 'ready' ? '' : 'Elapsed  ' + ParryTrainerFormatTime(run.elapsed) };
}

function ParryTrainerShowStats(root, count) {
    var hits = count('SessionHits');
    var hitLimit = count('SessionHitLimit');
    var hitText = (hitLimit ? hits + '/' + hitLimit : hits) + ((hitLimit || hits) === 1 ? ' hit taken' : ' hits taken');
    var parries = count('SessionParries'), heavies = count('SessionHeavies');
    ParryTrainerText(root, 'ParryTrainerHudParries', parries + '/' + heavies + ' · ' + hitText);
    var bulletsFired = count('SessionBulletsFired'), bulletsHit = count('SessionBulletsHit');
    var values = {
        Parries: String(parries), Heavies: String(heavies), Hits: String(hits), Deaths: String(count('SessionDeaths') || 0),
        Damage: (count('SessionDamageTaken') || 0) + ' HP',
        WeaponAccuracy: bulletsFired ? Math.round(100 * bulletsHit / bulletsFired) + '% (' + bulletsHit + '/' + bulletsFired + ')' : '—',
        ParryRate: heavies ? Math.round(100 * parries / heavies) + '%' : 'No incoming heavies',
        GrossSouls: String((count('LaneSecured') || 0) + (count('CampSecured') || 0)),
        Deductions: String(count('SessionSoulsDeducted') || 0), NetSouls: String(count('SessionSouls') || 0)
    };
    ['Lane', 'Camp'].forEach(function (source) {
        ['Secured', 'Missed', 'Kills'].forEach(function (metric) {
            values[source + metric] = String(count(source + metric) || 0);
        });
        ParryTrainerText(root, 'ParryTrainerHud' + source + 'Souls',
            count(source + 'Secured') + ' secured · ' + count(source + 'Missed') + ' missed');
    });
    ParryTrainerScoreMetrics = values;
    ParryTrainerRenderScore(root, values);
}

function ParryTrainerDrawSession(root, now) {
    root.FindChildTraverse('ParryTrainerReset').enabled = ParryTrainerCanReset();
    if (ParryTrainerResetPending && ParryTrainerSettingsReady) {
        ParryTrainerResetPending = false;
        ParryTrainerResetFeedbackUntil = now + 1800;
    }
    ParryTrainerText(root, 'ParryTrainerResetLabel',
        ParryTrainerResetPending ? '…' : now < ParryTrainerResetFeedbackUntil ? 'Restored' : 'Reset');
    var run = ParryTrainerRun;
    var counting = run.phase === 'countdown';
    var active = ParryTrainerIsActive();
    var remaining = Math.max(0, Math.ceil((run.deadline - now) / 1000));
    var phaseName = { ready: '', countdown: 'Starting', running: 'Training continues while settings are open', finished: 'Finished' }[run.phase];
    // Retail toggles .dead on its own HUD at death and respawn. Use that
    // immediate signal even when the short recovery falls between score polls.
    var recovering = run.phase === 'running' && ParryTrainerGameHud(root).BHasClass('dead') &&
        (run.respawnBy > now || (!run.failOnDeath && !ParryTrainerPreset.get('fail_on_death')));
    var recoveryText = 'Respawning · session continues';
    root.FindChildTraverse('ParryTrainerHudRecovery').visible = recovering;
    if (run.phase === 'running') ParryTrainerText(root, 'ParryTrainerScoreStatus', recovering ? recoveryText : 'In progress');
    if (recovering) phaseName = recoveryText;
    if (!ParryTrainerSettingsReady) phaseName = 'Waiting for host…';
    var failures = { death: 'Failed · You died', hits: 'Failed · Hit limit reached' };
    var failed = run.phase === 'finished' && failures[run.reason];
    if (failed) phaseName = failures[run.reason];
    root.SetHasClass('Counting', counting);
    root.SetHasClass('InSession', active);
    ParryTrainerDrawSourceLock(root);
    if (root.BHasClass('OnPresets')) ParryTrainerDrawPresetHint(root);
    root.FindChildTraverse('ParryTrainerHitLossChoice').enabled = !active;
    var hitFields = root.FindChildTraverse('ParryTrainerHitLimitFields');
    hitFields.enabled = !active;
    hitFields.hittestchildren = !active;
    if (typeof ParryTrainerNativeInitialize !== 'function')
        root.GetParent().SetHasClass('ParryTrainerWaveUnits', active && (ParryTrainerPreset.get('troopers') || ParryTrainerPreset.get('camps')));
    var footer = phaseName;
    if (ParryTrainerSavePending && ParryTrainerSettingsReady) footer = (footer ? footer + '  ·  ' : '') + 'Saving to your account…';
    ParryTrainerText(root, 'ParryTrainerPhase', footer);
    var action = counting ? 'Cancel countdown' : active ? 'End session' : run.phase === 'finished' ? 'Train again' : 'Begin session';
    ParryTrainerText(root, 'ParryTrainerBeginLabel', action);
    var hud = '', caption = '';
    if (run.phase === 'ready' && !ParryTrainerMenuVisible(root)) {
        caption = 'Training';
        hud = 'to begin';
    }
    if (run.phase === 'finished') {
        var why = { time: 'Time up', goal: 'Goal reached', stopped: 'Training ended' };
        caption = failed ? phaseName : why[run.reason] || 'Training complete';
        hud = run.mode === 'goal' ? ParryTrainerGoalProgress(run) : 'to train again';
    }
    var timed = (run.phase === 'ready' ? ParryTrainerLimit.mode : run.mode) === 'timer';
    var clock = run.phase === 'running' ? Math.max(run.elapsed, Math.floor((now - run.startedAt) / 1000)) : run.elapsed;
    if (timed) clock = counting || run.phase === 'ready' ? ParryTrainerLimit.timer : run.phase === 'finished' ? run.remaining : remaining;
    ParryTrainerText(root, 'ParryTrainerClockCaption', timed ? 'Time left' : 'Time elapsed');
    ParryTrainerText(root, 'ParryTrainerClock', ParryTrainerFormatTime(clock));
    if (active && run.mode === 'goal') {
        caption = run.goal && run.soulGoal ? 'Goals' : 'Goal';
        hud = ParryTrainerGoalProgress(run);
    } else if (run.phase === 'running' && (ParryTrainerPreset.get('penalty_hit') ||
        ParryTrainerPreset.get('penalty_unparried') || ParryTrainerPreset.get('penalty_whiff'))) {
        caption = 'Net souls secured';
        hud = String(run.souls);
    }
    root.FindChildTraverse('ParryTrainerHudKey').visible = hud === 'to begin' || hud === 'to train again';
    root.SetHasClass('HasHudText', Boolean(hud));
    ParryTrainerText(root, 'ParryTrainerHudCaption', caption);
    ParryTrainerText(root, 'ParryTrainerHudText', hud);
    if (active) {
        ParryTrainerText(root, 'ParryTrainerCurrentLimit', run.mode === 'none' ? 'Unlimited' : run.mode === 'goal'
            ? ParryTrainerGoalProgress(run) : counting ? 'Timer' : ParryTrainerFormatTime(remaining) + ' remaining');
    }
    var digit = counting ? Math.min(3, remaining) : 0;
    if (digit !== ParryTrainerDigit) {
        ParryTrainerDigit = digit;
        var container = root.FindChildTraverse('ParryTrainerCountdown');
        var number = container.FindChildTraverse('PausedCountdownLabel');
        if (number && digit) { number.text = String(digit); number.TriggerClass('ShrinkCountdown'); }
    }
}
