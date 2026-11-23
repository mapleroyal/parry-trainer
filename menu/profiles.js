// Only form state and the selected variant live in the HUD. The host owns all saved entries.
function ParryTrainerNewProfiles() {
    return { hero: '', revision: null, list: null, profiles: [], selected: {}, actionButtons: [],
        busy: false, pending: '', feedback: '', feedbackSection: '', section: 'drills', view: 'main',
        mask: 3, target: '', action: '' };
}
var ParryTrainerProfiles = ParryTrainerNewProfiles();

function ParryTrainerCanProfile(action) {
    var s = ParryTrainerProfiles;
    if (!ParryTrainerSettingsReady || s.busy || s.pending || ParryTrainerSaveError === 'offline') return false;
    if (s.list === null || (s.list === '' && action !== 'import')) return false;
    if (action === 'save') return s.section === 'drills' || (s.section === 'builds' && Boolean(s.hero));
    return !(ParryTrainerIsActive() && (action === 'apply' || action === 'drill-only' || action === 'import'));
}

function ParryTrainerProfileView(view, action, target) {
    var s = ParryTrainerProfiles, root = ParryTrainerRoot();
    s.view = view;
    s.target = target || '';
    s.action = action || '';
    root.SetHasClass('ProfileSaveForm', view === 'save');
    root.SetHasClass('ProfileChoosing', view === 'choose');
    root.SetHasClass('ProfileConfirming', view === 'confirm');
    root.FindChildTraverse('ParryTrainerProfileDrillOnly').visible = view === 'confirm' && action === 'apply' &&
        s.profiles.some(function (p) { return p.id === target && p.settings && p.hero; });
    root.SetHasClass('ProfileEditing', view !== 'main');
    root.SetHasClass('HasProfileFeedback', view === 'main' && Boolean(s.feedback) && (!s.feedbackSection || s.feedbackSection === s.section));
}
function ParryTrainerProfileOverview() {
    ParryTrainerProfileView('main');
}

function ParryTrainerLibrarySection(section) {
    if (['drills', 'builds', 'backups'].indexOf(section) < 0) return;
    ParryTrainerProfileOverview();
    ParryTrainerProfiles.section = section;
    ParryTrainerProfileRows(ParryTrainerRoot());
}

function ParryTrainerProfileSend(action, arg) {
    if (!ParryTrainerCanProfile(action)) return;
    var s = ParryTrainerProfiles, root = ParryTrainerRoot();
    s.pending = action;
    s.feedbackSection = s.section;
    s.feedback = { save: 'Saving…', overwrite: 'Saving…', 'overwrite-drill-only': 'Saving…', rename: 'Renaming…', apply: 'Loading…', 'drill-only': 'Loading…', delete: 'Deleting…',
        export: 'Exporting backup…', import: 'Importing backup…' }[action];
    ParryTrainerProfileOverview();
    ParryTrainerProfileControls(root);
    ParryTrainerSend('parry_trainer_profile ' + action + (arg ? ' ' + arg : ''));
    if (action === 'apply' || action === 'drill-only' || action === 'import') ParryTrainerSetSettingsReady(root, false);
    ParryTrainerInvalidateScore();
}

function ParryTrainerProfileSaveForm(entry) {
    var action = entry ? 'rename' : 'save';
    if (!ParryTrainerCanProfile(action)) return;
    var s = ParryTrainerProfiles, root = ParryTrainerRoot(), build = s.section === 'builds';
    var noun = build ? 'build' : 'drill';
    s.mask = build ? 3 : 0;
    ParryTrainerProfileView('save', action, entry ? entry.id : s.hero);
    ParryTrainerText(root, 'ParryTrainerProfileSaveTitle', (entry ? 'Rename ' : 'Save ') + noun);
    root.FindChildTraverse('ParryTrainerBuildParts').visible = build && !entry;
    root.FindChildTraverse('ParryTrainerDrillBuildChoice').visible = !build && !entry;
    var input = root.FindChildTraverse('ParryTrainerProfileNameInput');
    var names = s.profiles.filter(function (p) { return build ? !p.settings && p.hero === s.hero : p.settings; })
        .map(function (p) { return p.name.toLowerCase(); });
    var base = build ? (ParryTrainerHeroes[s.hero] || 'Hero') + ' build ' : 'Drill ';
    var n = 1;
    while (names.indexOf((base + n).toLowerCase()) !== -1) n++;
    input.text = entry ? entry.name : base + n;
    if (input.SetFocus) input.SetFocus();
    ParryTrainerProfileParts();
}

