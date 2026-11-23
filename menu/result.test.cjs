const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function resultHud() {
    const labels = { ParryTrainerVictoryLabel: {}, ParryTrainerDefeatLabel: {} };
    const classes = new Set();
    const visual = {
        FindChildTraverse: id => labels[id],
        SetHasClass(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
    };
    const host = { visible: false, FindChildTraverse: id => id === 'ParryTrainerResultVisual' && visual };
    const popups = new Map(), popupEvents = [], focused = new Set();
    const manager = { Children: () => [...popups.values()], FindChildTraverse: id => popups.get(id) };
    const root = { IsValid: () => true, GetParent: () => null, BHasClass: name => focused.has(name),
        FindChildTraverse: id => id === 'ParryTrainerResultHost' ? host : id === 'PopupManager' ? manager : undefined };
    const sounds = [], timers = new Map();
    let nextId = 0;
    const hud = vm.createContext({
        ParryTrainerScore: {}, ParryTrainerSettingsReady: true,
        ParryTrainerRenderScore(panel, values) { panel.values = values; },
        $: {
            DispatchEvent(event, command) {
                if (event === 'UIShowCustomLayoutPopup') {
                    assert.ok(!popups.has(command));
                    const panel = { id: command, paneltype: 'PopupCustomLayout', IsValid: () => popups.has(command),
                        FindChildTraverse: () => ({}) };
                    popups.set(command, panel);
                    popupEvents.push('open');
                    return;
                }
                if (event === 'UIPopupButtonClicked') {
                    assert.ok(popups.delete(command.id));
                    popupEvents.push('close');
                    return;
                }
                assert.equal(event, 'CitadelConCommand');
                assert.match(command, /^parry_trainer_result_audio (win|lose|stop)$/);
                sounds.push(command.split(' ')[1]);
            },
            Schedule(seconds, callback) { timers.set(++nextId, { seconds, callback }); return nextId; },
            CancelScheduled(id) { assert.equal(timers.delete(id), true); }
        }
    });
    for (const file of ['result-audio.js', 'result.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), hud);
    }
    return { hud, root, host, classes, labels, sounds, timers, popups, popupEvents, focused };
}

test('the matching retail wipe, label and sound share a display window of at most two seconds', () => {
    for (const outcome of ['victory', 'defeat']) {
        const { hud, root, host, classes, labels, sounds, timers } = resultHud();
        hud.ParryTrainerShowResult(root, outcome);
        assert.equal(host.visible, true);
        assert.ok(classes.has('MatchFinished'));
        assert.equal(classes.has('Team1Victory'), outcome === 'victory');
        assert.equal(classes.has('Team2Victory'), outcome === 'defeat');
        assert.equal(labels.ParryTrainerVictoryLabel.visible, outcome === 'victory');
        assert.equal(labels.ParryTrainerDefeatLabel.visible, outcome === 'defeat');
        const sound = outcome === 'victory' ? 'win' : 'lose';
        assert.deepEqual(sounds, [sound]);
        const [[id, timeout]] = timers;
        assert.ok(timeout.seconds > 0 && timeout.seconds <= 2);
        timers.delete(id);
        timeout.callback();
        assert.equal(host.visible, false);
        assert.equal(classes.has('MatchFinished'), false);
        assert.deepEqual(sounds, [sound, 'stop']);
    }
});

test('an early restart or replacement cancels the previous result and pending dismissal', () => {
    const { hud, root, host, sounds, timers } = resultHud();
    hud.ParryTrainerShowResult(root, 'ended');
    assert.equal(host.visible, false);
    assert.deepEqual(sounds, []);
    hud.ParryTrainerShowResult(root, 'victory');
    const victoryTimer = [...timers.keys()][0];
    hud.ParryTrainerShowResult(root, 'defeat');
    assert.equal(timers.has(victoryTimer), false);
    assert.equal(timers.size, 1);
    hud.ParryTrainerClearResult(root);
    assert.equal(host.visible, false);
    assert.equal(timers.size, 0);
    hud.ParryTrainerClearResult(root);
    assert.deepEqual(sounds, ['win', 'stop', 'lose', 'stop']);
});

test('recap waits for shop, displays frozen rows once, and releases the popup on reset', () => {
    const { hud, root, timers, popups, popupEvents, focused } = resultHud();
    const values = { Parries: '8', Hits: '3', Accuracy: '67%', Status: 'Victory', Elapsed: 'Elapsed  0:25' };
    focused.add('gShopOpen');
    hud.ParryTrainerShowResult(root, 'victory', values, 7);
    const [[id, timer]] = timers;
    timers.delete(id);
    timer.callback();
    assert.equal(popups.size, 0);
    focused.clear();
    focused.add('gItemDraftOpen');
    hud.ParryTrainerUpdateRecap(root);
    assert.equal(popups.size, 0);
    focused.clear();
    hud.ParryTrainerUpdateRecap(root);
    const popup = popups.get('ParryTrainerRunSummary7');
    assert.deepEqual(popup.values, values);
    hud.ParryTrainerUpdateRecap(root);
    assert.deepEqual(popupEvents, ['open']);
    hud.ParryTrainerClearResult(root);
    assert.deepEqual(popupEvents, ['open', 'close']);
    assert.equal(hud.ParryTrainerScore.followResult, false);
});

test('user dismissal is permanent across subsequent polls for the run', () => {
    const { hud, root, timers, popups, popupEvents } = resultHud();
    hud.ParryTrainerShowResult(root, 'defeat', {}, 8);
    const [[id, timer]] = timers;
    timers.delete(id);
    timer.callback();
    popups.clear(); // The native Close button or Escape disposed of this popup.
    hud.ParryTrainerUpdateRecap(root);
    hud.ParryTrainerUpdateRecap(root);
    assert.deepEqual(popupEvents, ['open']);
    assert.equal(hud.ParryTrainerScore.followResult, false);
});

test('the score popup and audio survive a missing stock end-animation layout', () => {
    const { hud, root, host, timers, popups, sounds } = resultHud();
    host.FindChildTraverse = () => undefined;
    hud.ParryTrainerShowResult(root, 'victory', { Status: 'Victory', Hits: '0' }, 9);
    assert.equal(host.visible, false);
    const [[id, timer]] = timers;
    timers.delete(id);
    timer.callback();
    assert.equal(popups.get('ParryTrainerRunSummary9').values.Status, 'Victory');
    assert.deepEqual(sounds, ['win', 'stop']);
});
