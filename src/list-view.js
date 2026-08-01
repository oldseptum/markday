// ─── List View (collapsible filter sidebar + task list) ───────────────────────

import * as obsidian from 'obsidian';
import { COLORS, LIST_HORIZON_DAYS, LIST_VIEW, addDays, addVirtuals, autoColor, compactMode, dayOrder, getHabitValue, habitList, humanDate, priorityKeys, priorityRank, t, toISO, todayISO } from './core.js';
import { renderTaskComposer } from './quick-create.js';
import { renderHabitStrip, renderTaskRow } from './render.js';
import { loadAllTasks } from './store.js';

export class ListView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.groupBy = 'date';
        this.sortBy = 'priority';
        this.hideDone = false;
        this.showDetails = false;
        this.prioFilter = null;                            // null | priority key
        this.activeFilter = { kind: 'view', value: 'all' }; // kind: view | group | tag
        this.sidebarOpen = true;
        this.showHabits = false;                           // today's habits strip
        this.collapsed = new Set();                        // collapsed group keys
    }

    getViewType() { return LIST_VIEW; }
    getDisplayText() { return t('Список задач'); }
    getIcon() { return 'list-checks'; }

    async onOpen() { this.sidebarOpen = !compactMode(this); await this.refresh(); }
    onResize() {
        const c = compactMode(this);
        if (c !== this._lastCompact) { this._lastCompact = c; this.sidebarOpen = !c; this.refresh(); }
    }

    async refresh() {
        // load first (anti-flicker), then build DOM synchronously
        const settings = this.plugin.settings;
        const map = await loadAllTasks(this.app);
        addVirtuals(map, settings.recurrences, todayISO(), toISO(addDays(new Date(), LIST_HORIZON_DAYS)));
        const todayStr = todayISO();
        const next7End = toISO(addDays(new Date(), 7));

        let pool = [];
        for (const { tasks: ts } of map.values()) pool = pool.concat(ts);

        // recurrence sliding window: in the list show only the next N upcoming virtual
        // instances per recurrence (date ≥ today); the rest are dropped (calendar keeps all)
        const aheadN = Math.max(1, Number(settings.recurrenceAhead) || 1);
        const futVirt = pool.filter(x => x.virtual && x.recId && x.date >= todayStr)
            .sort((a, b) => a.date.localeCompare(b.date));
        const seen = {}, dropped = new Set();
        for (const x of futVirt) { seen[x.recId] = (seen[x.recId] || 0) + 1; if (seen[x.recId] > aheadN) dropped.add(x); }
        if (dropped.size) pool = pool.filter(x => !dropped.has(x));

        // sidebar aggregates (count open tasks); each count matches what its view shows
        // (today is strictly today — overdue has its own row, so it isn't double-counted here)
        const open = pool.filter(x => !x.done && !x.cancelled);
        const viewCounts = {
            all: open.length,
            today: open.filter(x => x.date === todayStr).length,
            next7: open.filter(x => x.date >= todayStr && x.date <= next7End).length,
            overdue: open.filter(x => x.date < todayStr).length,
        };
        const groupCounts = new Map(), tagCounts = new Map();
        for (const x of open) {
            if (x.group) groupCounts.set(x.group, (groupCounts.get(x.group) || 0) + 1);
            for (const tg of (x.tags || [])) tagCounts.set(tg, (tagCounts.get(tg) || 0) + 1);
        }

        // apply the active filter
        const f = this.activeFilter;
        let tasks = pool.filter(x => {
            if (f.kind === 'group') return x.group === f.value;
            if (f.kind === 'tag') return (x.tags || []).includes(f.value);
            if (f.value === 'today') return x.date === todayStr;
            if (f.value === 'next7') return x.date >= todayStr && x.date <= next7End;
            if (f.value === 'overdue') return x.date < todayStr && !x.done && !x.cancelled;
            return !(x.date < todayStr && (x.done || x.cancelled)); // all: hide past done/cancelled
        });
        if (this.prioFilter) tasks = tasks.filter(x => x.priority === this.prioFilter);
        if (this.hideDone) tasks = tasks.filter(x => !x.done && !x.cancelled);

        // today's habit values (computed before clearing DOM — anti-flicker)
        const habits = this.showHabits ? habitList(settings).filter(h => !h.auto) : [];
        const habitVals = {};
        for (const h of habits) habitVals[h.id] = await getHabitValue(this.app, todayStr, h);

        this._lastCompact = compactMode(this);
        const root = this.containerEl.children[1];
        root.empty();
        root.addClass('tc-pane', 'tc-listview');

        const pane = root.createEl('div', { cls: 'tc-list-2pane' });
        if (this.sidebarOpen) this.renderSidebar(pane, { viewCounts, groupCounts, tagCounts });
        const main = pane.createEl('div', { cls: 'tc-list-main' });
        this.renderHeader(main);
        if (habits.length) renderHabitStrip(this.app, main, habits, habitVals, todayStr, () => this.refresh());
        this.renderTasks(main, tasks, settings, todayStr);
    }

    // ── left sidebar: day views · groups · tags ──────────────────────────────
    renderSidebar(pane, data) {
        const compact = compactMode(this);
        if (compact) {
            // напівпрозора підкладка: клік/тап поза панеллю закриває її
            const backdrop = pane.createEl('div', { cls: 'tc-side-backdrop' });
            backdrop.onclick = () => { this.sidebarOpen = false; this.refresh(); };
        }
        const side = pane.createEl('div', { cls: compact ? 'tc-list-side tc-list-side-overlay' : 'tc-list-side' });
        const sel = (kind, value) => this.activeFilter.kind === kind && this.activeFilter.value === value;
        const pick = (kind, value) => { this.activeFilter = { kind, value }; if (compactMode(this)) this.sidebarOpen = false; this.refresh(); };
        const row = (parent, o) => {
            const r = parent.createEl('div', { cls: o.active ? 'tc-side-row is-active' : 'tc-side-row' });
            if (o.icon) { const i = r.createEl('span', { cls: 'tc-side-ic' }); obsidian.setIcon(i, o.icon); }
            if (o.dot) r.createEl('span', { cls: 'tc-side-dot' }).style.background = o.dot;
            r.createEl('span', { cls: 'tc-side-label', text: o.label });
            if (o.count) r.createEl('span', { cls: 'tc-side-count', text: String(o.count) });
            r.onclick = o.onClick;
        };

        const vsec = side.createEl('div', { cls: 'tc-side-sec' });
        vsec.createEl('div', { cls: 'tc-side-sec-title', text: t('Перегляди') });
        const views = [['all', 'Всі', 'layers'], ['today', 'Сьогодні', 'calendar-check'], ['next7', 'Наступні 7 днів', 'calendar-range'], ['overdue', 'Протерміновані', 'alert-triangle']];
        for (const [val, label, icon] of views) row(vsec, { icon, label: t(label), count: data.viewCounts[val], active: sel('view', val), onClick: () => pick('view', val) });

        const groups = [...data.groupCounts.keys()].sort();
        if (groups.length) {
            const gsec = side.createEl('div', { cls: 'tc-side-sec' });
            gsec.createEl('div', { cls: 'tc-side-sec-title', text: t('Групи') });
            for (const name of groups) row(gsec, { dot: COLORS.groups[name] || autoColor(name), label: '@' + name, count: data.groupCounts.get(name), active: sel('group', name), onClick: () => pick('group', name) });
        }

        const tags = [...data.tagCounts.keys()].sort();
        if (tags.length) {
            const tsec = side.createEl('div', { cls: 'tc-side-sec' });
            tsec.createEl('div', { cls: 'tc-side-sec-title', text: t('Теги') });
            for (const name of tags) row(tsec, { dot: COLORS.tags[name], label: '#' + name, count: data.tagCounts.get(name), active: sel('tag', name), onClick: () => pick('tag', name) });
        }
    }

    filterTitle() {
        const f = this.activeFilter;
        if (f.kind === 'group') return '@' + f.value;
        if (f.kind === 'tag') return '#' + f.value;
        return { all: t('Всі'), today: t('Сьогодні'), next7: t('Наступні 7 днів'), overdue: t('Протерміновані') }[f.value] || t('Всі');
    }

    composerDefaults() {
        if (this.activeFilter.kind === 'group') return { group: this.activeFilter.value };
        if (this.activeFilter.kind === 'tag') return { tags: [this.activeFilter.value] };
        return null;
    }

    // ── main header (filter · group · more on the title row) + composer ───────
    renderHeader(main) {
        const head = main.createEl('div', { cls: 'tc-list-head' });
        const ham = head.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(ham, 'panel-left');
        ham.setAttribute('aria-label', t('Панель фільтрів'));
        ham.onclick = () => { this.sidebarOpen = !this.sidebarOpen; this.refresh(); };
        head.createEl('div', { cls: 'tc-list-title', text: this.filterTitle() });
        head.createEl('div', { cls: 'tc-toolbar-spacer' });
        this.iconBtn(head, 'filter', t('Фільтр'), e => this.filterMenu(e));
        this.iconBtn(head, 'arrow-down-up', t('Сортування та групування'), e => this.sortMenu(e));
        this.iconBtn(head, 'more-horizontal', t('Більше'), e => this.moreMenu(e));

        renderTaskComposer(this.app, this.plugin, main, todayISO(), () => this.refresh(), this.composerDefaults());
    }

    iconBtn(parent, icon, tip, onClick) {
        const b = parent.createEl('button', { cls: 'clickable-icon' });
        obsidian.setIcon(b, icon);
        b.setAttribute('aria-label', tip);
        b.onclick = onClick;
        return b;
    }

    filterMenu(e) {
        const m = new obsidian.Menu();
        m.addItem(it => it.setTitle(t('Усі пріоритети')).setChecked(!this.prioFilter).onClick(() => { this.prioFilter = null; this.refresh(); }));
        priorityKeys.forEach(k => m.addItem(it => it.setTitle('!' + k).setChecked(this.prioFilter === k).onClick(() => { this.prioFilter = k; this.refresh(); })));
        m.showAtMouseEvent(e);
    }

    sortMenu(e) {
        const m = new obsidian.Menu();
        m.addItem(it => it.setTitle(t('Групування')).setDisabled(true));
        for (const [v, l] of [['none', 'Без груп'], ['date', 'За датою'], ['tag', 'За тегом'], ['group', 'За групою'], ['priority', 'За пріоритетом']]) {
            m.addItem(it => it.setTitle(t(l)).setChecked(this.groupBy === v).onClick(() => { this.groupBy = v; this.refresh(); }));
        }
        m.addSeparator();
        m.addItem(it => it.setTitle(t('Сортування')).setDisabled(true));
        for (const [v, l] of [['priority', 'Пріоритет'], ['date', 'Дата'], ['time', 'Час'], ['text', 'Назва']]) {
            m.addItem(it => it.setTitle(t(l)).setChecked(this.sortBy === v).onClick(() => { this.sortBy = v; this.refresh(); }));
        }
        m.showAtMouseEvent(e);
    }

    moreMenu(e) {
        const m = new obsidian.Menu();
        m.addItem(it => it.setTitle(t('Сховати виконані')).setChecked(this.hideDone).onClick(() => { this.hideDone = !this.hideDone; this.refresh(); }));
        m.addItem(it => it.setTitle(t('Показувати деталі')).setChecked(this.showDetails).onClick(() => { this.showDetails = !this.showDetails; this.refresh(); }));
        m.addItem(it => it.setTitle(t('Звички сьогодні')).setChecked(this.showHabits).onClick(() => { this.showHabits = !this.showHabits; this.refresh(); }));
        m.showAtMouseEvent(e);
    }

    // group header with a collapse caret; returns true if the group body should render
    groupHead(sec, key, title, count) {
        const h = sec.createEl('div', { cls: 'tc-group-head' });
        const car = h.createEl('span', { cls: 'tc-group-caret' });
        obsidian.setIcon(car, this.collapsed.has(key) ? 'chevron-right' : 'chevron-down');
        h.createEl('span', { text: title, cls: 'tc-group-title' });
        h.createEl('span', { text: String(count), cls: 'tc-group-count' });
        h.onclick = () => { this.collapsed.has(key) ? this.collapsed.delete(key) : this.collapsed.add(key); this.refresh(); };
        return !this.collapsed.has(key);
    }

    renderTasks(main, tasks, settings, todayStr) {
        if (!tasks.length) { main.createEl('p', { text: t('Задач не знайдено.'), cls: 'tc-empty' }); return; }
        if (this.activeFilter.kind === 'view' && this.activeFilter.value === 'all' && this.groupBy === 'date') {
            return this.renderAllBuckets(main, tasks, settings, todayStr);
        }
        const sortFn = this.makeSortFn();
        const refresh = () => this.refresh();
        const isOverdue = t => t.date < todayStr && !t.done && !t.cancelled;

        // overdue group, unless the "Overdue" view is already active
        const inOverdueView = this.activeFilter.kind === 'view' && this.activeFilter.value === 'overdue';
        const overdueTasks = inOverdueView ? [] : tasks.filter(isOverdue);
        const rest = overdueTasks.length ? tasks.filter(t => !isOverdue(t)) : tasks;

        if (overdueTasks.length) {
            const sec = main.createEl('div', { cls: 'tc-group tc-overdue-group' });
            if (this.groupHead(sec, '__overdue', t('Протерміновані'), overdueTasks.length)) {
                const list = sec.createEl('div', { cls: 'tc-list' });
                overdueTasks.sort((a, b) => (a.date || '').localeCompare(b.date || '') || dayOrder(a, b))
                    .forEach(t => renderTaskRow(this.app, list, t, refresh, { overdue: true, showDetails: this.showDetails, settings, plugin: this.plugin }));
            }
        }

        if (this.groupBy === 'none') {
            const list = main.createEl('div', { cls: 'tc-list' });
            rest.sort(sortFn).forEach(t => renderTaskRow(this.app, list, t, refresh, { showDate: true, showDetails: this.showDetails, settings, plugin: this.plugin }));
            return;
        }

        for (const [key, items] of this.buildGroups(rest)) {
            const sec = main.createEl('div', { cls: 'tc-group' });
            const title = this.groupBy === 'date' ? (key === '__nodate' ? t('Без дати') : humanDate(key)) : t(key);
            if (this.groupHead(sec, key, title, items.length)) {
                const list = sec.createEl('div', { cls: 'tc-list' });
                items.sort(sortFn).forEach(t =>
                    renderTaskRow(this.app, list, t, refresh, { showDate: this.groupBy !== 'date', showDetails: this.showDetails, settings, plugin: this.plugin }));
            }
        }
    }

    // "All" + group-by-date → coarse buckets: Overdue / Next 7 days / Later (date instead of time)
    renderAllBuckets(main, tasks, settings, todayStr) {
        const refresh = () => this.refresh();
        const next7End = toISO(addDays(new Date(), 7));
        const od = [], n7 = [], later = [];
        for (const x of tasks) {
            if (x.date < todayStr) { if (!x.done && !x.cancelled) od.push(x); }
            else if (x.date <= next7End) n7.push(x);
            else later.push(x);
        }
        const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || dayOrder(a, b);
        const bucket = (key, title, items, opts) => {
            if (!items.length) return;
            const sec = main.createEl('div', { cls: key === '__overdue' ? 'tc-group tc-overdue-group' : 'tc-group' });
            if (this.groupHead(sec, key, title, items.length)) {
                const list = sec.createEl('div', { cls: 'tc-list' });
                items.sort(byDate).forEach(t => renderTaskRow(this.app, list, t, refresh, Object.assign({ showDetails: this.showDetails, settings, plugin: this.plugin }, opts)));
            }
        };
        bucket('__overdue', t('Протерміновані'), od, { overdue: true });
        bucket('__next7', t('Наступні 7 днів'), n7, {});
        bucket('__later', t('Пізніше'), later, { showDate: true });
    }

    makeSortFn() {
        if (this.sortBy === 'priority') {
            return (a, b) => (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0) || a.text.localeCompare(b.text);
        }
        if (this.sortBy === 'date') return (a, b) => (a.date || '').localeCompare(b.date || '');
        if (this.sortBy === 'time') return (a, b) => (a.date || '').localeCompare(b.date || '') || dayOrder(a, b);
        return (a, b) => a.text.localeCompare(b.text);
    }

    buildGroups(tasks) {
        const groups = new Map();
        const push = (key, t) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(t); };
        for (const t of tasks) {
            // undated project tasks (no inline >date token) group under a placeholder,
            // never as a bare `null` key — that would crash humanDate()/localeCompare() below
            if (this.groupBy === 'date') push(t.date || '__nodate', t);
            else if (this.groupBy === 'group') push(t.group ? `@${t.group}` : 'Без групи', t);
            else if (this.groupBy === 'priority') push(t.priority ? t.priority : 'Без пріоритету', t);
            else if (this.groupBy === 'tag') {
                if (t.tags.length === 0) push('Без тегів', t);
                else t.tags.forEach(tag => push(`#${tag}`, t));
            }
        }
        const placeholder = ['Без групи', 'Без тегів', 'Без пріоритету', '__nodate'];
        const keys = [...groups.keys()].sort((a, b) => {
            const pa = placeholder.includes(a), pb = placeholder.includes(b);
            if (pa !== pb) return pa ? 1 : -1;
            if (this.groupBy === 'priority') return (priorityRank[b] || 0) - (priorityRank[a] || 0);
            return a.localeCompare(b);
        });
        return keys.map(k => [k, groups.get(k)]);
    }
}
