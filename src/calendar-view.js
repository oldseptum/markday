// ─── Calendar View ───────────────────────────────────────────────────────────

import * as obsidian from 'obsidian';
import { CAL_VIEW, MONTHS_UA, addDays, addVirtuals, cardColor, compactMode, dayOrder, humanDate, monthGridDays, startOfWeek, startOfWorkWeek, t, toISO, todayISO, weekdayHeaders } from './core.js';
import { attachSwipeNav } from './gestures.js';
import { TaskCreateModal, renderTaskComposer } from './quick-create.js';
import { applyCardColor, completeTask, makeStatusCheckbox, materializeAndEdit, openStatusMenu, quickAdd, renderTaskRow } from './render.js';
import { loadAllTasks, openDay, setTaskStatus } from './store.js';
import { TaskEditorModal } from './task-editor-modal.js';
import { renderTimeline } from './timeline.js';

export const CAL_MODES = [['month', 'Місяць'], ['week', 'Тиждень'], ['workweek', 'Робочий тиждень'], ['3day', '3 дні']];
export const COLOR_OPTS = [['priority', 'Колір: пріоритет'], ['tag', 'Колір: тег'], ['group', 'Колір: група'], ['none', 'Без кольору']];

export class CalendarView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.mode = 'month';        // month | agenda | week | workweek | 3day
        this.anchor = new Date();
        this.expanded = new Set();
        this.selectedDate = todayISO();
        this.showEarly = false;
        this.showLate = false;
        this.filter = null;
    }

    getViewType() { return CAL_VIEW; }
    getDisplayText() { return t('Календар'); }
    getIcon() { return 'calendar'; }

    async onOpen() { await this.refresh(); }

    isMonthish() { return this.mode === 'month'; }
    isOverview() { return this.mode === 'month' && ((this.containerEl.children[1] && this.containerEl.children[1].clientWidth) || 9999) < 1250; }
    resetOffHours() { this.showEarly = false; this.showLate = false; }
    dayCount() { return this.mode === 'week' ? 7 : this.mode === 'workweek' ? 5 : 3; }
    rangeStartDate() { return this.mode === 'workweek' ? startOfWorkWeek(this.anchor) : this.mode === 'week' ? startOfWeek(this.anchor) : this.anchor; }

    shift(dir) {
        if (this.isMonthish()) {
            this.anchor = new Date(this.anchor.getFullYear(), this.anchor.getMonth() + dir, 1);
        } else {
            this.anchor = addDays(this.anchor, dir * (this.mode === '3day' ? 3 : 7));
        }
        this.resetOffHours();
        this.refresh();
    }

    setMode(m) { this.mode = m; this.resetOffHours(); this.refresh(); }
    goToday() { this.anchor = new Date(); this.selectedDate = todayISO(); this.resetOffHours(); this.refresh(); }

    visibleRange() {
        if (this.isMonthish()) {
            const start = startOfWeek(new Date(this.anchor.getFullYear(), this.anchor.getMonth(), 1));
            return [toISO(start), toISO(addDays(start, 41))];
        }
        const start = this.rangeStartDate();
        return [toISO(start), toISO(addDays(start, this.dayCount() - 1))];
    }

    matchFilter(t) {
        const f = this.filter;
        if (!f) return true;
        if (f.kind === 'tag') return (t.tags || []).includes(f.value);
        if (f.kind === 'group') return t.group === f.value;
        return t.priority === f.value;
    }

    onResize() {
        const c = compactMode(this);
        const ov = this.isOverview();
        if (c !== this._lastCompact || ov !== this._overview) { this.refresh(); return; }
        // height-only resize (e.g. window made shorter): re-render the month so the
        // "+N" overflow trimming is recomputed for the new (smaller) cell heights
        if (this.mode === 'month') {
            clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => this.refresh(), 120);
        }
    }

    async refresh() {
        const mobile = compactMode(this);
        this._lastCompact = mobile;
        const map = await loadAllTasks(this.app);
        const [s, e] = this.visibleRange();
        addVirtuals(map, this.plugin.settings.recurrences, s, e);

        this._filterOpts = { tags: new Set(), groups: new Set(), priorities: new Set() };
        for (const { tasks } of map.values()) for (const t of tasks) {
            (t.tags || []).forEach(x => this._filterOpts.tags.add(x));
            if (t.group) this._filterOpts.groups.add(t.group);
            if (t.priority) this._filterOpts.priorities.add(t.priority);
        }
        if (this.filter) for (const entry of map.values()) entry.tasks = entry.tasks.filter(t => this.matchFilter(t));

        const root = this.containerEl.children[1];
        root.empty();
        root.addClass('tc-pane', 'tc-cal-pane');
        const overview = this.isOverview();
        this._overview = overview;
        root.toggleClass('tc-cal-fill', this.mode === 'month' && !overview);

        this.renderHeader(root, mobile);
        if (this.mode === 'month') { if (overview) this.renderOverview(root, map); else this.renderMonth(root, map, mobile); }
        else { this._map = map; renderTimeline(this, root, this.dayCount()); }
    }

    renderHeader(root, mobile) {
        const s = this.plugin.settings;
        const bar = root.createEl('div', { cls: 'tc-cal-header' });

        if (mobile) {
            const modeBtn = bar.createEl('button', { cls: 'clickable-icon' });
            obsidian.setIcon(modeBtn, 'layout-grid');
            modeBtn.setAttribute('aria-label', t('Режим'));
            modeBtn.onclick = e => this.modeMenu(e);

            const title = bar.createEl('div', { text: this.titleText(), cls: 'tc-cal-title' });
            title.onclick = () => this.goToday();

            const right = bar.createEl('div', { cls: 'tc-cal-controls' });
            const prev = right.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(prev, 'chevron-left'); prev.onclick = () => this.shift(-1);
            const next = right.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(next, 'chevron-right'); next.onclick = () => this.shift(1);
            const more = right.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(more, 'more-horizontal');
            if (this.filter) more.addClass('is-active');
            more.onclick = e => this.mobileMenu(e);
            return;
        }

        bar.createEl('div', { text: this.titleText(), cls: 'tc-cal-title' });
        const right = bar.createEl('div', { cls: 'tc-cal-controls' });

        const colorSel = right.createEl('select', { cls: 'dropdown' });
        for (const [v, l] of COLOR_OPTS) { const o = colorSel.createEl('option', { text: t(l) }); o.value = v; if (s.colorBy === v) o.selected = true; }
        colorSel.onchange = async () => { s.colorBy = colorSel.value; await this.plugin.saveSettings(); };

        const modeSel = right.createEl('select', { cls: 'dropdown' });
        for (const [v, l] of CAL_MODES) { const o = modeSel.createEl('option', { text: t(l) }); o.value = v; if (this.mode === v) o.selected = true; }
        modeSel.onchange = () => this.setMode(modeSel.value);

        const filterBtn = right.createEl('button', { cls: 'clickable-icon' });
        obsidian.setIcon(filterBtn, 'filter');
        filterBtn.setAttribute('aria-label', t('Фільтр'));
        if (this.filter) filterBtn.addClass('is-active');
        filterBtn.onclick = e => this.filterMenu(e);

        const dispBtn = right.createEl('button', { cls: 'clickable-icon' });
        obsidian.setIcon(dispBtn, 'more-horizontal');
        dispBtn.setAttribute('aria-label', t('Відображення'));
        dispBtn.onclick = e => this.displayMenu(e);

        const nav = right.createEl('div', { cls: 'tc-nav-group' });
        const prev = nav.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(prev, 'chevron-left'); prev.onclick = () => this.shift(-1);
        nav.createEl('button', { text: t('Сьогодні') }).onclick = () => this.goToday();
        const next = nav.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(next, 'chevron-right'); next.onclick = () => this.shift(1);
    }

    modeMenu(e) {
        const m = new obsidian.Menu();
        for (const [v, l] of CAL_MODES) m.addItem(it => it.setTitle(t(l)).setChecked(this.mode === v).onClick(() => this.setMode(v)));
        m.showAtMouseEvent(e);
    }

    // mobile: colour + filter + display in one menu
    mobileMenu(e) {
        const s = this.plugin.settings;
        const m = new obsidian.Menu();
        m.addItem(it => it.setTitle(t('Колір')).setDisabled(true));
        for (const [v, l] of COLOR_OPTS) m.addItem(it => it.setTitle(t(l)).setChecked(s.colorBy === v).onClick(async () => { s.colorBy = v; await this.plugin.saveSettings(); }));
        m.addSeparator();
        m.addItem(it => it.setTitle(t('Показувати теги')).setChecked(s.showTags).onClick(async () => { s.showTags = !s.showTags; await this.plugin.saveSettings(); }));
        m.addItem(it => it.setTitle(t('Показувати групи')).setChecked(s.showGroups).onClick(async () => { s.showGroups = !s.showGroups; await this.plugin.saveSettings(); }));
        m.addItem(it => it.setTitle(t('Показувати пріоритети')).setChecked(s.showPriority).onClick(async () => { s.showPriority = !s.showPriority; await this.plugin.saveSettings(); }));
        m.addItem(it => it.setTitle(t('Крапка пріоритету')).setChecked(s.priorityDot).onClick(async () => { s.priorityDot = !s.priorityDot; await this.plugin.saveSettings(); }));
        m.addSeparator();
        m.addItem(it => it.setTitle(this.filter ? t('Фільтр: змінити/зняти') : t('Фільтр…')).onClick(() => setTimeout(() => this.filterMenu(e), 0)));
        m.showAtMouseEvent(e);
    }

    filterMenu(e) {
        const m = new obsidian.Menu();
        m.addItem(it => it.setTitle(t('Без фільтра')).setChecked(!this.filter).onClick(() => { this.filter = null; this.refresh(); }));
        const sect = (title, kind, values) => {
            const arr = [...values].sort();
            if (!arr.length) return;
            m.addSeparator();
            m.addItem(it => it.setTitle(title).setDisabled(true));
            for (const v of arr) {
                const active = this.filter && this.filter.kind === kind && this.filter.value === v;
                const label = kind === 'tag' ? `#${v}` : kind === 'group' ? `@${v}` : v;
                m.addItem(it => it.setTitle(label).setChecked(active).onClick(() => { this.filter = { kind, value: v }; this.refresh(); }));
            }
        };
        sect(t('Теги'), 'tag', this._filterOpts.tags);
        sect(t('Групи'), 'group', this._filterOpts.groups);
        sect(t('Пріоритети'), 'priority', this._filterOpts.priorities);
        m.showAtMouseEvent(e);
    }

    displayMenu(e) {
        const s = this.plugin.settings;
        const m = new obsidian.Menu();
        const toggle = (title, key) => m.addItem(it => it.setTitle(title).setChecked(s[key]).onClick(async () => { s[key] = !s[key]; await this.plugin.saveSettings(); }));
        toggle('Показувати теги', 'showTags');
        toggle('Показувати групи', 'showGroups');
        toggle('Показувати пріоритети', 'showPriority');
        m.addSeparator();
        toggle('Крапка пріоритету', 'priorityDot');
        m.showAtMouseEvent(e);
    }

    titleText() {
        if (this.isMonthish()) return `${MONTHS_UA[this.anchor.getMonth()]} ${this.anchor.getFullYear()}`;
        const start = this.rangeStartDate();
        return `${toISO(start)} → ${toISO(addDays(start, this.dayCount() - 1))}`;
    }

    monthDays() { return monthGridDays(this.anchor.getFullYear(), this.anchor.getMonth()); }

    renderMonth(root, map, mobile) {
        const s = this.plugin.settings;
        const refresh = () => this.refresh();
        const grid = root.createEl('div', { cls: 'tc-month-grid' });
        attachSwipeNav(grid, () => this.shift(-1), () => this.shift(1));
        for (const wd of weekdayHeaders()) grid.createEl('div', { text: wd, cls: 'tc-wd' });

        const days = this.monthDays();
        const todayStr = todayISO();

        for (let w = 0; w < 6; w++) {
            let weekHasSelected = false;
            for (let i = 0; i < 7; i++) {
                const day = days[w * 7 + i];
                const iso = toISO(day);
                if (iso === this.selectedDate) weekHasSelected = true;
                const cell = grid.createEl('div', { cls: 'tc-day-cell' });
                if (day.getMonth() !== this.anchor.getMonth()) cell.addClass('tc-outside');
                if (iso === todayStr) cell.addClass('tc-today');
                if (mobile && iso === this.selectedDate) cell.addClass('tc-selected');

                const head = cell.createEl('div', { cls: 'tc-day-head' });
                const num = head.createEl('span', { text: String(day.getDate()) });
                if (!mobile) {
                    num.onclick = ev => { ev.stopPropagation(); openDay(this.app, iso); };
                    cell.ondblclick = () => openDay(this.app, iso);
                    cell.oncontextmenu = ev => {
                        if (ev.defaultPrevented) return;   // клік по бару вже показав меню статусів
                        ev.preventDefault();
                        const menu = new obsidian.Menu();
                        menu.addItem(i => i.setTitle(t('Створити задачу')).setIcon('plus')
                            .onClick(() => new TaskCreateModal(this.app, this.plugin, iso).open()));
                        menu.addItem(i => i.setTitle(t('Відкрити нотатку')).setIcon('file-text')
                            .onClick(() => openDay(this.app, iso)));
                        menu.showAtPosition({ x: ev.clientX, y: ev.clientY });
                    };
                }

                const entry = map.get(iso);
                if (entry && entry.tasks.length) {
                    const items = cell.createEl('div', { cls: 'tc-day-items' });
                    items.dataset.date = iso;
                    entry.tasks.slice().sort(dayOrder).forEach(t => {
                        const bar = items.createEl('div', { cls: 'tc-bar' });
                        if (t.done) bar.addClass('tc-bar-done');
                        if (t.cancelled) bar.addClass('tc-bar-cancelled');
                        if (t.virtual) bar.addClass('tc-virtual');
                        if (t.recId || t.virtual) bar.addClass('tc-bar-recurring');   // dashed, no emoji
                        applyCardColor(bar, t, s.colorBy, s.priorityDot);
                        if (!mobile) {
                            const cbx = makeStatusCheckbox(bar, t, async checked => {
                                await completeTask(this.app, t, checked, s);
                                refresh();
                            }, 'tc-bar-cbx');
                            cbx.onclick = ev => ev.stopPropagation();
                        }
                        bar.createEl('span', { text: t.text || '(без назви)', cls: 'tc-bar-text' });
                        if (t.start) bar.createEl('span', { text: t.start, cls: 'tc-bar-time' });
                        if (!t.virtual && t.file) {
                            bar.oncontextmenu = ev => {
                                ev.preventDefault(); ev.stopPropagation();
                                openStatusMenu(ev, t, async st => { await setTaskStatus(this.app, t.file, t.line, st.id); refresh(); });
                            };
                        }
                        if (!mobile && !t.virtual && t.file) {
                            bar.onclick = ev => { ev.stopPropagation(); new TaskEditorModal(this.app, t, refresh, this.plugin).open(); };
                        } else if (!mobile && t.virtual) {
                            // virtual instance: materialize + open the editor in one click
                            bar.onclick = ev => { ev.stopPropagation(); materializeAndEdit(this.app, t, s, refresh, this.plugin); };
                        }
                    });
                }

                if (mobile) cell.onclick = () => { this.selectedDate = (this.selectedDate === iso ? null : iso); this.refresh(); };
            }
            // mobile: inline expansion under the week row holding the selected day
            if (mobile && weekHasSelected && this.selectedDate) this.renderMonthExpand(grid, map, this.selectedDate);
        }

        this.trimMonthOverflow(root, mobile);
    }

    // after layout: in each day cell keep as many task bars as fit, replace the rest with "+N"
    trimMonthOverflow(root, mobile) {
        let attempts = 0;
        const run = () => {
            // wait until the grid actually has a height (flex/grid layout settled);
            // otherwise clientHeight is 0 and trimming would be silently skipped
            const probe = root.querySelector('.tc-day-items');
            if (probe && probe.clientHeight === 0 && attempts++ < 10) {
                requestAnimationFrame(run);
                return;
            }
            root.querySelectorAll('.tc-day-items').forEach(items => {
                const bars = Array.from(items.children)
                    .filter(c => c.classList.contains('tc-bar') && !c.classList.contains('tc-bar-more'));
                if (bars.length < 2) return;
                const avail = items.clientHeight;
                if (!avail) return;
                const cs = getComputedStyle(items);
                const gap = parseFloat(cs.rowGap || cs.gap) || 2;
                const barH = (bars[0].getBoundingClientRect().height || 21) + gap;   // ≈ 23px per task
                const full = Math.floor((avail + gap) / barH);        // how many fit fully
                if (bars.length <= full) return;                      // all fit → no chip
                const keep = Math.max(1, full - 1);                   // leave a row for the "+N" chip
                for (let i = keep; i < bars.length; i++) bars[i].remove();
                const more = items.createEl('div', { cls: 'tc-bar tc-bar-more', text: `+${bars.length - keep}` });
                more.onclick = ev => {
                    if (mobile) { this.selectedDate = items.dataset.date; this.refresh(); }
                    else { ev.stopPropagation(); openDay(this.app, items.dataset.date); }
                };
            });
        };
        requestAnimationFrame(run);
    }

    renderMonthExpand(grid, map, iso) {
        const settings = this.plugin.settings;
        const refresh = () => this.refresh();
        const panel = grid.createEl('div', { cls: 'tc-month-expand' });
        const head = panel.createEl('div', { cls: 'tc-day-detail-head' });
        head.createEl('span', { text: humanDate(iso), cls: 'tc-day-detail-date' });
        head.createEl('button', { text: t('Нотатка') }).onclick = () => openDay(this.app, iso);
        const entry = map.get(iso);
        const tasks = entry ? entry.tasks.slice().sort(dayOrder) : [];
        if (tasks.length) {
            const list = panel.createEl('div', { cls: 'tc-list' });
            tasks.forEach(t => renderTaskRow(this.app, list, t, refresh, { settings, plugin: this.plugin }));
        } else {
            panel.createEl('div', { text: t('Задач немає'), cls: 'tc-col-empty' });
        }
        quickAdd(this.app, panel, iso, refresh, t('+ задача'), settings);
    }

    // "Перелік": compact month with done/undone dots + selected-day task list
    renderOverview(root, map) {
        const s = this.plugin.settings;
        const wrap = root.createEl('div', { cls: 'tc-overview' });
        attachSwipeNav(wrap, () => this.shift(-1), () => this.shift(1));
        const grid = wrap.createEl('div', { cls: 'tc-month-grid tc-dots-grid' });
        for (const wd of weekdayHeaders()) grid.createEl('div', { text: wd, cls: 'tc-wd' });
        const todayStr = todayISO();

        for (const day of this.monthDays()) {
            const iso = toISO(day);
            const cell = grid.createEl('div', { cls: 'tc-day-cell tc-dots-cell' });
            if (day.getMonth() !== this.anchor.getMonth()) cell.addClass('tc-outside');
            if (iso === todayStr) cell.addClass('tc-today');
            if (iso === this.selectedDate) cell.addClass('tc-selected');
            cell.createEl('div', { text: String(day.getDate()), cls: 'tc-dots-num' });

            const entry = map.get(iso);
            if (entry && entry.tasks.length) {
                const dots = cell.createEl('div', { cls: 'tc-dots' });
                entry.tasks.slice(0, 12).forEach(t => {
                    const d = dots.createEl('span', { cls: 'tc-dot' });
                    const c = cardColor(t, s.colorBy) || 'var(--interactive-accent)';
                    if (t.cancelled) d.addClass('tc-dot-x');                       // cancelled → muted ✕ dot
                    else if (t.done) { d.addClass('tc-dot-hollow'); d.style.borderColor = c; }
                    else d.style.background = c;
                });
            }
            cell.onclick = () => { this.selectedDate = iso; this.refresh(); };
        }

        this.renderDayDetail(wrap, map, this.selectedDate);
    }

    renderDayDetail(root, map, iso) {
        const settings = this.plugin.settings;
        const refresh = () => this.refresh();
        const panel = root.createEl('div', { cls: 'tc-day-detail' });
        const head = panel.createEl('div', { cls: 'tc-day-detail-head' });
        head.createEl('span', { text: humanDate(iso), cls: 'tc-day-detail-date' });
        head.createEl('button', { text: t('Відкрити нотатку') }).onclick = () => openDay(this.app, iso);
        renderTaskComposer(this.app, this.plugin, panel, iso, refresh);   // same composer as the list

        const entry = map.get(iso);
        const tasks = entry ? entry.tasks.slice().sort(dayOrder) : [];
        if (tasks.length) {
            const list = panel.createEl('div', { cls: 'tc-list' });
            tasks.forEach(t => renderTaskRow(this.app, list, t, refresh, { settings, plugin: this.plugin }));
        } else {
            panel.createEl('div', { text: t('Задач немає'), cls: 'tc-col-empty' });
        }
    }
}
