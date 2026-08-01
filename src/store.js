// ─── Vault helpers ───────────────────────────────────────────────────────────

import * as obsidian from 'obsidian';
import { SCENARIOS, charForStatusId, dateToPath, ensureFolders, escapeRe, fileToDate, genId, getDailyNotesConfig, matchScenario, parseISO, priorityKeys, readTemplate, statusForChar, t, taskMark, toISO } from './core.js';
import { CHILD_INDENT, findDescription, parseTasks } from './parser.js';

export function getDateFiles(app) {
    const { folder, format } = getDailyNotesConfig(app);
    return app.vault.getMarkdownFiles()
        .map(f => {
            const d = fileToDate(f, folder, format);
            return d ? { file: f, date: toISO(d) } : null;
        })
        .filter(Boolean);
}

// ─── Parse cache ─────────────────────────────────────────────────────────────
// Every view refresh used to re-read and re-parse EVERY relevant file in the vault.
// Parsed results are cached per path and validated against the file's mtime+size
// (available synchronously on TFile.stat — no disk IO), so an unchanged file costs
// zero reads. `mode` guards against a folder switching between daily/project parsing.
// Invalidated per-path on vault events, and wholesale on settings changes (priority
// keys and scenarios feed the parser, so any of them changing stales every entry).
export const _parseCache = new Map();   // path -> { mtime, size, mode, tasks }

export function invalidateTaskCache(path) {
    if (path) _parseCache.delete(path);
    else _parseCache.clear();
}

export async function parseFileCached(app, file, mode) {
    const st = file.stat || {};
    const hit = _parseCache.get(file.path);
    if (hit && hit.mtime === st.mtime && hit.size === st.size && hit.mode === mode) return hit.tasks;
    const content = await app.vault.read(file);
    const tasks = parseTasks(content, mode === 'project' ? { inlineDate: true } : undefined);
    _parseCache.set(file.path, { mtime: st.mtime, size: st.size, mode, tasks });
    return tasks;
}

// dateStr(ISO) -> { file, tasks }; undated project tasks key off `__undated:<path>` instead
// (never looked up by iso-keyed views like the calendar grid, but still picked up by anything
// that iterates map.values(), e.g. the list view's flat pool).
export async function loadAllTasks(app) {
    const map = new Map();
    const claimed = new Set();   // vault paths owned by a 'project' scenario, excluded from daily parsing

    if (SCENARIOS.length) {
        for (const file of app.vault.getMarkdownFiles()) {
            const sc = matchScenario(file.path);
            if (!sc) continue;
            claimed.add(file.path);
            for (const raw of await parseFileCached(app, file, 'project')) {
                const t = { ...raw, date: raw.dateToken, file, project: true };
                const key = t.date || `__undated:${file.path}`;
                if (map.has(key)) map.get(key).tasks.push(t);
                else map.set(key, { file, tasks: [t] });
            }
        }
    }

    for (const { file, date } of getDateFiles(app)) {
        if (claimed.has(file.path)) continue;
        const tasks = (await parseFileCached(app, file, 'daily')).map(t => ({ ...t, file, date }));
        if (map.has(date)) map.get(date).tasks.push(...tasks);
        else map.set(date, { file, tasks });
    }
    return map;
}

export async function getOrCreateDateFile(app, isoDate) {
    const cfg = getDailyNotesConfig(app);
    const date = parseISO(isoDate);
    const path = dateToPath(app, date);
    let f = app.vault.getAbstractFileByPath(path);
    if (!f) {
        await ensureFolders(app, path);
        const tpl = await readTemplate(app, cfg.template, date, cfg.format);
        f = await app.vault.create(path, tpl != null ? tpl : '');
    }
    return f;
}

// Ask before creating a day file that doesn't exist yet (guards accidental clicks)
export function confirmCreate(app, isoDate) {
    return new Promise(resolve => new ConfirmModal(app, `${t('Створити нотатку на ')}${isoDate}?`, resolve).open());
}

// Open a day's note; if it doesn't exist, confirm before creating
export async function openDay(app, isoDate) {
    const existing = app.vault.getAbstractFileByPath(dateToPath(app, parseISO(isoDate)));
    if (existing) {
        app.workspace.getLeaf().openFile(existing);
        return;
    }
    if (!(await confirmCreate(app, isoDate))) return;
    const f = await getOrCreateDateFile(app, isoDate);
    app.workspace.getLeaf().openFile(f);
}

