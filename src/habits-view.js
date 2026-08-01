// ─── Habits View (two-pane dashboard: list + selected-habit detail) ───────────

import * as obsidian from 'obsidian';
import { HABITS_VIEW, MONTHS_UA, WD_UA, addDays, countWords, fileToDate, getDailyNotesConfig, habitDone, habitList, habitProgress, lastDayOfMonth, mondayIdx, monthGridDays, pad, parseISO, readFrontmatter, setHabitValue, startOfWeek, t, toISO, todayISO, weekdayHeaders } from './core.js';
import { HabitEditModal } from './edit-modals.js';
import { attachLongPress, attachSwipeNav } from './gestures.js';
import { HabitCreateModal } from './quick-create.js';
import { getDateFiles } from './store.js';

// Pane width (px) below which the two-pane dashboard collapses to a single column
// (left list, tap a habit → detail screen). Raise it to hide the detail pane sooner.
export const HABITS_2PANE_MIN = 860;

export function heatLevel(value, max) {
    if (value <= 0 || max <= 0) return 0;
    return Math.min(4, Math.ceil(value / max * 4));
}
export function heatColor(base, lvl) {
    if (lvl === 0) return 'var(--background-modifier-border)';
    return `color-mix(in srgb, ${base} ${6 + lvl * 22}%, var(--background-secondary))`;
}

// Read a habit's value out of a (cached) frontmatter object — fully synchronous.
export function fmHabitValue(fm, habit) {
    const v = fm ? fm[habit.property] : undefined;
    if (habit.type === 'bool') return (v === true || v === 'true') ? 1 : 0;
    return Number(v) || 0;
}

// SVG progress ring with an optional centered label. Returns the wrapper element.
export function makeRing(parent, frac, color, opts) {
    opts = opts || {};
    const size = opts.size || 28, sw = opts.stroke || 3;
    const r = (size - sw) / 2, circ = 2 * Math.PI * r, ns = 'http://www.w3.org/2000/svg';
    const wrap = parent.createEl('div', { cls: 'tc-ring-wrap' });
    wrap.style.width = wrap.style.height = size + 'px';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.classList.add('tc-ring');
    const circle = (stroke, dashFrac) => {
        const ci = document.createElementNS(ns, 'circle');
        ci.setAttribute('cx', size / 2); ci.setAttribute('cy', size / 2); ci.setAttribute('r', r);
        ci.setAttribute('fill', 'none'); ci.setAttribute('stroke', stroke); ci.setAttribute('stroke-width', sw);
        if (dashFrac != null) {
            ci.setAttribute('stroke-dasharray', circ);
            ci.setAttribute('stroke-dashoffset', circ * (1 - dashFrac));
            ci.setAttribute('stroke-linecap', 'round');
            ci.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
        }
        svg.appendChild(ci);
    };
    circle('var(--background-modifier-border)');
    if (frac > 0) circle(color || 'var(--interactive-accent)', Math.min(1, frac));
    wrap.appendChild(svg);
    if (opts.center != null) wrap.createEl('span', { cls: 'tc-ring-center', text: String(opts.center) });
    if (frac >= 1) wrap.addClass('tc-ring-full');
    return wrap;
}

