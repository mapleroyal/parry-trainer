// Read the host's saved settings on initial load and after run commands.
var ParryTrainerSettingsReady = false;

function ParryTrainerSetSettingsReady(root, ready) {
    ParryTrainerSettingsReady = ready;
    ['PageSetup', 'PageHero', 'PagePresets', 'PageCharacter', 'PageCreeps', 'PageCombat', 'Begin', 'Reset'].forEach(function (id) {
        var panel = root.FindChildTraverse('ParryTrainer' + id);
        panel.enabled = ready;
        panel.hittestchildren = ready;
    });
}

function ParryTrainerDrawSettings(root) {
    ParryTrainerDrawPreset(root);
    [1, 2].forEach(function (slot) {
        root.FindChildTraverse('ParryTrainerHero' + slot).text = ParryTrainerHeroes[ParryTrainerOpponents[slot]] + ' ›';
    });
    ['timer', 'parries', 'souls'].forEach(function (kind) { ParryTrainerDrawField(root, kind); });
    ParryTrainerDrawLimitMode(root);
}

function ParryTrainerRestoreSettings(root, saved) {
    if (ParryTrainerSettingsReady) return;
    ParryTrainerPreset.restore(saved);
    ParryTrainerOpponents = { 1: drillDefaults.hero1, 2: drillDefaults.hero2 };
    ParryTrainerLimit = ParryTrainerDefaultLimit();
    saved.split(',').forEach(function (pair) {
        var parts = pair.split('=');
        if (parts.length !== 2) return;
        var key = parts[0], value = parts[1];
        if ((key === 'hero1' || key === 'hero2') && Object.prototype.hasOwnProperty.call(ParryTrainerHeroes, value)) {
            ParryTrainerOpponents[key === 'hero1' ? 1 : 2] = value;
        } else if (key === 'limit_mode' && ['none', 'timer', 'goal'].indexOf(value) >= 0) {
            ParryTrainerLimit.mode = value;
        } else if (key === 'timer' || key === 'parries' || key === 'souls') {
            var count = ParryTrainerReadLimit(key, value);
            if (count !== null) ParryTrainerLimit[key] = count;
        }
    });
    ParryTrainerConfirmPreset(root);
    ParryTrainerDrawSettings(root);
    ParryTrainerSetSettingsReady(root, true);
}

var ParryTrainerSaveError = '';
var ParryTrainerSavePending = false;
var ParryTrainerRetryingSave = false;

function ParryTrainerUpdateSaveNotice(root, error, detail) {
    var messages = {
        damaged: 'Your saved library could not be read. Import a backup in Saved → Backups to save settings again.',
        write: 'Your settings apply to this session, but could not be saved for next time.',
        capacity: 'Your account library is full. Export a backup in Saved, then remove older entries.',
        offline: 'Account saves are unavailable. You can still practice and change settings for this session.'
    };
    var reason = Object.prototype.hasOwnProperty.call(messages, error) ? error : '';
    ParryTrainerSaveError = reason;
    ParryTrainerRetryingSave = false;
    var notice = root.FindChildTraverse('ParryTrainerSaveNotice');
    notice.SetHasClass('SaveFailed', Boolean(reason));
    notice.SetHasClass('CanRetry', reason === 'write' || reason === 'offline');
    if (!reason) return;

    ParryTrainerText(root, 'ParryTrainerSaveNoticeText', detail || messages[reason]);
    root.FindChildTraverse('ParryTrainerRetrySave').enabled = true;
    ParryTrainerText(root, 'ParryTrainerRetrySaveLabel', reason === 'offline' ? 'Reconnect account' : 'Save settings again');
}

function ParryTrainerRetrySave() {
    if (!ParryTrainerSettingsReady || ParryTrainerRetryingSave || ['write', 'offline'].indexOf(ParryTrainerSaveError) < 0) return;
    ParryTrainerRetryingSave = true;
    var root = ParryTrainerRoot();
    root.FindChildTraverse('ParryTrainerRetrySave').enabled = false;
    ParryTrainerText(root, 'ParryTrainerRetrySaveLabel', ParryTrainerSaveError === 'offline' ? 'Connecting…' : 'Saving…');
    ParryTrainerSend('parry_trainer_setting retry_save 1');
    ParryTrainerInvalidateScore();
}