export class ConfirmModal extends obsidian.Modal {
    constructor(app, message, resolve) {
        super(app);
        this.message = message;
        this.resolve = resolve;
        this.decided = false;
    }
    finish(val) {
        if (this.decided) return;
        this.decided = true;
        this.resolve(val);
        this.close();
    }
    onOpen() {
        this.contentEl.createEl('p', { text: this.message });
        const btns = this.contentEl.createEl('div', { cls: 'tc-modal-btns' });
        btns.createEl('button', { text: t('Скасувати') }).onclick = () => this.finish(false);
        btns.createEl('button', { text: t('Створити'), cls: 'mod-cta' }).onclick = () => this.finish(true);
    }
    onClose() {
        this.contentEl.empty();
        this.finish(false);   // dismissed via Esc / click-outside
    }
}

// ─── Per-file write queue ────────────────────────────────────────────────────
// All task/note mutations below go through this instead of calling
// app.vault.read()/modify() directly. Every mutator used to do its own
// independent read → mutate → write; two edits landing close together on the
// same file (e.g. two quick checkbox toggles, or a debounced editor autosave
// racing a click elsewhere) could each read the pre-edit content and the
// second write would silently overwrite the first. Queuing per file path
// serializes read-modify-write cycles so that never happens. As a side
// benefit, a write is skipped entirely when editFn doesn't actually change
// anything (fewer redundant vault 'modify' events for other views to react to).
export const _fileWriteQueues = new Map();   // file.path -> Promise (tail of that file's queue)

export function queueFileEdit(app, file, editFn) {
    const prev = _fileWriteQueues.get(file.path) || Promise.resolve();
    const run = prev.then(async () => {
        const content = await app.vault.read(file);
        const lines = content.split('\n');
        const result = await editFn(lines);
        const next = lines.join('\n');
        if (next !== content) await app.vault.modify(file, next);
        return result;
    });
    const tail = run.catch(() => {});   // keep the chain alive past a failed edit
    _fileWriteQueues.set(file.path, tail);
    // drop the entry once this queue drains, so the map doesn't grow with every file ever touched
    tail.then(() => { if (_fileWriteQueues.get(file.path) === tail) _fileWriteQueues.delete(file.path); });
    return run;
}

// Plain checkbox click always toggles the binary todo/done pair, regardless of how many
// custom statuses are configured — richer statuses (in-progress, forwarded, …) are only
// reachable through setTaskStatus (right-click menu / task editor), never a plain click.
export function setCheckbox(line, done) {
    return line.replace(/^(\s*)- \[.\]/, done ? '$1- [x]' : '$1- [ ]');
}

// Set a task line's status mark from a configured status id (falls back to the 3 built-in
// literals 'done'/'cancelled'/'todo' if that id was renamed or removed from settings).
export async function setTaskStatus(app, file, lineNum, statusId) {
    return queueFileEdit(app, file, lines => {
        lines[lineNum] = lines[lineNum].replace(/^(\s*)- \[.\]/, `$1- [${charForStatusId(statusId)}]`);
    });
}

export async function toggleTask(app, file, lineNum, done) {
    return queueFileEdit(app, file, lines => {
        lines[lineNum] = setCheckbox(lines[lineNum], done);
    });
}

// Toggle a parent and cascade the same state to all its subtasks
export async function toggleTaskCascade(app, file, task, done) {
    return queueFileEdit(app, file, lines => {
        lines[task.line] = setCheckbox(lines[task.line], done);
        for (const s of task.subtasks) lines[s.line] = setCheckbox(lines[s.line], done);
    });
}

// Recompute parent checkbox from its subtasks (all done → [x]; otherwise → [ ]).
// Cancelled-behavior subtasks are excluded from the count (as before); any other
// non-done status (in-progress, forwarded, …) counts toward the total but not toward done,
// same as a plain todo — it just doesn't check the parent off.
export function syncParent(lines, parentLineNum) {
    let total = 0, done = 0;
    for (let i = parentLineNum + 1; i < lines.length; i++) {
        const cb = lines[i].match(/^(\s+)- \[(.)\] /);
        if (cb) {
            const behavior = statusForChar(cb[2]).behavior;
            if (behavior === 'cancelled') continue;
            total++;
            if (behavior === 'done') done++;
            continue;
        }
        if (lines[i].trim() === '') continue;          // blank inside block
        if (/^\s+- /.test(lines[i])) continue;         // indented comment
        break;                                          // top-level content → end of children
    }
    if (total === 0) return;
    lines[parentLineNum] = setCheckbox(lines[parentLineNum], done === total);
}

