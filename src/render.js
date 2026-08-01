// ─── Shared rendering ────────────────────────────────────────────────────────

import * as obsidian from 'obsidian';
import { COLORS, STATUSES, cardColor, materializeVirtual, pad, parseISO, prioColor, statusForChar, t, taskMark } from './core.js';
import { HabitCompleteModal, makeRing } from './habits-view.js';
import { attachLongPress, attachSwipeComplete } from './gestures.js';
import { parseTasks } from './parser.js';
import { addTask, getOrCreateDateFile, setTaskStatus, toggleTask, toggleTaskCascade } from './store.js';
import { TaskEditorModal } from './task-editor-modal.js';

// Plain standard checkbox
export function makeCheckbox(parent, checked, onChange, cls) {
    const input = parent.createEl('input', cls ? { cls } : {});
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => { if (onChange) onChange(input.checked); });
    return input;
}

// Checkbox that renders a built-in icon instead of a check/dash for anything other than
// plain todo/done: cancelled-behavior statuses (✕ by default) and custom "active" statuses
// (in-progress, forwarded, …) so they stay visually distinct from a plain todo instead of
// silently looking unchecked. Icons come from Obsidian's bundled Lucide set via
// obsidian.setIcon, so this looks right with zero themes/community CSS installed; a status
// with no icon configured just shows its raw character instead. Clicking either completes the task.
export function makeStatusCheckbox(parent, task, onChange, cls) {
    const st = statusForChar(taskMark(task));
    const isCustom = st.behavior === 'cancelled' || (st.behavior === 'active' && st.id && st.id !== 'todo');
    if (isCustom) {
        const boxCls = st.behavior === 'cancelled' ? 'tc-xbox' : 'tc-statusbox';
        const box = parent.createEl('span', { cls: cls ? `${boxCls} ${cls}` : boxCls });
        if (st.icon) obsidian.setIcon(box, st.icon);
        else box.setText(st.char.trim() ? st.char : '✕');
        box.setAttribute('aria-label', t(st.label));
        box.addEventListener('click', e => { e.stopPropagation(); onChange(true); });
        return box;
    }
    return makeCheckbox(parent, task.done, onChange, cls);
}

// Complete/uncomplete a task from any view's checkbox. Virtual recurrence instances have
// no real line yet, so they materialize into the day note instead; parents cascade the
// state to their subtasks unless the caller opts out (timed event cards don't cascade).
export async function completeTask(app, task, checked, settings, cascade = true) {
    if (task.virtual) return materializeVirtual(app, task, checked, settings);
    if (cascade && task.subtasks && task.subtasks.length) return toggleTaskCascade(app, task.file, task, checked);
    return toggleTask(app, task.file, task.line, checked);
}

// Click on a virtual recurrence instance: materialize it AND open the editor on the
// freshly written line in one go. (It used to only materialize + refresh, so the editor
// opened on the second click, once the task had become real.)
export async function materializeAndEdit(app, task, settings, refresh, plugin) {
    const { file, line } = await materializeVirtual(app, task, false, settings);
    const created = parseTasks(await app.vault.read(file)).find(x => x.line === line);
    await refresh();
    if (created) new TaskEditorModal(app, { ...created, file, date: task.date }, refresh, plugin).open();
}

// Status menu at the pointer position. `e` only needs clientX/clientY, so it works for
// real mouse events and for the synthesized coordinates of a mobile long-press alike.
export function openStatusMenu(e, task, onPick) {
    const menu = new obsidian.Menu();
    const current = taskMark(task);
    for (const st of STATUSES) {
        menu.addItem(i => {
            i.setTitle(st.icon ? t(st.label) : `${st.char.trim() ? st.char : '·'}  ${t(st.label)}`)
                .setChecked(current === st.char)
                .onClick(() => onPick(st));
            if (st.icon) i.setIcon(st.icon);
        });
    }
    menu.showAtPosition({ x: e.clientX, y: e.clientY });
}

// Tint a badge/chip with a user-configured color. JS only supplies the raw color via
// the `--chip` custom property — CSS derives a soft translucent background and a text
// color blended toward the theme's normal text, so any user color stays readable in
// both light and dark themes (the old inline `color: #fff` was unreadable on pastels).
export function tintBadge(el, color) {
    if (!color) return;
    el.addClass('tc-tinted');
    el.style.setProperty('--chip', color);
}

// Tint a calendar card (month bar / timeline event) per colorBy + optional priority dot.
// Same pattern: JS supplies `--card-color`, the tint formula lives in CSS.
export function applyCardColor(el, task, colorBy, priorityDot) {
    const base = cardColor(task, colorBy);
    if (base) {
        el.addClass('tc-colored');
        el.style.setProperty('--card-color', base);
    }
    if (priorityDot && colorBy !== 'priority' && task.priority) {
        el.createEl('span', { cls: 'tc-prio-dot' }).style.background = prioColor(task.priority);
    }
}

