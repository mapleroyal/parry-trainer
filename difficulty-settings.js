// Shared by the game server and Panorama. Midpoint values are the factory setup.
var presetFormatVersion = '6';
// Finish choices and opponent identities are the same at every preset level.
/** @type {Record<string, string>} */
var drillDefaults = { hero1: 'random', hero2: 'random', limit_mode: 'none', timer: '300', parries: '10', souls: '0' };
var percentRange = [0, 100];
var meleeSettingKeys = ['melee_min', 'melee_max', 'melee_bias'];
var intervalSettingKeys = ['interval_min', 'interval_max', 'interval_bias'];
var presetNumbers = {
    melee_min: percentRange, melee_max: percentRange, melee_bias: percentRange,
    interval_min: percentRange, interval_max: percentRange, interval_bias: percentRange, trooper_speed: [10, 100], trooper_count: [1, 4],
    camp_tier: [1, 3], hit_limit: [1, 9999], idle_rate: [15, 50]
};
var soulPenaltyKeys = ['penalty_hit', 'penalty_unparried', 'penalty_whiff'];
var presetSwitches = ['effects', 'parried', 'stamina', 'cooldown', 'second', 'troopers',
    'trooper_active', 'camps', 'camp_reactive', 'death', 'fail_on_death', 'fail_on_hits', 'idle_drain'].concat(soulPenaltyKeys);
var presetSettingKeys = Object.keys(presetNumbers).concat(presetSwitches);

function isPresetSetting(key) { return presetSettingKeys.indexOf(key) !== -1; }

function soleSoulSource(troopers, camps) {
    if (troopers && !camps) return 'troopers';
    if (camps && !troopers) return 'camps';
}

function needsSoulSource(goal, secured, getSetting) {
    return goal > 0 && (secured < goal || soulPenaltyKeys.some(getSetting));
}

/** @param {number} position @param {string} [version] */
function presetValues(position, version) {
    var aboveNormal = Math.max(0, position - 50);
    // Easiest 5–6 s, Normal 1–6 s, Hardest 1–2 s. Version 5's
    // saved partial configurations inherit defaults on the old 1.9–6 s scale.
    var intervalSlope = version === '5' ? 1.5 : 1.6;
    // Stop at 16% of the range at level 99. Only Hardest opens the final stretch to point blank.
    var minimum = position > 50 && position < 100 ? 50 - Math.round(34 * aboveNormal / 49) : 100 - position;
    return {
        melee_min: minimum, melee_max: 100, melee_bias: Math.min(50, 100 - position),
        interval_min: Math.round(intervalSlope * Math.max(0, 50 - position)),
        interval_max: 100 - Math.round(intervalSlope * aboveNormal),
        interval_bias: 75 - Math.round(position / 2),
        trooper_speed: position < 50 ? Math.round(10 + position * 0.8) : position,
        trooper_count: 1 + Math.round(3 * Math.max(0, position - 60) / 40),
        camp_tier: position >= 92 ? 3 : position >= 78 ? 2 : 1,
        hit_limit: position < 50 ? 3 + Math.round((50 - position) / 10) : 3 - Math.floor(aboveNormal / 25),
        effects: position <= 30, parried: position === 0,
        stamina: position < 68, cooldown: position >= 75, second: position >= 82,
        troopers: position >= 55, trooper_active: position >= 65,
        camps: position >= 70, camp_reactive: position >= 35,
        // The sources of lethal damage are independent of the consequence of dying.
        death: position >= 90, fail_on_death: position === 100, fail_on_hits: position >= 85,
        penalty_hit: position >= 70, penalty_unparried: position >= 85, penalty_whiff: position === 100,
        idle_drain: position > 0,
        idle_rate: position <= 50 ? 15 + Math.round(Math.max(0, position - 1) * 10 / 49)
                                 : 25 + Math.round(aboveNormal / 2)
    };
}