// Toggle a subtask and re-sync the parent's checkbox
export async function toggleSubtask(app, file, parentLineNum, subLineNum, done) {
    return queueFileEdit(app, file, lines => {
        lines[subLineNum] = setCheckbox(lines[subLineNum], done);
        syncParent(lines, parentLineNum);
    });
}

// Insert an indented child line (subtask or comment) after the parent's existing children
export async function addChild(app, file, parentTask, childLine) {
    return queueFileEdit(app, file, lines => {
        let insertAt = parentTask.line + 1;
        for (let i = parentTask.line + 1; i < lines.length; i++) {
            if (/^\s+- /.test(lines[i])) insertAt = i + 1;
            else if (lines[i].trim() === '') continue;
            else break;
        }
        lines.splice(insertAt, 0, CHILD_INDENT + childLine);
        syncParent(lines, parentTask.line);
    });
}

// Rebuild a task line body from its fields (canonical order: time, text, >date (project only), tags, !prio, @group)
export function serializeTaskBody(t) {
    const parts = [];
    if (t.start) parts.push(t.end ? `${t.start}-${t.end}` : t.start);
    if (t.text) parts.push(t.text);
    if (t.project && t.date) parts.push(`>${t.date}`);
    for (const tag of (t.tags || [])) parts.push(`#${tag}`);
    if (t.priority) parts.push(`!${t.priority}`);
    if (t.group) parts.push(`@${t.group}`);
    return parts.join(' ');
}

export function taskMarkers(task) {
    return (task.recId ? ` ^rc-${task.recId}` : '') + (task.descId ? ` ^tcd-${task.descId}` : '');
}

// Rewrite a single task line from a (possibly edited) task object, preserving indent + block markers
export async function rewriteTaskLine(app, file, lineNum, task) {
    return queueFileEdit(app, file, lines => {
        const indent = (lines[lineNum].match(/^(\s*)/) || ['', ''])[1];
        const mark = taskMark(task);
        lines[lineNum] = `${indent}- [${mark}] ${serializeTaskBody(task)}${taskMarkers(task)}`;
    });
}

// Create / update / remove a task's free-form description (heading one level below the tasks heading)
export async function setDescription(app, file, task, text, settings) {
    text = (text || '').trim();
    const level = Math.min(6, settings.headingLevel + 1);

    return queueFileEdit(app, file, lines => {
        if (task.descId) {
            const d = findDescription(lines, task.descId);
            if (text === '') {
                if (d) lines.splice(d.headingLine, d.endLine - d.headingLine);
                lines[task.line] = lines[task.line].replace(/\s+\^tcd-[A-Za-z0-9]+/, '');
                task.descId = null;
                return;
            }
            if (d) {
                lines.splice(d.headingLine, d.endLine - d.headingLine, lines[d.headingLine], ...text.split('\n'));
                return;
            }
        }

        if (text === '') return;
        const id = task.descId || genId();
        task.descId = id;
        if (!new RegExp(`\\^tcd-${id}\\b`).test(lines[task.line])) {
            lines[task.line] = lines[task.line].replace(/\s*$/, '') + ` ^tcd-${id}`;
        }
        if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
        lines.push(`${'#'.repeat(level)} ${task.text} ^tcd-${id}`, ...text.split('\n'));
    });
}

