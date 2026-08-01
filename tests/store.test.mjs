import assert from 'node:assert/strict';
import { applyConfig } from '../src/core.js';
import { loadAllTasks, invalidateTaskCache, queueFileEdit, insertLineUnderHeading } from '../src/store.js';

const configure = (extra = {}) => applyConfig({ language: 'uk', ...extra });

// Mock vault: daily notes at the root (default daily-notes config kicks in because
// app.internalPlugins is absent → getDailyNotesConfig falls back to YYYY-MM-DD).
function mockApp(files) {
    let reads = 0;
    const app = {
        vault: {
            getMarkdownFiles: () => files,
            read: async f => { reads++; return f.content; },
            modify: async (f, next) => { f.content = next; },
        },
    };
    return { app, readCount: () => reads };
}
const mdFile = (path, content, mtime = 1000) => ({ path, content, stat: { mtime, size: content.length } });

export const tests = {
    async 'loadAllTasks merges daily + project tasks and buckets undated ones'() {
        configure({ scenarios: [{ id: 'p', folder: 'Projects', mode: 'project' }] });
        invalidateTaskCache();
        const { app } = mockApp([
            mdFile('2026-07-05.md', '- [ ] Daily task A'),
            mdFile('Projects/site.md', '- [ ] Ship >2026-07-05\n- [ ] Fix >2026-08-01\n- [ ] Backlog item'),
        ]);
        const map = await loadAllTasks(app);
        assert.equal(map.get('2026-07-05').tasks.length, 2);
        assert.ok(map.get('2026-07-05').tasks.some(t => t.text === 'Daily task A' && !t.project));
        assert.ok(map.get('2026-07-05').tasks.some(t => t.text === 'Ship' && t.project));
        assert.equal(map.get('2026-08-01').tasks.length, 1);
        assert.equal(map.get('__undated:Projects/site.md').tasks[0].text, 'Backlog item');
        configure();
    },
    async 'parse cache: unchanged files are not re-read; touched files are'() {
        configure();
        invalidateTaskCache();
        const files = [mdFile('2026-07-05.md', '- [ ] A'), mdFile('2026-07-06.md', '- [ ] B')];
        const { app, readCount } = mockApp(files);
        await loadAllTasks(app);
        assert.equal(readCount(), 2);
        await loadAllTasks(app);
        assert.equal(readCount(), 2, 'second load must hit the cache');
        files[0].stat.mtime = 2000;   // simulate an edit
        await loadAllTasks(app);
        assert.equal(readCount(), 3, 'only the touched file is re-read');
    },
    async 'parse cache: invalidateTaskCache(path) forces one re-read'() {
        configure();
        invalidateTaskCache();
        const files = [mdFile('2026-07-05.md', '- [ ] A')];
        const { app, readCount } = mockApp(files);
        await loadAllTasks(app);
        invalidateTaskCache('2026-07-05.md');
        await loadAllTasks(app);
        assert.equal(readCount(), 2);
    },
    async 'insertLineUnderHeading returns the exact line the task landed on'() {
        // materializeAndEdit relies on this to open the editor right after a virtual
        // recurrence is written — a wrong line number would silently open nothing
        configure();
        const file = mdFile('2026-07-07.md', '# Note\n\nintro text\n\n## Задачі\n- [ ] existing');
        const app = {
            vault: {
                read: async () => file.content,
                modify: async (f, next) => { file.content = next; },
            },
        };
        const settings = { headingLevel: 2, headingText: 'Задачі' };
        const line = await insertLineUnderHeading(app, file, '- [ ] the new one', settings);
        assert.equal(file.content.split('\n')[line], '- [ ] the new one');
    },
    async 'queueFileEdit serializes concurrent edits to the same file'() {
        const file = mdFile('2026-07-05.md', 'line0');
        let reads = 0;
        const app = {
            vault: {
                // deliberately slow first read so a naive implementation would interleave
                read: async () => { reads++; await new Promise(r => setTimeout(r, reads === 1 ? 20 : 0)); return file.content; },
                modify: async (f, next) => { file.content = next; },
            },
        };
        await Promise.all([
            queueFileEdit(app, file, lines => { lines.push('first'); }),
            queueFileEdit(app, file, lines => { lines.push('second'); }),
        ]);
        assert.equal(file.content, 'line0\nfirst\nsecond', 'both edits must survive');
    },
};
