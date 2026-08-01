// ─── Timeline grid (week / 3-day) with drag-move, resize & cross-day move ──────

import { WD_UA, addDays, dayOrder, mondayIdx, pad, t, timeMin, toISO, todayISO } from './core.js';
import { attachHoldDrag } from './gestures.js';
import { parseTasks } from './parser.js';
import { applyCardColor, completeTask, makeStatusCheckbox, materializeAndEdit, openStatusMenu, quickAdd } from './render.js';
import { addTask, getOrCreateDateFile, moveTaskToDay, rewriteTaskLine, setTaskStatus } from './store.js';
import { TaskEditorModal } from './task-editor-modal.js';

export const HOUR_PX = 50;                                   // pixels per hour
export let _tlDragTask = null;                               // untimed task being dragged from the all-day row

export function minToHHMM(min) { return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
export function snapStep(min, step) { return Math.round(min / step) * step; }
export function clampMin(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

export function renderTimeline(view, root, n) {
    const app = view.app;
    const settings = view.plugin.settings;
    const refresh = () => view.refresh();
    const map = view._map;
    const workStart = settings.workStart ?? 8;
    const workEnd = settings.workEnd ?? 20;
    const step = settings.snapMinutes || 15;
    const start = view.rangeStartDate();
    const todayStr = todayISO();

    const days = [];
    let minStart = Infinity, maxEnd = -Infinity;
    for (let i = 0; i < n; i++) {
        const day = addDays(start, i);
        const iso = toISO(day);
        const entry = map.get(iso);
        const tasks = entry ? entry.tasks.slice() : [];
        for (const t of tasks) {
            if (!t.start) continue;
            const s = timeMin(t.start);
            const e = t.end ? timeMin(t.end) : s + 60;
            if (s < minStart) minStart = s;
            if (e > maxEnd) maxEnd = e;
        }
        days.push({ day, iso, tasks });
    }

    // keep the current-time line visible even outside working hours
    if (days.some(d => d.iso === todayStr)) {
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        if (nowMin < minStart) minStart = nowMin;
        if (nowMin > maxEnd) maxEnd = nowMin;
    }

    // start from working hours, auto-FIT to tasks that fall outside, then honour manual expand
    let rangeStart = workStart;
    let rangeEnd = workEnd;
    if (minStart !== Infinity && minStart < rangeStart * 60) rangeStart = Math.floor(minStart / 60);
    if (maxEnd !== -Infinity && maxEnd > rangeEnd * 60) rangeEnd = Math.ceil(maxEnd / 60);
    if (view.showEarly) rangeStart = 0;
    if (view.showLate) rangeEnd = 24;
    rangeStart = Math.max(0, Math.min(rangeStart, workStart));
    rangeEnd = Math.min(24, Math.max(rangeEnd, workEnd));
    if (rangeStart >= rangeEnd) { rangeStart = 0; rangeEnd = 24; }
    const rangeStartMin = rangeStart * 60;
    const rangeEndMin = rangeEnd * 60;
    const gridH = (rangeEnd - rangeStart) * HOUR_PX;
    const ctx = { rangeStartMin, rangeEndMin, step, refresh, colorBy: settings.colorBy, priorityDot: settings.priorityDot };

    const wrap = root.createEl('div', { cls: 'tc-tl' });
    wrap.style.setProperty('--tc-col-count', String(n));

    const header = wrap.createEl('div', { cls: 'tc-tl-header' });
    header.createEl('div', { cls: 'tc-tl-corner' });
    for (const d of days) {
        const h = header.createEl('div', { cls: 'tc-tl-dayhead' });
        if (d.iso === todayStr) h.addClass('tc-col-today');
        h.createEl('span', { text: WD_UA[mondayIdx(d.day)], cls: 'tc-col-wd' });
        h.createEl('span', { text: `${pad(d.day.getDate())}.${pad(d.day.getMonth() + 1)}`, cls: 'tc-col-date' });
    }

    // all-day row (untimed tasks) — add button on top, then draggable task chips
    const allday = wrap.createEl('div', { cls: 'tc-tl-allday' });
    allday.createEl('div', { cls: 'tc-tl-axislabel', text: t('весь день') });
    for (const d of days) {
        const cell = allday.createEl('div', { cls: 'tc-tl-alldaycell' });
        quickAdd(app, cell, d.iso, refresh, t('+ задача'), settings);
        d.tasks.filter(t => !t.start).sort(dayOrder).forEach(t => {
            const w = renderAllDayChip(view, cell, t, ctx);
            if (!t.virtual && t.file) {
                w.setAttribute('draggable', 'true');
                w.addEventListener('dragstart', e => { _tlDragTask = t; e.dataTransfer.effectAllowed = 'move'; });
                w.addEventListener('dragend', () => { _tlDragTask = null; });
            }
        });
    }

    if (rangeStart > 0) {
        const s = wrap.createEl('div', { cls: 'tc-tl-strip' });
        s.createEl('span', { text: `▾ 00:00 – ${pad(rangeStart)}:00` });
        s.onclick = () => { view.showEarly = true; refresh(); };
    }

    const grid = wrap.createEl('div', { cls: 'tc-tl-grid' });
    grid.style.height = `${gridH}px`;

    const axis = grid.createEl('div', { cls: 'tc-tl-axis' });
    for (let h = rangeStart; h < rangeEnd; h++) {
        const hr = axis.createEl('div', { cls: 'tc-tl-hour' });
        hr.style.height = `${HOUR_PX}px`;
        hr.createEl('span', { text: `${pad(h)}:00` });
    }

    view._tlCols = [];
    for (const d of days) {
        const col = grid.createEl('div', { cls: 'tc-tl-col' });
        if (d.iso === todayStr) col.addClass('tc-col-today');
        view._tlCols.push({ iso: d.iso, el: col });

        for (let h = rangeStart; h < rangeEnd; h++) {
            col.createEl('div', { cls: 'tc-tl-hourline' }).style.height = `${HOUR_PX}px`;
        }

        const dIso = d.iso;
        bindGridCreate(col, dIso, ctx, view);
        // drop target for untimed tasks dragged from the all-day row
        col.addEventListener('dragover', e => { if (_tlDragTask) { e.preventDefault(); col.addClass('tc-tl-col-drop'); } });
        col.addEventListener('dragleave', () => col.removeClass('tc-tl-col-drop'));
        col.addEventListener('drop', async e => {
            e.preventDefault();
            col.removeClass('tc-tl-col-drop');
            const t = _tlDragTask;
            _tlDragTask = null;
            if (!t) return;
            const y = e.clientY - col.getBoundingClientRect().top;
            const min = clampMin(snapStep(rangeStartMin + y / HOUR_PX * 60, step), rangeStartMin, rangeEndMin - step);
            if (t.date === dIso) {
                t.start = minToHHMM(min); t.end = null;
                await rewriteTaskLine(app, t.file, t.line, t);
            } else {
                await moveTaskToDay(app, t, dIso, minToHHMM(min), null, settings);
            }
            refresh();
        });

        const evs = d.tasks.filter(t => t.start).map(t => ({
            t, sm: timeMin(t.start), em: t.end ? timeMin(t.end) : timeMin(t.start) + 15
        }));
        assignColumns(evs);
        for (const ev of evs) renderEventCard(view, col, ev.t, ctx, ev);
    }

    if (rangeEnd < 24) {
        const s = wrap.createEl('div', { cls: 'tc-tl-strip' });
        s.createEl('span', { text: `▴ ${pad(rangeEnd)}:00 – 24:00` });
        s.onclick = () => { view.showLate = true; refresh(); };
    }

    // current-time line — only when today is one of the shown days
    if (view._nowTimer) { clearInterval(view._nowTimer); view._nowTimer = null; }
    if (days.some(d => d.iso === todayStr)) {
        const nowLine = grid.createEl('div', { cls: 'tc-tl-now' });
        const place = () => {
            const m = new Date();
            const mm = m.getHours() * 60 + m.getMinutes();
            if (mm < rangeStartMin || mm > rangeEndMin) { nowLine.style.display = 'none'; return; }
            nowLine.style.display = '';
            nowLine.style.top = `${(mm - rangeStartMin) / 60 * HOUR_PX}px`;
        };
        place();
        view._nowTimer = window.setInterval(() => {
            if (!nowLine.isConnected) { clearInterval(view._nowTimer); view._nowTimer = null; return; }
            place();
        }, 60000);
    }
}

// Lay out time-overlapping events into side-by-side columns (mutates items: .col/.cols)
export function assignColumns(items) {
    items.sort((a, b) => a.sm - b.sm || a.em - b.em);
    let i = 0;
    while (i < items.length) {
        let j = i + 1;
        let clusterEnd = items[i].em;
        const cluster = [items[i]];
        while (j < items.length && items[j].sm < clusterEnd) {
            cluster.push(items[j]);
            clusterEnd = Math.max(clusterEnd, items[j].em);
            j++;
        }
        const colEnds = [];
        for (const ev of cluster) {
            let placed = false;
            for (let c = 0; c < colEnds.length; c++) {
                if (ev.sm >= colEnds[c]) { ev.col = c; colEnds[c] = ev.em; placed = true; break; }
            }
            if (!placed) { ev.col = colEnds.length; colEnds.push(ev.em); }
        }
        for (const ev of cluster) ev.cols = colEnds.length;
        i = j;
    }
}

// Create-on-empty-grid. Mouse: click → 60-min event, click-drag → time range (as before).
// Touch: HOLD (~450ms) arms the gesture first, then dragging sets the range — a plain
// pan over the grid just scrolls the week and never creates anything. Opens editor after.
export function bindGridCreate(col, dIso, ctx, view) {
    const isEmptyGrid = target => target === col || target.classList.contains('tc-tl-hourline');

    // one create-session: preview element + y→minutes math + final task creation
    const startSession = clientY0 => {
        const rect = col.getBoundingClientRect();
        const toMin = y => ctx.rangeStartMin + (y - rect.top) / HOUR_PX * 60;
        const preview = col.createEl('div', { cls: 'tc-tl-event tc-tl-preview' });
        const a = toMin(clientY0);
        let b = a, moved = false;
        const paint = () => {
            const lo = Math.min(a, b), hi = Math.max(a, b);
            preview.style.top = `${(lo - ctx.rangeStartMin) / 60 * HOUR_PX}px`;
            preview.style.height = `${Math.max((hi - lo) / 60 * HOUR_PX, 6)}px`;
        };
        paint();
        return {
            move(clientY) {
                b = toMin(clientY);
                if (Math.abs(b - a) > 4) moved = true;
                paint();
            },
            async finish() {
                preview.remove();
                let lo = clampMin(snapStep(Math.min(a, b), ctx.step), ctx.rangeStartMin, ctx.rangeEndMin - ctx.step);
                let hi = moved ? clampMin(snapStep(Math.max(a, b), ctx.step), lo + ctx.step, ctx.rangeEndMin) : lo + 60;
                hi = clampMin(hi, lo + ctx.step, ctx.rangeEndMin);
                const file = await getOrCreateDateFile(view.app, dIso);
                const lineNum = await addTask(view.app, file, `${minToHHMM(lo)}-${minToHHMM(hi)} ${t('Нова подія')}`, view.plugin.settings);
                // re-read just this file (not the whole vault) and locate the new task by its line
                const created = parseTasks(await view.app.vault.read(file)).find(x => x.line === lineNum);
                if (created) new TaskEditorModal(view.app, { ...created, file, date: dIso }, () => view.refresh(), view.plugin).open();
                else view.refresh();
            },
        };
    };

    // mouse/pen path — unchanged behavior (only touch goes through attachHoldDrag below,
    // so a stylus keeps the precise click-drag interaction rather than needing a hold)
    col.addEventListener('pointerdown', e => {
        if (e.pointerType === 'touch') return;
        if (e.button !== 0) return;
        if (!isEmptyGrid(e.target)) return;
        e.preventDefault();
        const session = startSession(e.clientY);
        const onMove = ev => session.move(ev.clientY);
        const onUp = async () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            await session.finish();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    });

    // touch path — hold to arm, then drag the range; release commits
    let session = null;
    attachHoldDrag(col, {
        accept: e => isEmptyGrid(e.target),
        onStart: (x, y) => { session = startSession(y); },
        onMove: (x, y) => { if (session) session.move(y); },
        onEnd: async () => {
            const s = session;
            session = null;
            if (s) await s.finish();
        },
    });
}

// All-day (untimed) task chip — same look as timed event cards (coloured, dashed for
// recurrences, no emoji, single line), but flows in the all-day row.
export function renderAllDayChip(view, cell, task, ctx) {
    const app = view.app;
    const card = cell.createEl('div', { cls: 'tc-tl-allday-card' });
    applyCardColor(card, task, ctx.colorBy, ctx.priorityDot);
    if (task.virtual) card.addClass('tc-virtual');
    if (task.recId && !task.virtual) card.addClass('tc-tl-recurring');   // dashed for materialized recurrences
    if (task.done) card.addClass('tc-tl-done');
    if (task.cancelled) card.addClass('tc-cancelled');

    const cb = makeStatusCheckbox(card, task, async checked => {
        await completeTask(app, task, checked, view.plugin.settings);
        ctx.refresh();
    }, 'tc-tl-cb');
    cb.addEventListener('click', e => e.stopPropagation());

    card.createEl('span', { cls: 'tc-tl-event-title', text: task.text || '(без назви)' });
    if (task.virtual || !task.file) card.onclick = () => materializeAndEdit(app, task, view.plugin.settings, ctx.refresh, view.plugin);
    else {
        card.onclick = () => new TaskEditorModal(app, task, () => view.refresh(), view.plugin).open();
        card.addEventListener('contextmenu', e => {
            e.preventDefault(); e.stopPropagation();
            openStatusMenu(e, task, async st => { await setTaskStatus(app, task.file, task.line, st.id); ctx.refresh(); });
        });
    }
    return card;
}

export function renderEventCard(view, col, task, ctx, layout) {
    const app = view.app;
    const sm = timeMin(task.start);
    const em = task.end ? timeMin(task.end) : sm + 15;     // no end → treat as a 15-min slot
    const pxPerMin = HOUR_PX / 60;
    const compact = (em - sm) <= 30;

    const card = col.createEl('div', { cls: compact ? 'tc-tl-event tc-tl-event-compact' : 'tc-tl-event' });
    card.style.top = `${(sm - ctx.rangeStartMin) * pxPerMin}px`;
    card.style.height = `${Math.max((em - sm) * pxPerMin, 20)}px`;
    if (layout && layout.cols > 1) {
        card.style.left = `calc(${(layout.col / layout.cols * 100).toFixed(4)}% + 1px)`;
        card.style.width = `calc(${(100 / layout.cols).toFixed(4)}% - 2px)`;
        card.style.right = 'auto';
    }
    applyCardColor(card, task, ctx.colorBy, ctx.priorityDot);
    if (task.virtual) card.addClass('tc-virtual');   // dashed only for not-yet-materialized recurrences
    if (task.recId && !task.virtual) card.addClass('tc-tl-recurring');
    if (task.done) card.addClass('tc-tl-done');
    if (task.cancelled) card.addClass('tc-cancelled');

    // checkbox (timed tasks; no subtask cascade — a timed card completes only itself)
    const cb = makeStatusCheckbox(card, task, async checked => {
        await completeTask(app, task, checked, view.plugin.settings, false);
        ctx.refresh();
    }, 'tc-tl-cb');
    cb.addEventListener('pointerdown', e => e.stopPropagation());
    cb.addEventListener('click', e => e.stopPropagation());

    const body = card.createEl('div', { cls: compact ? 'tc-tl-event-body tc-tl-event-body-row' : 'tc-tl-event-body' });
    const tag = compact ? 'span' : 'div';
    body.createEl(tag, { cls: 'tc-tl-event-title', text: task.text || '(без назви)' });
    card._timeEl = body.createEl(tag, {
        cls: 'tc-tl-event-time',
        text: task.end ? `${task.start}–${task.end}` : task.start
    });

    if (task.virtual || !task.file) {
        card.addClass('tc-tl-event-virtual');
        card.onclick = () => materializeAndEdit(app, task, view.plugin.settings, ctx.refresh, view.plugin);
        return;
    }

    card.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        openStatusMenu(e, task, async st => { await setTaskStatus(app, task.file, task.line, st.id); ctx.refresh(); });
    });

    const topH = card.createEl('div', { cls: 'tc-tl-handle tc-tl-handle-top' });
    const botH = card.createEl('div', { cls: 'tc-tl-handle tc-tl-handle-bottom' });
    bindTimelineDrag(card, card, task, view, ctx, 'move');
    bindTimelineDrag(topH, card, task, view, ctx, 'resize-top');
    bindTimelineDrag(botH, card, task, view, ctx, 'resize-bottom');
}