// Migrated timing bounds can fall between slider ticks. Two decimal places
// preserve every millisecond of the previous 41 ms step. Other controls use integers.
function presetValue(key, value) {
    if (presetSwitches.indexOf(key) !== -1) {
        if (value === true || value === 1 || value === '1') return true;
        if (value === false || value === 0 || value === '0') return false;
    } else {
        var range = key === 'preset' || key === 'difficulty' ? percentRange : presetNumbers[key];
        var numeric = key === 'interval_min' || key === 'interval_max'
            ? /^(0|[1-9]\d{0,2})(\.\d{1,2})?$/ : /^(0|[1-9]\d{0,3})$/;
        if (!range || !numeric.test(String(value))) return undefined;
        var n = Number(value);
        if (n >= range[0] && n <= range[1]) return n;
    }
    return undefined;
}

/** @param {(key: string, value: number|boolean) => void} [onChange] */
function createPresetSettings(onChange) {
    var position = 50;
    var defaults = presetValues(position);
    var effective = Object.assign({}, defaults);

    function applyDefaults() {
        var previous = effective;
        effective = Object.assign({}, defaults);
        if (onChange) presetSettingKeys.forEach(function (key) {
            if (effective[key] !== previous[key]) onChange(key, effective[key]);
        });
    }
    function restoreValue(key, raw) {
        if (!isPresetSetting(key)) return;
        var value = presetValue(key, raw);
        if (value !== undefined) effective[key] = value;
    }
    function restoreOldDistance(raw) {
        var distance = presetValue('difficulty', raw);
        // Full saved drills used to spell out even unchanged template values.
        if (typeof distance !== 'number' || distance === position) return;
        effective.melee_min = distance === 0 ? 100 : 0;
        effective.melee_max = distance === 100 ? 0 : 100;
        // The old slider encoded the mean. The weighted sampler's mean fraction is 1/4 + bias/2.
        effective.melee_bias = distance === 0 || distance === 100 ? 50 : Math.max(0, Math.min(100, 150 - 2 * distance));
    }
    function restoreOldValue(key, raw) {
        if (key === 'difficulty') restoreOldDistance(raw);
        else restoreValue(key, raw);
    }
    function restoreOldPreset(entries) {
        // At the old slider's endpoints only edge edits were active.
        var endpoint = position === 0 || position === 100;
        entries.forEach(function (pair) {
            var match = /^(manual|edge)_([a-z_]+)$/.exec(pair[0]);
            if (!match || (endpoint && match[1] !== 'edge')) return;
            var key = match[2], raw = pair[1];
            if (key === 'death_mode' && /^[012]$/.test(raw)) {
                effective.death = raw !== '0';
                effective.fail_on_death = raw === '2';
            } else restoreOldValue(key === 'fail_on_idle' ? 'idle_drain' : key, raw);
        });
    }
    function restoreLegacy(entries) {
        // The previous "difficulty" was melee distance with two temporary endpoint
        // presets. Replay it in order to recover the choices the player last saw.
        var old = {};
        var base = { effects: false, cooldown: false, death: false, fail_on_death: false,
            trooper_active: false, camp_reactive: true };
        var auto = {}, distance = 50;
        entries.forEach(function (pair) {
            var key = pair[0] === 'fail_on_idle' ? 'idle_drain' : pair[0];
            var v = presetValue(key, pair[1]);
            if (v === undefined || (key !== 'difficulty' && !isPresetSetting(key))) return;
            if (key === 'difficulty') {
                if (v !== distance) {
                    distance = v;
                    auto = v === 0 ? { effects: true, trooper_active: false, camp_reactive: false } :
                        v === 100 ? { cooldown: true, death: true, fail_on_death: true, trooper_active: true, camp_reactive: true } : {};
                }
            } else if (Object.prototype.hasOwnProperty.call(base, key)) {
                base[key] = v;
                delete auto[key];
            } else old[key] = v;
        });
        Object.assign(old, base, auto);
        restoreOldDistance(distance);
        old.death = old.death || old.fail_on_death;
        Object.assign(effective, old);
    }

    return {
        get preset() { return position; },
        get: function (key) { return effective[key]; },
        customized: function () {
            return presetSettingKeys.some(function (key) { return effective[key] !== defaults[key]; });
        },
        setPreset: function (value) {
            var n = presetValue('preset', value);
            if (typeof n !== 'number') return false;
            position = n;
            defaults = presetValues(position);
            applyDefaults();
            return true;
        },
        setPreference: function (key, value) {
            if (!isPresetSetting(key)) return false;
            var v = presetValue(key, value);
            if (v === undefined) return false;
            if (key === 'melee_min' || key === 'interval_min') v = Math.min(v, effective[key.replace('_min', '_max')]);
            if (key === 'melee_max' || key === 'interval_max') v = Math.max(v, effective[key.replace('_max', '_min')]);
            if (effective[key] !== v) {
                effective[key] = v;
                if (onChange) onChange(key, v);
            }
            return true;
        },
        reapply: applyDefaults,
        restore: function (saved) {
            var entries = saved.split(',').map(function (item) { return item.split('='); })
                .filter(function (pair) { return pair.length === 2; });
            var master = entries.find(function (pair) { return pair[0] === 'preset'; });
            var format = entries.find(function (pair) { return pair[0] === 'version'; });
            var version = format && format[1];
            var n = master && presetValue('preset', master[1]);
            position = typeof n === 'number' ? n : 50;
            defaults = presetValues(position);
            var savedDefaults = version === '5' ? presetValues(position, version) : defaults;
            effective = Object.assign({}, savedDefaults);
            if (!entries.length) return; // Fresh setup and Reset always use the current Normal.
            // Older drills never charged a soul penalty, even on their hardest presets.
            if (['3', '4', '5', presetFormatVersion].indexOf(version) === -1)
                soulPenaltyKeys.forEach(function (key) { effective[key] = false; });
            // Before interval controls, all drills used the full 1.9–6 s range.
            if (version !== '5' && version !== presetFormatVersion) {
                effective.interval_min = 18;
                effective.interval_max = 100;
                effective.interval_bias = 50;
            }
            if (!master) restoreLegacy(entries);
            else if (version === '4' || version === '5' || version === presetFormatVersion) {
                // Restore both bounds before comparing them so order never clips a valid range.
                entries.forEach(function (pair) { restoreValue(pair[0], pair[1]); });
                if (effective.melee_min > effective.melee_max) {
                    effective.melee_min = defaults.melee_min;
                    effective.melee_max = defaults.melee_max;
                }
                if (effective.interval_min > effective.interval_max) {
                    effective.interval_min = savedDefaults.interval_min;
                    effective.interval_max = savedDefaults.interval_max;
                }
            } else if (version === '2' || version === '3')
                entries.forEach(function (pair) { restoreOldValue(pair[0], pair[1]); });
            else restoreOldPreset(entries);
            if (version === '5') {
                // Old seconds = 1.9 + 0.041p. Express that exact wait on the 1–6 s slider.
                effective.interval_min = (1800 + 82 * effective.interval_min) / 100;
                effective.interval_max = (1800 + 82 * effective.interval_max) / 100;
            }
        },
        snapshot: function () {
            var entries = ['preset=' + position, 'version=' + presetFormatVersion];
            presetSettingKeys.forEach(function (key) {
                if (effective[key] !== defaults[key]) entries.push(key + '=' + Number(effective[key]));
            });
            return entries;
        }
    };
}

if (typeof module !== 'undefined') module.exports = {
    drillDefaults: drillDefaults, meleeSettingKeys: meleeSettingKeys, intervalSettingKeys: intervalSettingKeys, createPresetSettings: createPresetSettings, isPresetSetting: isPresetSetting, presetSettingKeys: presetSettingKeys,
    soleSoulSource: soleSoulSource, needsSoulSource: needsSoulSource, presetValue: presetValue, presetValues: presetValues, presetFormatVersion: presetFormatVersion
};