export function renderBadges(container, task, s) {
    s = s || {};
    if (task.priority && s.showPriority !== false) {
        const b = container.createEl('span', { text: task.priority, cls: 'tc-badge' });
        tintBadge(b, prioColor(task.priority));
    }
    if (task.group && s.showGroups !== false) {
        const b = container.createEl('span', { text: `@${task.group}`, cls: 'tc-badge tc-group' });
        tintBadge(b, COLORS.groups[task.group]);
    }
    if (s.showTags !== false) {
        for (const tag of task.tags) {
            const b = container.createEl('span', { text: `#${tag}`, cls: 'tc-badge tc-tag' });
            tintBadge(b, COLORS.tags[tag]);
        }
    }
}

// A flat task row. The whole card opens the editor; no inline expand (subtasks/comments live in the editor).
export function renderTaskRow(app, container, task, refresh, opts = {}) {
    const s = opts.settings || {};
    const wrapper = container.createEl('div', { cls: 'tc-item' });
    const row = wrapper.createEl('div', { cls: 'tc-row' });
    if (task.priority) row.style.setProperty('--card-color', prioColor(task.priority));
    if (task.start) row.addClass('tc-event');
    if (task.virtual) row.addClass('tc-virtual');
    if (task.recId || task.virtual) row.addClass('tc-recurring');   // recurring = dashed only (no emoji)
    if (task.done) row.addClass('tc-row-done');
    if (task.cancelled) row.addClass('tc-cancelled');

    const subs = task.subtasks || [];

    const cb = makeStatusCheckbox(row, task, async checked => {
        await completeTask(app, task, checked, s);
        await refresh();
    }, 'tc-cb');
    cb.onclick = e => e.stopPropagation();

    // right-click / long-press → status menu; swipe right → toggle done (real tasks only)
    if (!task.virtual && task.file) {
        const statusMenu = async e => openStatusMenu(e, task, async st => { await setTaskStatus(app, task.file, task.line, st.id); await refresh(); });
        row.addEventListener('contextmenu', e => { e.preventDefault(); statusMenu(e); });
        attachLongPress(row, statusMenu);
        attachSwipeComplete(row, async () => { await completeTask(app, task, !task.done, s); await refresh(); });
    }

    const main = row.createEl('div', { cls: 'tc-row-main' });
    const top = main.createEl('div', { cls: 'tc-row-top' });
    top.createEl('span', { text: task.text || '(порожня задача)', cls: 'tc-label' });

    // right cluster: subtask progress ring (left of the date) + date/time
    const right = top.createEl('span', { cls: 'tc-row-right' });
    if (subs.length) {
        const done = subs.filter(x => x.done).length;
        const ring = makeRing(right, done / subs.length, 'var(--interactive-accent)', { size: 16, stroke: 2.5 });
        ring.addClass('tc-subprog');
        ring.setAttribute('aria-label', `${done}/${subs.length}`);
    }
    if (opts.overdue && task.date) {
        const d = parseISO(task.date);
        right.createEl('span', { text: `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`, cls: 'tc-date-chip tc-overdue-date' });
    } else {
        if (opts.showDate && task.date) right.createEl('span', { text: task.date, cls: 'tc-date-chip' });
        if (task.start) right.createEl('span', { text: task.end ? `${task.start}–${task.end}` : task.start, cls: 'tc-time' });
    }

    renderBadges(main.createEl('div', { cls: 'tc-badges' }), task, s);

    if (opts.showDetails && task.desc) main.createEl('div', { text: task.desc, cls: 'tc-desc-preview' });

    // whole card → editor (real tasks); virtual → materialize first
    row.addClass('tc-clickable');
    if (!task.virtual && task.file) {
        row.onclick = () => new TaskEditorModal(app, task, refresh, opts.plugin).open();
    } else if (task.virtual) {
        row.onclick = () => materializeAndEdit(app, task, s, refresh, opts.plugin);
    }

    return wrapper;
}

// Horizontal strip of today's habits (tap → completion modal). All habits are shown;
// completed ones are dimmed. Names hide on narrow panes (CSS) leaving only the icon.
export function renderHabitStrip(app, container, habits, vals, iso, onDone) {
    const list = habits.filter(h => !h.auto);
    if (!list.length) return false;
    const strip = container.createEl('div', { cls: 'tc-habit-strip' });
    for (const h of list) {
        const b = strip.createEl('button', { cls: vals[h.id] > 0 ? 'tc-habit-chip is-done' : 'tc-habit-chip' });
        if (h.color) b.style.setProperty('--hc', h.color);
        b.createSpan({ text: h.emoji || '•', cls: 'tc-habit-chip-emoji' });
        b.createSpan({ text: h.name, cls: 'tc-habit-chip-name' });
        b.onclick = () => new HabitCompleteModal(app, h, iso, onDone).open();
    }
    return true;
}

export function quickAdd(app, container, dateStr, refresh, placeholder, settings) {
    const wrap = container.createEl('div', { cls: 'tc-add-row' });
    const input = wrap.createEl('input', { cls: 'tc-input' });
    input.type = 'text';
    input.placeholder = placeholder || 'Нова задача...';

    const doAdd = async () => {
        const text = input.value.trim();
        if (!text) return;
        const file = await getOrCreateDateFile(app, dateStr);
        await addTask(app, file, text, settings);
        await refresh();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
    return wrap;
}