export function bindTimelineDrag(handleEl, card, task, view, ctx, mode) {
    const pxPerMin = HOUR_PX / 60;
    handleEl.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;   // права/середня кнопка — не перетягування
        e.preventDefault();
        e.stopPropagation();
        const startY = e.clientY;
        const origStart = timeMin(task.start);
        const origEnd = task.end ? timeMin(task.end) : origStart + 60;
        const hadEnd = task.end != null;
        const dur = origEnd - origStart;
        let moved = false;
        let ns = origStart, ne = origEnd;
        let targetIso = task.date;

        const paint = () => {
            card.style.top = `${(ns - ctx.rangeStartMin) * pxPerMin}px`;
            card.style.height = `${Math.max((ne - ns) * pxPerMin, 30)}px`;
            if (card._timeEl) {
                const showEnd = mode !== 'move' || hadEnd;
                card._timeEl.textContent = showEnd ? `${minToHHMM(ns)}–${minToHHMM(ne)}` : minToHHMM(ns);
            }
        };

        const onMove = ev => {
            if (Math.abs(ev.clientY - startY) > 3) moved = true;
            const d = snapStep((ev.clientY - startY) / pxPerMin, ctx.step);
            if (mode === 'move') { ns = clampMin(origStart + d, ctx.rangeStartMin, ctx.rangeEndMin - dur); ne = ns + dur; }
            else if (mode === 'resize-top') { ns = clampMin(origStart + d, ctx.rangeStartMin, origEnd - ctx.step); ne = origEnd; }
            else { ne = clampMin(origEnd + d, origStart + ctx.step, ctx.rangeEndMin); ns = origStart; }

            // horizontal: move across day columns (move mode only)
            if (mode === 'move' && view._tlCols) {
                for (const c of view._tlCols) {
                    const r = c.el.getBoundingClientRect();
                    if (ev.clientX >= r.left && ev.clientX < r.right) {
                        if (c.iso !== targetIso) { targetIso = c.iso; c.el.appendChild(card); moved = true; }
                        break;
                    }
                }
            }
            paint();
        };

        const onUp = async () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            if (!moved) {
                if (mode === 'move') new TaskEditorModal(view.app, task, () => view.refresh(), view.plugin).open();
                return;
            }
            const start = minToHHMM(ns);
            const end = (mode === 'move') ? (hadEnd ? minToHHMM(ne) : null) : minToHHMM(ne);
            if (mode === 'move' && targetIso !== task.date) {
                await moveTaskToDay(view.app, task, targetIso, start, end, view.plugin.settings);
            } else {
                task.start = start; task.end = end;
                await rewriteTaskLine(view.app, task.file, task.line, task);
            }
            view.refresh();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    });
}