export class HabitsView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.anchor = new Date();          // single focus date driving week / month / year
        this.selectedHabit = null;
        this.mobileDetail = false;         // narrow: list (false) vs detail screen (true)
    }

    getViewType() { return HABITS_VIEW; }
    getDisplayText() { return t('Звички'); }
    getIcon() { return 'check-circle'; }

    async onOpen() {
        // Re-render when habit values change. Writes (setHabitValue) update metadataCache
        // ASYNCHRONOUSLY, so we refresh on its 'changed' event (not right after the write)
        // to avoid reading stale frontmatter. Debounced to collapse bursts and avoid flicker.
        this._scheduleRefresh = obsidian.debounce(() => this.refresh(), 200, true);
        const isDaily = file => { const c = getDailyNotesConfig(this.app); return !!(file && fileToDate(file, c.folder, c.format)); };
        this.registerEvent(this.app.metadataCache.on('changed', file => { if (isDaily(file)) this._scheduleRefresh(); }));
        this.registerEvent(this.app.vault.on('create', () => this._scheduleRefresh()));
        this.registerEvent(this.app.vault.on('delete', () => this._scheduleRefresh()));
        this.registerEvent(this.app.vault.on('rename', () => this._scheduleRefresh()));
        await this.refresh();
    }
    isNarrow() {
        const w = (this.containerEl.children[1] && this.containerEl.children[1].clientWidth) || 0;
        return obsidian.Platform.isMobile || w < HABITS_2PANE_MIN;
    }
    onResize() { const n = this.isNarrow(); if (n !== this._narrow) this.refresh(); }

    // value lookup backed by the per-refresh caches (synchronous)
    val(iso, habit) { return habit.auto === 'words' ? (this._words.get(iso) || 0) : fmHabitValue(this._fm.get(iso), habit); }

    // ── synchronized period navigation (all driven by this.anchor) ───────────
    weekStep(dir) { this.anchor = addDays(this.anchor, dir * 7); this.refresh(); }
    monthStep(dir) {
        const a = this.anchor, nm = new Date(a.getFullYear(), a.getMonth() + dir, 1);
        this.anchor = new Date(nm.getFullYear(), nm.getMonth(), Math.min(a.getDate(), lastDayOfMonth(nm.getFullYear(), nm.getMonth())));
        this.refresh();
    }
    yearStep(dir) {
        const ty = this.anchor.getFullYear() + dir, cy = new Date().getFullYear();
        if (ty < cy) this.anchor = new Date(ty, 11, 31);       // past year → last month + last week
        else if (ty === cy) this.anchor = new Date();          // current year → today
        else this.anchor = new Date(ty, 0, 1);                 // future → start
        this.refresh();
    }
    // ◀ [label → today] ▶  — identical control reused for week / month / year
    navGroup(container, label, stepFn) {
        const g = container.createEl('div', { cls: 'tc-nav-group' });
        const pv = g.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(pv, 'chevron-left'); pv.onclick = () => stepFn(-1);
        const lbl = g.createEl('button', { cls: 'tc-nav-label', text: label });
        lbl.setAttribute('aria-label', t('До поточного'));
        lbl.onclick = () => { this.anchor = new Date(); this.refresh(); };
        const nx = g.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(nx, 'chevron-right'); nx.onclick = () => stepFn(1);
        return g;
    }

    async refresh() {
        this._narrow = this.isNarrow();
        const root = this.containerEl.children[1];
        const habits = habitList(this.plugin.settings);

        if (!habits.length) {
            root.empty(); root.addClass('tc-pane');
            const bar = root.createEl('div', { cls: 'tc-cal-header' });
            bar.createEl('div', { text: t('Звички'), cls: 'tc-cal-title' });
            const add = bar.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(add, 'plus');
            add.onclick = () => this.openCreate();
            root.createEl('p', { text: t('Звичок ще немає. Створіть їх через Ctrl+P → Звичка.'), cls: 'tc-empty' });
            return;
        }
        if (!this.selectedHabit || !habits.find(h => h.id === this.selectedHabit)) this.selectedHabit = habits[0].id;

        // ── gather ALL data BEFORE emptying (anti-flicker). Frontmatter is read once
        //    from the (synchronous) metadata cache; word counts only if a word habit exists.
        this._files = getDateFiles(this.app);                     // [{file, date}]
        this._fm = new Map();
        for (const { file, date } of this._files) {
            const fc = this.app.metadataCache.getFileCache(file);
            this._fm.set(date, (fc && fc.frontmatter) || {});
        }
        this._words = new Map();
        if (habits.some(h => h.auto === 'words')) {
            for (const { file, date } of this._files) this._words.set(date, countWords(await this.app.vault.read(file)));
        }

        // ── render synchronously ──
        root.empty();
        root.addClass('tc-pane');
        if (this._narrow) {
            if (this.mobileDetail) this.renderHabitDetail(root, habits, true);
            else this.renderHabitList(root, habits, true);
            return;
        }
        const pane = root.createEl('div', { cls: 'tc-habits-2pane' });
        this.renderHabitList(pane.createEl('div', { cls: 'tc-habits-list' }), habits, false);
        this.renderHabitDetail(pane.createEl('div', { cls: 'tc-habits-detail' }), habits, false);
    }

    openCreate() {
        const m = new HabitCreateModal(this.app, this.plugin);
        const orig = m.onClose.bind(m);
        m.onClose = () => { orig(); this.refresh(); };
        m.open();
    }

    currentStreak(habit) {
        let s = 0;
        const today = parseISO(todayISO());
        for (let i = 0; i < 180; i++) {
            const v = this.val(toISO(addDays(today, -i)), habit);
            if (habitDone(v, habit)) s++;
            else if (i === 0) continue;   // today still pending — don't zero an ongoing streak
            else break;
        }
        return s;
    }

    cellInput(cell, habit, iso, v) {
        if (habit.auto) return;
        cell.addClass('tc-clickable');
        // no manual refresh — the metadataCache 'changed' event re-renders with fresh data
        cell.onclick = () => {
            if (habit.type === 'bool') setHabitValue(this.app, iso, habit, v > 0 ? null : true);
            else new HabitCompleteModal(this.app, habit, iso, () => {}).open();
        };
        // right-click / long-press → clear the day's value
        const clearMenu = pos => {
            const menu = new obsidian.Menu();
            menu.addItem(i => i.setTitle(t('Очистити')).setIcon('eraser')
                .onClick(() => setHabitValue(this.app, iso, habit, null)));
            menu.showAtPosition({ x: pos.clientX, y: pos.clientY });
        };
        cell.oncontextmenu = ev => { ev.preventDefault(); clearMenu(ev); };
        attachLongPress(cell, clearMenu);
    }

    // ── left: habit list with week ring-header ───────────────────────────────
    renderHabitList(root, habits, mobile) {
        root = root.createEl('div', { cls: 'tc-hl' });   // own container for width-based name hiding
        attachSwipeNav(root, () => this.weekStep(-1), () => this.weekStep(1));
        const bar = root.createEl('div', { cls: 'tc-cal-header' });
        bar.createEl('div', { text: t('Звички'), cls: 'tc-cal-title' });
        const ctr = bar.createEl('div', { cls: 'tc-cal-controls' });
        const start = startOfWeek(this.anchor), wkEnd = addDays(start, 6);
        const wkLabel = `${pad(start.getDate())}.${pad(start.getMonth() + 1)} – ${pad(wkEnd.getDate())}.${pad(wkEnd.getMonth() + 1)}`;
        this.navGroup(ctr, wkLabel, dir => this.weekStep(dir));
        const add = ctr.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(add, 'plus');
        add.setAttribute('aria-label', t('Нова звичка')); add.onclick = () => this.openCreate();

        const days = []; for (let i = 0; i < 7; i++) days.push(addDays(start, i));
        const todayStr = todayISO();

        const head = root.createEl('div', { cls: 'tc-hl-grid tc-hl-weekhead' });
        head.createEl('div', { cls: 'tc-hl-corner' });
        for (const d of days) {
            const iso = toISO(d);
            const col = head.createEl('div', { cls: iso === todayStr ? 'tc-hl-dayhead tc-hl-today' : 'tc-hl-dayhead' });
            col.createEl('div', { text: WD_UA[mondayIdx(d)], cls: 'tc-col-wd' });
            let sum = 0; for (const h of habits) sum += habitProgress(this.val(iso, h), h);
            makeRing(col, habits.length ? sum / habits.length : 0, 'var(--interactive-accent)', { size: 22, stroke: 3, center: String(d.getDate()) });
        }

        for (const habit of habits) {
            const row = root.createEl('div', { cls: 'tc-hl-grid tc-hl-row' + (habit.id === this.selectedHabit ? ' is-selected' : '') });
            const info = row.createEl('div', { cls: 'tc-hl-info' });
            info.onclick = () => { this.selectedHabit = habit.id; if (this._narrow) this.mobileDetail = true; this.refresh(); };
            const badge = info.createEl('div', { cls: 'tc-hl-badge', text: habit.emoji || '•' });
            if (habit.color) badge.style.background = `color-mix(in srgb, ${habit.color} 30%, transparent)`;
            const meta = info.createEl('div', { cls: 'tc-hl-meta' });
            meta.createEl('div', { text: habit.name, cls: 'tc-hl-name' });
            meta.createEl('div', { cls: 'tc-hl-streak', text: `🔥 ${this.currentStreak(habit)} ${t('дн.')}` });

            for (const d of days) {
                const iso = toISO(d);
                const cell = row.createEl('div', { cls: 'tc-hl-cell' });
                const v = this.val(iso, habit);
                const w = makeRing(cell, habitProgress(v, habit), habit.color || 'var(--interactive-accent)', { size: 20, stroke: 3 });
                if (habitDone(v, habit)) w.addClass('tc-ring-done');
                this.cellInput(cell, habit, iso, v);
            }
        }
    }

    // ── right: detail of the selected habit ──────────────────────────────────
    renderHabitDetail(root, habits, mobile) {
        const habit = habits.find(h => h.id === this.selectedHabit) || habits[0];

        const head = root.createEl('div', { cls: 'tc-hd-head' });
        if (mobile) {
            const back = head.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(back, 'arrow-left');
            back.setAttribute('aria-label', t('← Назад')); back.onclick = () => { this.mobileDetail = false; this.refresh(); };
        }
        const title = head.createEl('div', { cls: 'tc-hd-title' });
        title.createEl('span', { cls: 'tc-hd-emoji', text: habit.emoji || '•' });
        title.createEl('span', { text: habit.name });
        if (!habit.auto) {
            const more = head.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(more, 'more-horizontal');
            more.onclick = e => {
                const menu = new obsidian.Menu();
                menu.addItem(it => it.setTitle(t('Редагувати')).setIcon('pencil').onClick(() => {
                    new HabitEditModal(this.app, this.plugin, habit, () => this.refresh()).open();
                }));
                menu.addItem(it => it.setTitle(t('Видалити')).setIcon('trash').onClick(async () => {
                    this.plugin.settings.habits = this.plugin.settings.habits.filter(h => h.id !== habit.id);
                    await this.plugin.saveSettings();
                    this.selectedHabit = null; this.mobileDetail = false; this.refresh();
                }));
                menu.showAtMouseEvent(e);
            };
        }

        // month (follows the shared anchor) + all-time aggregates — all synchronous
        const y = this.anchor.getFullYear(), m = this.anchor.getMonth();
        const last = new Date(y, m + 1, 0).getDate();
        const monthIsos = []; for (let dd = 1; dd <= last; dd++) monthIsos.push(toISO(new Date(y, m, dd)));
        const monthVals = {}; for (const iso of monthIsos) monthVals[iso] = this.val(iso, habit);

        let monthChecks = 0, monthCount = 0;
        for (const iso of monthIsos) { const v = monthVals[iso]; monthCount += v; if (habitDone(v, habit)) monthChecks++; }
        const rate = monthIsos.length ? Math.round(monthChecks / monthIsos.length * 100) : 0;

        let totalChecks = 0, totalCount = 0;
        for (const { date } of this._files) { const v = this.val(date, habit); totalCount += v; if (habitDone(v, habit)) totalChecks++; }
        const streak = this.currentStreak(habit);

        const grid = root.createEl('div', { cls: 'tc-metric-grid' });
        const card = (icon, label, value, sub) => {
            const c = grid.createEl('div', { cls: 'tc-metric-card' });
            const top = c.createEl('div', { cls: 'tc-metric-top' });
            const ic = top.createEl('span', { cls: 'tc-metric-icon' }); obsidian.setIcon(ic, icon);
            top.createEl('span', { text: label, cls: 'tc-metric-label' });
            c.createEl('div', { text: String(value), cls: 'tc-metric-value' });
            if (sub) c.createEl('div', { text: sub, cls: 'tc-metric-sub' });
        };
        card('check-circle', t('Щомісячні перевірки'), monthChecks, t('День'));
        card('list', t('Загальна реєстрація'), totalChecks, t('День'));
        card('percent', t('Щомісячна ставка реєстрації'), rate + ' %');
        card('flame', t('Поточна серія'), streak, t('День'));
        card('bar-chart', t('Щомісячне виконання'), monthCount, t('Рахунок'));
        card('bar-chart-2', t('Загальний обсяг виконання'), totalCount, t('Рахунок'));

        this.renderRingCalendar(root, habit, monthVals, y, m);
        this.renderBarChart(root, habit, monthIsos, monthVals);
        this.renderHeatmapBlock(root, habit);
    }

    renderRingCalendar(root, habit, monthVals, y, m) {
        const wrap = root.createEl('div', { cls: 'tc-ring-cal' });
        const hd = wrap.createEl('div', { cls: 'tc-cal-header' });
        hd.createEl('div', { text: t('Місяць'), cls: 'tc-hd-subhead' });
        this.navGroup(hd, `${MONTHS_UA[m]} ${y}`, dir => this.monthStep(dir));

        const grid = wrap.createEl('div', { cls: 'tc-ringcal-grid' });
        attachSwipeNav(grid, () => this.monthStep(-1), () => this.monthStep(1));
        for (const wd of weekdayHeaders()) grid.createEl('div', { text: wd, cls: 'tc-wd' });
        const todayStr = todayISO();
        for (const d of monthGridDays(y, m)) {
            const inMonth = d.getMonth() === m;
            const iso = toISO(d);
            const cell = grid.createEl('div', { cls: inMonth ? 'tc-ringcal-cell' : 'tc-ringcal-cell tc-outside' });
            const v = inMonth ? monthVals[iso] : 0;
            makeRing(cell, habitProgress(v, habit), habit.color || 'var(--interactive-accent)', { size: 34, stroke: 3, center: String(d.getDate()) });
            if (iso === todayStr) cell.addClass('tc-today');
            if (inMonth) this.cellInput(cell, habit, iso, v);
        }
    }

    renderBarChart(root, habit, monthIsos, monthVals) {
        const wrap = root.createEl('div', { cls: 'tc-barchart-wrap' });
        wrap.createEl('div', { cls: 'tc-hd-subhead', text: 'Daily Goals' + (habit.unit ? ` (${habit.unit})` : '') });
        let max = habit.goal > 0 ? habit.goal : 1;
        for (const iso of monthIsos) max = Math.max(max, monthVals[iso]);

        const chart = wrap.createEl('div', { cls: 'tc-barchart' });
        const tip = chart.createEl('div', { cls: 'tc-bar-tip' }); tip.style.display = 'none';
        if (habit.goal > 0) {
            const line = chart.createEl('div', { cls: 'tc-bar-goalline' });
            line.style.bottom = `${habit.goal / max * 100}%`;
            line.createEl('span', { cls: 'tc-bar-goallabel', text: t('Ціль') + ' ' + habit.goal });
        }
        monthIsos.forEach((iso, idx) => {
            const v = monthVals[iso];
            const col = chart.createEl('div', { cls: 'tc-bar-col' });
            const fill = col.createEl('div', { cls: habitDone(v, habit) ? 'tc-bar-fill tc-bar-done' : 'tc-bar-fill' });
            fill.style.height = `${Math.min(1, v / max) * 100}%`;
            if (habit.color && habitDone(v, habit)) fill.style.background = habit.color;
            col.addEventListener('mouseenter', () => { tip.style.display = ''; tip.setText(String(v)); tip.style.left = `${(idx + 0.5) / monthIsos.length * 100}%`; });
            col.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
        });

        const axis = wrap.createEl('div', { cls: 'tc-barchart-axis' });
        monthIsos.forEach((iso, idx) => {
            const day = idx + 1;
            const lab = axis.createEl('div', { cls: 'tc-bar-axislabel' });
            if (day === 1 || day % 5 === 0) lab.setText(String(day));
        });
    }

    renderHeatmapBlock(root, habit) {
        const wrap = root.createEl('div', { cls: 'tc-heatblock' });
        const hd = wrap.createEl('div', { cls: 'tc-cal-header' });
        hd.createEl('div', { text: t('Рік'), cls: 'tc-hd-subhead' });
        this.navGroup(hd, String(this.anchor.getFullYear()), dir => this.yearStep(dir));

        const yy = this.anchor.getFullYear();
        const from = new Date(yy, 0, 1), to = new Date(yy, 11, 31);
        const base = habit.color || 'var(--interactive-accent)';
        let max = habit.goal > 0 ? habit.goal : 1;
        for (let d = new Date(from); d <= to; d = addDays(d, 1)) max = Math.max(max, this.val(toISO(d), habit));
        const unit = habit.unit || (habit.type === 'bool' ? t('разів') : '');
        const activeWeek = toISO(startOfWeek(this.anchor));

        const cols = wrap.createEl('div', { cls: 'tc-heat tc-heat-year' });
        let d = startOfWeek(from);
        while (d <= to) {
            const col = cols.createEl('div', { cls: 'tc-heat-col' });
            if (toISO(d) === activeWeek) col.addClass('tc-heat-col-active');
            for (let i = 0; i < 7; i++) {
                const day = addDays(d, i);
                const iso = toISO(day);
                const dim = day < from || day > to;
                const v = dim ? 0 : this.val(iso, habit);
                const cell = col.createEl('div', { cls: dim ? 'tc-heat-cell tc-heat-dim' : 'tc-heat-cell' });
                cell.style.background = heatColor(base, heatLevel(v, max));
                cell.title = `${iso}: ${v}${unit ? ' ' + unit : ''}`;
            }
            d = addDays(d, 7);
        }
    }
}