// Existing tag names (from Obsidian) and group names (known to the plugin) for autocomplete
export function collectTags(app) {
    const tg = (app.metadataCache.getTags && app.metadataCache.getTags()) || {};
    return Object.keys(tg).map(k => k.replace(/^#/, '')).sort();
}
export async function collectGroups(app, settings) {
    const set = new Set();
    (settings.colors.groups || []).forEach(g => g.name && set.add(g.name));
    const map = await loadAllTasks(app);
    for (const { tasks } of map.values()) for (const t of tasks) if (t.group) set.add(t.group);
    return [...set].sort();
}

// Remove a subtask line and re-sync its parent's checkbox
export async function removeSubtask(app, file, parentLine, subLine) {
    return queueFileEdit(app, file, lines => {
        lines.splice(subLine, 1);
        syncParent(lines, parentLine);   // parentLine < subLine → index still valid
    });
}

// Remove a top-level task together with its indented children
export async function removeTaskBlock(app, file, task) {
    return queueFileEdit(app, file, lines => {
        let end = task.line + 1;
        while (end < lines.length && /^\s+- /.test(lines[end])) end++;
        lines.splice(task.line, end - task.line);
    });
}

// Append default tag/group/priority (from settings) when the text doesn't already specify them
export function applyDefaults(text, settings) {
    if (!settings) return text;
    let out = text;
    if (settings.defaultTag && !/#[^\s#]+/.test(out)) out += ` #${settings.defaultTag}`;
    if (settings.defaultGroup && !/@[^\s]+/.test(out)) out += ` @${settings.defaultGroup}`;
    const pAlt = priorityKeys.map(escapeRe).join('|') || 'x^';
    if (settings.defaultPriority && !new RegExp(`!(${pAlt})\\b`).test(out)) out += ` !${settings.defaultPriority}`;
    return out;
}

export async function addTask(app, file, text, settings) {
    return insertBlockUnderHeading(app, file, [`- [ ] ${applyDefaults(text, settings)}`], settings);
}

export async function insertLineUnderHeading(app, file, taskLine, settings) {
    return insertBlockUnderHeading(app, file, [taskLine], settings);
}

// Insert one or more lines (a task + its indented children) under the configured heading
export async function insertBlockUnderHeading(app, file, blockLines, settings) {
    const level = settings.headingLevel;
    const headingText = settings.headingText;
    const headingLine = `${'#'.repeat(level)} ${headingText}`;

    return queueFileEdit(app, file, lines => {
        let idx = -1;
        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(/^(#{1,6})\s+(.*?)\s*$/);
            if (m && m[1].length === level && m[2].toLowerCase() === headingText.toLowerCase()) { idx = i; break; }
        }

        let insertedAt;
        if (idx === -1) {
            if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
            lines.push(headingLine, ...blockLines);
            insertedAt = lines.length - blockLines.length;
        } else {
            let end = lines.length;
            for (let i = idx + 1; i < lines.length; i++) {
                const m = lines[i].match(/^(#{1,6})\s+/);
                if (m && m[1].length <= level) { end = i; break; }
            }
            // after the last top-level task in the section…
            let insertAt = idx + 1;
            for (let i = idx + 1; i < end; i++) {
                if (/^\s*- \[.\]/.test(lines[i]) && /^\S/.test(lines[i])) insertAt = i + 1;
            }
            // …and past that task's indented children
            while (insertAt < end && /^\s+- /.test(lines[insertAt])) insertAt++;
            lines.splice(insertAt, 0, ...blockLines);
            insertedAt = insertAt;
        }
        return insertedAt;
    });
}

// Move a task (with its children) to another day's note, updating its time.
// Project-scenario tasks have no "home" day file to move between — their date is just the
// inline >date token — so this rewrites the line in place instead of relocating it.
export async function moveTaskToDay(app, task, destISO, newStart, newEnd, settings) {
    if (task.project) {
        const updated = { ...task, date: destISO, start: newStart, end: newEnd };
        await rewriteTaskLine(app, task.file, task.line, updated);
        return { file: task.file, line: task.line };
    }

    const srcFile = task.file;

    const block = await queueFileEdit(app, srcFile, lines => {
        let end = task.line + 1;
        while (end < lines.length && /^\s+- /.test(lines[end])) end++;
        const blk = lines.slice(task.line, end);

        const indent = (blk[0].match(/^(\s*)/) || ['', ''])[1];
        const marker = taskMarkers(task);
        const mark = taskMark(task);
        const updated = { ...task, start: newStart, end: newEnd };
        blk[0] = `${indent}- [${mark}] ${serializeTaskBody(updated)}${marker}`;

        lines.splice(task.line, end - task.line);
        return blk;
    });

    const destFile = await getOrCreateDateFile(app, destISO);
    const line = await insertBlockUnderHeading(app, destFile, block, settings);
    return { file: destFile, line };
}
