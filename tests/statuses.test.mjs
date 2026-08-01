import assert from 'node:assert/strict';
import { applyConfig, statusForChar, charForStatusId, taskMark, DEFAULT_CHECKBOX_STATUSES } from '../src/core.js';
import { setCheckbox, syncParent } from '../src/store.js';

const configure = (extra = {}) => applyConfig({ language: 'uk', ...extra });

export const tests = {
    'charForStatusId resolves configured and legacy ids'() {
        configure();
        assert.equal(charForStatusId('done'), 'x');
        assert.equal(charForStatusId('cancelled'), '-');
        assert.equal(charForStatusId('todo'), ' ');
        assert.equal(charForStatusId('in-progress'), '/');
        assert.equal(charForStatusId('no-such-id'), ' ');
    },
    'statusForChar degrades gracefully when a status was removed'() {
        configure({ checkboxStatuses: DEFAULT_CHECKBOX_STATUSES.filter(s => s.id !== 'in-progress') });
        const st = statusForChar('/');
        assert.equal(st.behavior, 'active');   // unknown char → open task, not done/cancelled
        assert.equal(statusForChar('x').behavior, 'done');
        configure();
    },
    'taskMark prefers exact statusChar, falls back to trio'() {
        assert.equal(taskMark({ statusChar: '/', done: false, cancelled: false }), '/');
        assert.equal(taskMark({ done: true, cancelled: false }), 'x');
        assert.equal(taskMark({ done: false, cancelled: true }), '-');
        assert.equal(taskMark({ done: false, cancelled: false }), ' ');
    },
    'plain click overwrites any custom mark with the binary pair'() {
        assert.equal(setCheckbox('- [/] Task', true), '- [x] Task');
        assert.equal(setCheckbox('- [>] Task', false), '- [ ] Task');
    },
    'syncParent: in-progress sub keeps parent open'() {
        configure();
        const lines = ['- [ ] Parent', '    - [x] A', '    - [/] B'];
        syncParent(lines, 0);
        assert.equal(lines[0], '- [ ] Parent');
    },
    'syncParent: cancelled-behavior subs excluded from the count'() {
        configure();
        const lines = ['- [ ] Parent', '    - [x] A', '    - [>] B forwarded'];
        syncParent(lines, 0);
        assert.equal(lines[0], '- [x] Parent');
    },
};