function ParryTrainerProfileParts() {
    var s = ParryTrainerProfiles;
    if (s.view !== 'save') return;
    var root = ParryTrainerRoot(), name = root.FindChildTraverse('ParryTrainerProfileNameInput').text.trim();
    ParryTrainerText(root, 'ParryTrainerProfileInventoryValue', s.mask & 1 ? 'On' : 'Off');
    ParryTrainerText(root, 'ParryTrainerProfileAbilitiesValue', s.mask & 2 ? 'On' : 'Off');
    ParryTrainerText(root, 'ParryTrainerDrillBuildValue', s.mask ? 'On' : 'Off');
    ParryTrainerText(root, 'ParryTrainerDrillBuildLabel', 'Include ' + (ParryTrainerHeroes[s.hero] || 'current hero') + ' build');
    root.FindChildTraverse('ParryTrainerDrillBuildChoice').enabled = Boolean(s.hero);
    var needsPart = s.action === 'save' && s.section === 'builds' && !s.mask;
    root.FindChildTraverse('ParryTrainerProfileSave').enabled = Boolean(name) && Array.from(name).length <= 40 && !needsPart;
    var hint = needsPart ? 'Choose inventory or abilities to save.'
        : s.action !== 'save' || s.section !== 'drills' ? ''
        : s.mask ? 'Includes current inventory, level and abilities.' : 'Saves the current session settings for any hero.';
    ParryTrainerText(root, 'ParryTrainerProfileSaveDetail', hint);
    root.FindChildTraverse('ParryTrainerProfileSaveDetail').visible = Boolean(hint);
}
function ParryTrainerProfileTogglePart(bit) {
    var s = ParryTrainerProfiles;
    if (s.view !== 'save' || s.action !== 'save') return;
    if (s.section === 'drills') {
        if (bit !== 3 || !s.hero) return;
    } else if (bit !== 1 && bit !== 2) return;
    s.mask ^= bit;
    ParryTrainerProfileParts();
}
function ParryTrainerProfileSave() {
    var s = ParryTrainerProfiles, root = ParryTrainerRoot();
    if (s.view !== 'save' || !root.FindChildTraverse('ParryTrainerProfileSave').enabled) return;
    if (s.action === 'save' && s.mask && (!s.hero || s.target !== s.hero)) return;
    var name = root.FindChildTraverse('ParryTrainerProfileNameInput').text.trim();
    var encoded = encodeURIComponent(name).replace(/[!'()*]/g, function (c) { return '%' + c.charCodeAt(0).toString(16); });
    var target = s.target;
    if (s.action === 'save') {
        target = s.section === 'drills' ? (s.mask ? 'drill-build' : 'drill') : ['','items','skills','build'][s.mask];
        if (s.mask) target += ':' + s.hero;
    }
    ParryTrainerProfileSend(s.action, target + ' ' + encoded);
}

function ParryTrainerProfileLabel(parent, text, style) {
    var label = $.CreatePanel('Label', parent, '');
    label.text = text;
    label.AddClass(style);
    return label;
}
function ParryTrainerProfileButton(parent, id, style, click) {
    var button = $.CreatePanel('Button', parent, id, { acceptsfocus: 'true' });
    button.AddClass(style);
    button.SetPanelEvent('onactivate', click);
    return button;
}
function ParryTrainerProfileSummary(p) {
    var parts = [];
    if (!p.settings) {
        if (p.inventory) parts.push((p.items || 0) + (p.items === 1 ? ' item' : ' items'));
        if (p.abilities) parts.push(p.level ? 'Level ' + p.level : 'Abilities');
    } else {
        var fields = {}, model = createPresetSettings();
        (p.drill || '').split(',').forEach(function (pair) { var v = pair.split('='); fields[v[0]] = v[1]; });
        model.restore(p.drill || '');
        if (fields.limit_mode === 'timer') parts.push(ParryTrainerFormatTime(Number(fields.timer) || 300) + ' timer');
        else if (fields.limit_mode === 'goal') {
            var parries = fields.parries === undefined ? 10 : Number(fields.parries);
            if (parries) parts.push(parries + (parries === 1 ? ' parry' : ' parries'));
            if (Number(fields.souls)) parts.push(fields.souls + (fields.souls === '1' ? ' soul' : ' souls'));
            if (!parts.length) parts.push('Goals');
        } else parts.push('Unlimited');
        parts.push(model.get('second') ? '2 opponents' : '1 opponent');
        parts.push('Template ' + model.preset);
        if (p.hero) parts.push((ParryTrainerHeroes[p.hero] || p.hero) + ' build');
    }
    return parts.join(' · ');
}
function ParryTrainerProfileChoose(hero) {
    var root = ParryTrainerRoot(), s = ParryTrainerProfiles, options = root.FindChildTraverse('ParryTrainerProfileOptions');
    options.RemoveAndDeleteChildren();
    var entries = s.profiles.filter(function (p) { return !p.settings && p.hero === hero; });
    if (!entries.length) { ParryTrainerProfileOverview(); return; }
    ParryTrainerText(root, 'ParryTrainerProfileChooseTitle', 'Choose a ' + (ParryTrainerHeroes[hero] || hero) + ' build');
    entries.forEach(function (p) {
        var button = ParryTrainerProfileButton(options, 'ParryTrainerProfileOption' + p.id, 'PTProfileOption', function () {
            s.selected[hero] = p.id;
            ParryTrainerProfileRows(root);
            ParryTrainerProfileOverview();
        });
        button.SetHasClass('Selected', p.id === s.selected[hero]);
        ParryTrainerProfileLabel(button, p.name, 'PTProfileTitle');
        ParryTrainerProfileLabel(button, ParryTrainerProfileSummary(p), 'PTProfileMinor');
    });
    ParryTrainerProfileView('choose', '', hero);
}
function ParryTrainerProfileRows(root) {
    var s = ParryTrainerProfiles, rows = root.FindChildTraverse('ParryTrainerProfileRows'), groups = {};
    rows.RemoveAndDeleteChildren();
    s.actionButtons = [];
    s.profiles.forEach(function (p) {
        if (s.section === (p.settings ? 'drills' : 'builds')) {
            var key = p.settings ? p.id : p.hero;
            (groups[key] || (groups[key] = [])).push(p);
        }
    });
    Object.keys(groups).sort(function (a, b) {
        var left = ParryTrainerHeroes[a] || groups[a][0].name, right = ParryTrainerHeroes[b] || groups[b][0].name;
        return left < right ? -1 : left > right ? 1 : 0;
    }).forEach(function (key) {
        var group = groups[key], p = group.find(function (v) { return v.id === s.selected[key]; }) || group[0];
        s.selected[key] = p.id;
        var row = $.CreatePanel('Panel', rows, 'ParryTrainerProfileRow_' + key);
        row.AddClass('PTProfileRow');
        if (!p.settings) ParryTrainerProfileLabel(row, ParryTrainerHeroes[p.hero] || p.hero, 'PTProfileName');
        var choice = group.length > 1 ? ParryTrainerProfileButton(row, 'ParryTrainerProfilePicker_' + key, 'PTProfileSelection', function () {
            ParryTrainerProfileChoose(key);
        }) : $.CreatePanel('Panel', row, '');
        choice.AddClass('PTProfileSelection');
        ParryTrainerProfileLabel(choice, p.name + (group.length > 1 ? '  ▾' : ''), 'PTProfileTitle');
        ParryTrainerProfileLabel(choice, ParryTrainerProfileSummary(p), 'PTProfileMinor');
        ['apply', 'overwrite', 'rename', 'delete'].forEach(function (action) {
            var label = { apply: 'Load', overwrite: 'Overwrite', rename: 'Rename', delete: 'Delete' }[action];
            var button = ParryTrainerProfileButton(row, 'ParryTrainerProfile' + label + p.id, 'PTSubAction', function () {
                if (action === 'rename') ParryTrainerProfileSaveForm(p); else ParryTrainerProfileConfirm(action, p);
            });
            if (action === 'delete') button.AddClass('PTDelete');
            ParryTrainerProfileLabel(button, label, 'PTProfileTitle');
            s.actionButtons.push({ button: button, action: action, entry: p });
        });
    });
    ParryTrainerProfileControls(root);
}
function ParryTrainerProfileConfirm(action, p) {
    if (!ParryTrainerCanProfile(action)) return;
    var root = ParryTrainerRoot(), s = ParryTrainerProfiles, title, detail, submit;
    if (action === 'apply' || action === 'overwrite') {
        title = (action === 'apply' ? 'Load' : 'Overwrite') + ' “' + p.name + '”?';
        var hero = ParryTrainerHeroes[p.hero] || p.hero;
        var parts = p.inventory && p.abilities ? 'inventory, level and abilities' : p.inventory ? 'inventory' : 'level and abilities';
        if (action === 'overwrite') {
            if (!p.settings && p.hero !== s.hero) return;
            if (p.settings) {
                detail = 'Update this drill with your current session settings.';
                if (p.hero && p.hero === s.hero) detail += ' Also update ' + hero + '’s saved ' + parts + '.';
                else if (p.hero) {
                    detail += ' Keep the attached ' + hero + ' build.';
                    action = 'overwrite-drill-only';
                }
            } else detail = 'Update this build with ' + hero + '’s current ' + parts + '.';
            submit = 'Overwrite';
        } else if (p.settings) {
            detail = 'Replace the session settings. ';
            if (!p.hero) detail += 'Your equipped build stays the same.';
            else if (p.hero === s.hero) detail += 'Also load ' + hero + '’s ' + parts + '.';
            else detail += 'Switch to ' + hero + ' and load the saved ' + parts + '.';
            detail += '\n' + ParryTrainerProfileSummary(p);
            submit = p.hero ? 'Load drill and build' : 'Load drill';
        } else {
            detail = p.hero === s.hero ? 'Replace ' + hero + '’s ' + parts + '.' : 'Switch to ' + hero + ' and load the saved ' + parts + '.';
            submit = 'Load build';
        }
    } else if (action === 'delete') {
        title = 'Delete “' + p.name + '”?';
        detail = 'Remove this saved ' + (p.settings ? 'drill' : 'build') + ' from your library.';
        submit = 'Delete';
    } else if (action === 'import') {
        title = 'Replace trainer settings and library?';
        detail = 'Replace your current drill, saved drills and hero builds with the contents of backups/parry-trainer.json.';
        submit = 'Import backup';
    } else if (action === 'export') {
        title = 'Write a whole-trainer backup?';
        detail = 'Save your current drill, saved drills and hero builds to backups/parry-trainer.json, replacing any previous export.';
        submit = 'Export backup';
    } else return;
    ParryTrainerText(root, 'ParryTrainerProfileConfirmTitle', title);
    ParryTrainerText(root, 'ParryTrainerProfileConfirmDetail', detail);
    ParryTrainerText(root, 'ParryTrainerProfileConfirmLabel', submit);
    root.FindChildTraverse('ParryTrainerProfileConfirm').SetHasClass('PTDelete', action === 'delete');
    ParryTrainerProfileView('confirm', action, p ? p.id : '');
}
function ParryTrainerProfileProceed(drillOnly) {
    if (typeof ParryTrainerNativeBackupProceed === 'function' && ParryTrainerNativeBackupProceed()) return;
    var s = ParryTrainerProfiles;
    if (s.view !== 'confirm') return;
    if (drillOnly) {
        if (s.action === 'apply' && s.profiles.some(function (p) { return p.id === s.target && p.settings && p.hero; }))
            ParryTrainerProfileSend('drill-only', s.target);
    } else if (s.action === 'import') ParryTrainerProfileSend('import', 'confirm');
    else if (s.action === 'export') ParryTrainerProfileSend('export');
    else if (s.profiles.some(function (p) { return p.id === s.target; })) ParryTrainerProfileSend(s.action, s.target);
}
function ParryTrainerProfileControls(root) {
    var s = ParryTrainerProfiles, backup = s.section === 'backups', builds = s.section === 'builds';
    ['Drills', 'Builds', 'Backups'].forEach(function (name) {
        root.FindChildTraverse('ParryTrainerLibrary' + name).SetHasClass('Selected', name.toLowerCase() === s.section);
    });
    var add = root.FindChildTraverse('ParryTrainerProfileNew');
    add.visible = !backup;
    add.enabled = ParryTrainerCanProfile('save');
    ParryTrainerText(root, 'ParryTrainerProfileNewLabel', builds ? 'Save build' : 'Save drill');
    root.FindChildTraverse('ParryTrainerLibraryEntries').visible = !backup;
    root.FindChildTraverse('ParryTrainerLibraryBackup').visible = backup;
    root.FindChildTraverse('ParryTrainerProfileImport').enabled = ParryTrainerCanProfile('import');
    root.FindChildTraverse('ParryTrainerProfileExport').enabled = ParryTrainerCanProfile('export');
    var needsHero = false;
    s.actionButtons.forEach(function (row) {
        var wrongHero = row.action === 'overwrite' && !row.entry.settings && row.entry.hero !== s.hero;
        row.button.enabled = ParryTrainerCanProfile(row.action) && !wrongHero;
        needsHero = needsHero || wrongHero;
    });
    root.FindChildTraverse('ParryTrainerBuildHeroHint').visible = builds && needsHero;
    var empty = root.FindChildTraverse('ParryTrainerProfilesEmpty');
    empty.visible = !s.actionButtons.length;
    empty.text = ParryTrainerSaveError === 'offline' ? 'Account library unavailable.' : s.list === null ? 'Loading your library…' : s.list === '' ? 'Library unavailable. Open Backups to recover it.'
        : builds ? 'No saved hero builds yet.' : 'No saved drills yet.';
    ParryTrainerText(root, 'ParryTrainerProfileFeedback', s.feedback);
    root.SetHasClass('HasProfileFeedback', s.view === 'main' && Boolean(s.feedback) && (!s.feedbackSection || s.feedbackSection === s.section));
}
function ParryTrainerReceiveProfiles(root, field) {
    var s = ParryTrainerProfiles, hero = field('ProfileHero');
    if (hero !== s.hero) {
        if ((s.view === 'confirm' && ['apply', 'drill-only', 'overwrite', 'overwrite-drill-only'].indexOf(s.action) !== -1) ||
            (s.view === 'save' && s.action === 'save' && s.mask)) ParryTrainerProfileOverview();
        else if (s.view === 'save' && s.action === 'save') s.target = hero;
        s.hero = hero;
        ParryTrainerText(root, 'ParryTrainerProfileHero', ParryTrainerHeroes[hero] || hero || 'Waiting for hero…');
        ParryTrainerProfileParts();
    }
    var raw = field('ProfileList');
    if (!raw && !field('ProfileBusy')) return;
    var changed = s.list !== raw;
    if (changed) {
        var profiles;
        try { profiles = raw ? JSON.parse(raw) : []; } catch (_) { return; }
        if (!Array.isArray(profiles)) return;
        s.profiles = profiles.filter(function (p) {
            return p && /^[1-9][0-9]*$/.test(p.id) && (p.hero === '' || /^hero_[a-z0-9_]+$/.test(p.hero)) && typeof p.name === 'string';
        });
        s.list = raw;
        if (s.view === 'confirm' || (s.view === 'save' && s.action === 'rename')) ParryTrainerProfileOverview();
    }
    s.busy = field('ProfileBusy') === '1';
    var chosen = field('ProfileSelected');
    if ((s.pending === 'save' || s.pending === 'rename') && chosen && chosen !== '0') {
        var item = s.profiles.find(function (p) { return p.id === chosen; });
        if (item) { s.selected[item.settings ? item.id : item.hero] = item.id; changed = true; }
    }
    var reported = field('ProfileFeedback');
    if (s.pending && reported) s.feedback = reported;
    else if (!raw) { s.feedback = ParryTrainerSaveError === 'offline' ? '' : reported; s.feedbackSection = ''; }
    if (!s.busy) s.pending = '';
    var revision = field('ProfileRevision');
    if (revision && s.revision !== null && revision !== s.revision) ParryTrainerSetSettingsReady(root, false);
    s.revision = revision;
    if (changed) {
        ParryTrainerProfileRows(root);
        if (s.view === 'choose') ParryTrainerProfileChoose(s.target);
    } else ParryTrainerProfileControls(root);
}
