import assert from 'node:assert/strict';
import { parseTaskLine, parseTasks } from '../src/parser.js';
import { applyConfig, matchScenario } from '../src/core.js';
import { serializeTaskBody } from '../src/store.js';

// applyConfig with an explicit language: resolveLang falls back to window.localStorage
// (absent under Node) only when language is 'auto'
const configure = (extra = {}) => applyConfig({ language: 'uk', ...extra });

export const tests = {
    'daily note: inline >date is plain text (no inlineDate opt)'() {
        configure();
        const t = parseTaskLine('- [ ] Call the vet >2026-07-05 #home', 0);
        assert.equal(t.dateToken, null);
        assert.equal(t.text, 'Call the vet >2026-07-05');
    },
    'project file: >date extracted and stripped, attrs intact'() {
        configure();
        const t = parseTaskLine('- [ ] Ship >2026-07-05 #infra !high @work', 0, { inlineDate: true });
        assert.equal(t.dateToken, '2026-07-05');
        assert.equal(t.text, 'Ship');
        assert.deepEqual(t.tags, ['infra']);
        assert.equal(t.priority, 'high');
        assert.equal(t.group, 'work');
    },
    'project round-trip via serializeTaskBody'() {
        configure();
        const line = `- [ ] ${serializeTaskBody({ text: 'Ship', project: true, date: '2026-08-01', tags: [] })}`;
        const t = parseTaskLine(line, 0, { inlineDate: true });
        assert.equal(t.dateToken, '2026-08-01');
        assert.equal(t.text, 'Ship');
    },
    'mid-word > is not a date token'() {
        configure();
        assert.equal(parseTaskLine('- [ ] weird>2026-07-05 case', 0, { inlineDate: true }).dateToken, null);
    },
    'all 8 default status chars parse with correct behavior'() {
        configure();
        const cases = [[' ', 0, 0], ['x', 1, 0], ['-', 0, 1], ['/', 0, 0], ['>', 0, 1], ['<', 0, 0], ['!', 0, 0], ['?', 0, 0]];
        for (const [ch, done, cancelled] of cases) {
            const t = parseTaskLine(`- [${ch}] X`, 0);
            assert.equal(t.done, !!done, `char '${ch}' done`);
            assert.equal(t.cancelled, !!cancelled, `char '${ch}' cancelled`);
            assert.equal(t.statusChar, ch);
        }
    },
    'unknown status char degrades to active'() {
        configure();
        const t = parseTaskLine('- [~] X', 0);
        assert.ok(t && !t.done && !t.cancelled);
    },
    'timed events, subtasks, comments, descriptions'() {
        configure();
        const tasks = parseTasks([
            '- [/] 14:00-15:30 Parent #a ^tcd-abc123',
            '    - [>] Sub one',
            '    - just a comment',
            '',
            '## Parent ^tcd-abc123',
            'details here',
        ].join('\n'));
        const p = tasks[0];
        assert.equal(p.start, '14:00');
        assert.equal(p.end, '15:30');
        assert.equal(p.statusChar, '/');
        assert.equal(p.subtasks[0].cancelled, true);       // forwarded behaves as cancelled
        assert.equal(p.comments[0].text, 'just a comment');
        assert.equal(p.desc, 'details here');
    },
    'custom priority keys from settings are honoured'() {
        configure({ colors: { priorities: [{ key: 'p1', color: '#111' }, { key: 'p2', color: '#222' }] } });
        const t = parseTaskLine('- [ ] Task !p2', 0);
        assert.equal(t.priority, 'p2');
        assert.equal(t.text, 'Task');
        configure();   // restore defaults for other tests
    },
    'matchScenario: ordered, first match wins, nested folders'() {
        configure({ scenarios: [
            { id: 'a', folder: 'P/Web', mode: 'project' },
            { id: 'b', folder: 'P', mode: 'project' },
        ] });
        assert.equal(matchScenario('P/Web/t.md').id, 'a');
        assert.equal(matchScenario('P/Api/t.md').id, 'b');
        assert.equal(matchScenario('Daily/x.md'), null);
        configure();
    },
};
