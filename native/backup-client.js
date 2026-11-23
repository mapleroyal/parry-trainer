// The Modlock actions used by this layout carry 180 bytes each. Acknowledge
// offsets and retry the same chunk if an action is dropped by the host.
var ParryTrainerBackup = null;
var ParryTrainerBackupSerial = 0;
function ParryTrainerNativeBackupFeedback(message) {
    ParryTrainerText(ParryTrainerRoot(), 'ParryTrainerBackupFeedback', message);
}
function ParryTrainerNativeBackupRequest(action) {
    if (ParryTrainerBackup || !ParryTrainerCanProfile(action)) return;
    if (action === 'export') { ParryTrainerNativeStartBackup(action); return; }
    var root = ParryTrainerRoot(), entry = root.FindChildTraverse('ParryTrainerBackupText');
    if (!entry.text.trim()) { ParryTrainerNativeBackupFeedback('Paste your backup in the text field first.'); return; }
    ParryTrainerText(root, 'ParryTrainerProfileConfirmTitle', 'Replace trainer settings and library?');
    ParryTrainerText(root, 'ParryTrainerProfileConfirmDetail', 'Replace your settings, saved drills and hero builds with the backup you pasted.');
    ParryTrainerText(root, 'ParryTrainerProfileConfirmLabel', 'Import backup');
    root.FindChildTraverse('ParryTrainerProfileConfirm').SetHasClass('PTDelete', false);
    ParryTrainerProfileView('confirm', 'native-import');
}
function ParryTrainerNativeBackupProceed() {
    if (ParryTrainerProfiles.view !== 'confirm' || ParryTrainerProfiles.action !== 'native-import') return false;
    ParryTrainerProfileOverview();
    if (ParryTrainerCanProfile('import')) ParryTrainerNativeStartBackup('import');
    return true;
}
function ParryTrainerNativeStartBackup(action) {
    var root = ParryTrainerRoot(), field = root.FindChildTraverse('ParryTrainerBackupText');
    var data = '', format = 'packed';
    if (action === 'import') {
        try {
            var original = field.text.trim(), doc = JSON.parse(original);
            if (!['parry-trainer', 'parry-void'].includes(doc.format) || [1, 2, 3].indexOf(doc.version) < 0 || !Array.isArray(doc.profiles)) throw Error();
            if (doc.version === 3) {
                data = packTrainerDocument(doc);
                if (!recordParts(data)) { ParryTrainerNativeBackupFeedback('This backup exceeds Hyperline’s account storage limit.'); return; }
            } else { data = original; format = 'json'; }
            if (data.length > 16384) { ParryTrainerNativeBackupFeedback('This older backup is too large to import here.'); return; }
        } catch (_) { ParryTrainerNativeBackupFeedback('Paste a complete Parry Trainer JSON backup.'); return; }
    }
    // An ID unique across layout reloads keeps delayed responses from reviving
    // an earlier import. It is never used as an account identifier.
    var id = Date.now() * 100 + (++ParryTrainerBackupSerial % 100);
    ParryTrainerBackup = { id: id, action: action, data: data, offset: 0, format: format, attempts: 0, ticket: 0 };
    ParryTrainerNativeBackupFeedback(action === 'export' ? 'Preparing backup…' : 'Importing backup…');
    ParryTrainerNativeBackupSend();
}
function ParryTrainerNativeBackupSend() {
    var b = ParryTrainerBackup;
    if (!b) return;
    var packet = ['get', b.id, b.offset];
    if (b.action === 'import') {
        var slice = '', tail = b.data.slice(b.offset);
        // Panoramic strings may contain emoji, escaped quotes and non-ASCII
        // names. Measure the actual JSON payload, stopping at a whole code point.
        for (var c of tail) {
            var candidate = ['put', b.id, b.offset, slice + c, b.data.length, b.format];
            if (encodeURIComponent(JSON.stringify(candidate)).replace(/%[0-9A-F]{2}/gi, '_').length > 180) break;
            slice += c;
            packet = candidate;
        }
        if (!slice) { ParryTrainerNativeBackupEnd('The backup transfer could not continue.'); return; }
    }
    if (!Modlock.press('backup', packet)) { ParryTrainerNativeBackupEnd('The trainer could not send the backup request.'); return; }
    var ticket = ++b.ticket;
    $.Schedule(b.saving ? 6 : 1.8, function () {
        if (ParryTrainerBackup !== b || b.ticket !== ticket) return;
        if (++b.attempts <= 6) ParryTrainerNativeBackupSend();
        else ParryTrainerNativeBackupEnd('The host did not confirm the transfer. Reopen Backups and try again.');
    });
}
function ParryTrainerNativeBackupEnd(message) {
    ParryTrainerBackup = null;
    ParryTrainerNativeBackupFeedback(message);
}
function ParryTrainerNativeBackupInitialize(root) {
    Modlock.route('backup', function (reply) {
        var b = ParryTrainerBackup;
        if (!b || !reply || reply.id !== b.id) return;
        if (reply.state === 'error') { ParryTrainerNativeBackupEnd(String(reply.message)); return; }
        if (reply.state === 'done') {
            ParryTrainerSetSettingsReady(root, false);
            ParryTrainerInvalidateScore();
            ParryTrainerNativeBackupEnd(String(reply.message));
            return;
        }
        // Keep the last chunk eligible for retry while account storage answers.
        if (reply.state === 'saving') { b.saving = true; return; }
        if (reply.state === 'text' && b.action === 'export') {
            if (reply.offset !== b.offset || typeof reply.text !== 'string') return;
            b.data += reply.text;
            b.offset = b.data.length;
            if (b.offset >= reply.total) {
                try { root.FindChildTraverse('ParryTrainerBackupText').text = unpackTrainerDocument(b.data); }
                catch (_) { ParryTrainerNativeBackupEnd('Could not read the exported trainer data.'); return; }
                ParryTrainerNativeBackupEnd('Exported to the text field above. Copy it into a file such as parry-trainer.json.');
                return;
            }
        } else if (reply.state === 'next' && b.action === 'import') {
            if (reply.offset <= b.offset || reply.offset >= b.data.length) return;
            b.offset = reply.offset;
            ParryTrainerNativeBackupFeedback('Importing backup… ' + Math.floor(100 * b.offset / b.data.length) + '%');
        } else return;
        b.attempts = 0;
        var ticket = ++b.ticket;
        $.Schedule(0.37, function () { if (ParryTrainerBackup === b && b.ticket === ticket) ParryTrainerNativeBackupSend(); });
    });
    Modlock.onUnload(function () { ParryTrainerBackup = null; });
}
