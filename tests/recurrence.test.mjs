import assert from 'node:assert/strict';
import { applyConfig, occursOn, parseISO } from '../src/core.js';

const configure = (extra = {}) => applyConfig({ language: 'uk', firstDayOfWeek: 1, ...extra });
const on = (rule, iso) => occursOn(rule, parseISO(iso));

export const tests = {
    'daily with interval'() {
        configure();
        const r = { freq: 'daily', interval: 3, start: '2026-07-01' };
        assert.ok(on(r, '2026-07-01'));
        assert.ok(!on(r, '2026-07-02'));
        assert.ok(on(r, '2026-07-04'));
        assert.ok(!on(r, '2026-06-30'), 'never before start');
    },
    'weekly on chosen weekdays'() {
        configure();
        const r = { freq: 'weekly', interval: 1, start: '2026-07-01', weekdays: [0, 4] };   // Mon, Fri
        assert.ok(on(r, '2026-07-06'), 'Monday');
        assert.ok(on(r, '2026-07-03'), 'Friday');
        assert.ok(!on(r, '2026-07-07'), 'Tuesday');
    },
    'biweekly respects week parity'() {
        configure();
        const r = { freq: 'weekly', interval: 2, start: '2026-07-01', weekdays: [2] };   // Wednesdays
        assert.ok(on(r, '2026-07-01'));
        assert.ok(!on(r, '2026-07-08'), 'off week');
        assert.ok(on(r, '2026-07-15'));
    },
    'monthly by day clamps to short months'() {
        configure();
        const r = { freq: 'monthly', interval: 1, start: '2026-01-31', monthMode: 'day', monthday: 31 };
        assert.ok(on(r, '2026-01-31'));
        assert.ok(on(r, '2026-02-28'), 'Feb clamps 31 -> 28');
        assert.ok(!on(r, '2026-02-27'));
        assert.ok(on(r, '2026-03-31'));
    },
    'monthly nth weekday (2nd Tuesday)'() {
        configure();
        const r = { freq: 'monthly', interval: 1, start: '2026-07-01', monthMode: 'weekday', nth: 2, weekday: 1 };
        assert.ok(on(r, '2026-07-14'), '2nd Tuesday of July 2026');
        assert.ok(!on(r, '2026-07-07'), '1st Tuesday');
    },
    'monthly last working day'() {
        configure();
        const r = { freq: 'monthly', interval: 1, start: '2026-07-01', monthMode: 'workday', which: 'last' };
        assert.ok(on(r, '2026-07-31'), 'Jul 31 2026 is a Friday');
        assert.ok(on(r, '2026-08-31'), 'Aug 31 2026 is a Monday');
        assert.ok(!on(r, '2026-08-30'), 'Sunday');
    },
    'yearly legacy rule (no monthMode) keeps exact date'() {
        configure();
        const r = { freq: 'yearly', interval: 1, start: '2026-03-08' };
        assert.ok(on(r, '2027-03-08'));
        assert.ok(!on(r, '2027-03-09'));
        assert.ok(!on(r, '2027-04-08'));
    },
    'end date stops the rule'() {
        configure();
        const r = { freq: 'daily', interval: 1, start: '2026-07-01', end: '2026-07-03' };
        assert.ok(on(r, '2026-07-03'));
        assert.ok(!on(r, '2026-07-04'));
    },
};
