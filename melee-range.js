// The Opponents slider runs from one to six seconds between windups.
function intervalMilliseconds(percent) { return 1000 + 50 * percent; }

// Feet-to-feet start distance for a stock, unupgraded heavy from rest, with
// forward and melee pressed together. On build 6864 the farthest ground
// headings hit at 529.4 Source units; 529.5 missed (tests/melee-distance.ts).
var meleeRange = {
    closest: 10,
    farthest: 529.4,
    /** Position favored by the bias, on the same scale as the two bounds. */
    favored: function (minimum, maximum, bias) { return minimum + (maximum - minimum) * bias / 100; },
    /** Draw from a range whose probability density peaks at its favored marker. */
    samplePercent: function (minimum, maximum, bias, roll) {
        if (minimum === maximum) return minimum;
        var peak = bias / 100;
        // Inverse CDF of a two-sided cubic power distribution.
        var fraction = roll < peak || peak === 1
            ? peak * Math.cbrt(roll / peak)
            : 1 - (1 - peak) * Math.cbrt((1 - roll) / (1 - peak));
        return minimum + (maximum - minimum) * fraction;
    },
    seconds: function (percent) { return intervalMilliseconds(percent) / 1000; },
    formatSeconds: function (percent) { return Math.round(intervalMilliseconds(percent) / 10) / 100 + ' s'; },
    interval: function (minimum, maximum, bias, roll) {
        // Reserve one roll in forty for each end. A six-second pause can still
        // occur, and a centered marker gives equal weight to short and long gaps.
        var middle = Math.max(0, Math.min(1, (roll * 40 - 1) / 38));
        return this.seconds(this.samplePercent(minimum, maximum, bias, middle));
    },
    /** @param {number} percent Physical position from closest (0) to farthest (100). */
    units: function (percent) { return this.closest + (this.farthest - this.closest) * percent / 100; },
    /** @param {number} percent */
    metres: function (percent) { return this.units(percent) * 0.0254; },
    /** Keep the HUD readout and the number on its world-space ring identical. */
    formatUnits: function (units) {
        var metres = units * 0.0254;
        return metres.toFixed(metres < 1 ? 2 : 1) + ' m';
    }
};

if (typeof module !== 'undefined') module.exports = { meleeRange: meleeRange };