// ─── Habit completion modal (shared by this view & task-row habit strips) ─────

export class HabitCompleteModal extends obsidian.Modal {
    constructor(app, habit, iso, onDone) {
        super(app);
        this.habit = habit;
        this.iso = iso;
        this.onDone = onDone;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('tc-editor');
        contentEl.createEl('h3', { text: `${this.habit.emoji ? this.habit.emoji + ' ' : ''}${this.habit.name}` });

        const done = () => { this.close(); if (this.onDone) this.onDone(); };

        if (this.habit.type === 'bool') {
            const btns = contentEl.createEl('div', { cls: 'tc-modal-btns' });
            btns.createEl('button', { text: t('Скасувати') }).onclick = () => this.close();
            btns.createEl('button', { text: t('Виконано'), cls: 'mod-cta' }).onclick = async () => {
                await setHabitValue(this.app, this.iso, this.habit, true); done();
            };
            return;
        }

        let input;
        const cur = readFrontmatter(this.app, this.iso)[this.habit.property];
        const save = async () => {
            const n = Number(input.getValue());
            await setHabitValue(this.app, this.iso, this.habit, (isNaN(n) || n <= 0) ? null : n);
            done();
        };
        new obsidian.Setting(contentEl).setName(`${t('Скільки')}${this.habit.unit ? ' (' + this.habit.unit + ')' : ''}`)
            .addText(c => {
                input = c; c.inputEl.type = 'number'; c.inputEl.style.width = '8em';
                if (cur) c.setValue(String(cur));
                c.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
                setTimeout(() => c.inputEl.focus(), 0);
            });
        const btns = contentEl.createEl('div', { cls: 'tc-modal-btns' });
        btns.createEl('button', { text: t('Скасувати') }).onclick = () => this.close();
        btns.createEl('button', { text: t('Зберегти'), cls: 'mod-cta' }).onclick = save;
    }
    onClose() { this.contentEl.empty(); }
}
