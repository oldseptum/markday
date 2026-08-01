// ─── Mini Calendar View (sidebar) ────────────────────────────────────────────

import * as obsidian from 'obsidian';
import { MINI_VIEW, MONTHS_UA, dateToPath, monthGridDays, parseISO, t, toISO, todayISO, weekdayHeaders } from './core.js';
import { attachSwipeNav } from './gestures.js';
import { getOrCreateDateFile, loadAllTasks, openDay } from './store.js';

export class MiniCalendarView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.anchor = new Date();
    }

    getViewType() { return MINI_VIEW; }
    getDisplayText() { return t('Міні-календар'); }
    getIcon() { return 'calendar-days'; }

    async onOpen() {
        await this.refresh();
        // keep dots/cards in sync when day files change (debounced to coalesce bursts)
        const bump = obsidian.debounce(() => this.refresh(), 250, true);
        this.registerEvent(this.app.vault.on('modify', bump));
        this.registerEvent(this.app.vault.on('create', bump));
        this.registerEvent(this.app.vault.on('delete', bump));
        this.registerEvent(this.app.vault.on('rename', bump));
    }

    shift(dir) {
        this.anchor = new Date(this.anchor.getFullYear(), this.anchor.getMonth() + dir, 1);
        this.refresh();
    }

    async refresh() {
        const map = await loadAllTasks(this.app);   // load before clearing DOM

        const root = this.containerEl.children[1];
        root.empty();
        root.addClass('tc-pane', 'tcm-pane');

        const bar = root.createEl('div', { cls: 'tcm-header' });
        bar.createEl('button', { text: '‹', cls: 'tcm-nav' }).onclick = () => this.shift(-1);
        const title = bar.createEl('div', { text: `${MONTHS_UA[this.anchor.getMonth()]} ${this.anchor.getFullYear()}`, cls: 'tcm-title' });
        title.onclick = () => { this.anchor = new Date(); this.refresh(); };
        bar.createEl('button', { text: '›', cls: 'tcm-nav' }).onclick = () => this.shift(1);

        const grid = root.createEl('div', { cls: 'tcm-grid' });
        attachSwipeNav(grid, () => this.shift(-1), () => this.shift(1));
        for (const wd of weekdayHeaders()) grid.createEl('div', { text: wd, cls: 'tcm-wd' });

        const todayStr = todayISO();

        for (const day of monthGridDays(this.anchor.getFullYear(), this.anchor.getMonth())) {
            const iso = toISO(day);
            const cell = grid.createEl('div', { cls: 'tcm-cell' });
            if (day.getMonth() !== this.anchor.getMonth()) cell.addClass('tcm-outside');
            if (iso === todayStr) cell.addClass('tcm-today');

            const entry = map.get(iso);
            if (entry) cell.addClass('tcm-has-file');   // file exists → distinct card

            cell.createEl('div', { text: String(day.getDate()), cls: 'tcm-num' });

            const dots = cell.createEl('div', { cls: 'tcm-dots' });
            if (entry && entry.tasks.length) {
                const total = entry.tasks.length;
                const done = entry.tasks.filter(t => t.done).length;
                if (done === 0) miniDot(dots, false);
                else if (done === total) miniDot(dots, true);
                else { miniDot(dots, true); miniDot(dots, false); }
            }

            cell.onclick = () => openDay(this.app, iso);
            cell.oncontextmenu = evt => this.showDayMenu(evt, iso);
        }
    }

    showDayMenu(evt, iso) {
        evt.preventDefault();
        const file = this.app.vault.getAbstractFileByPath(dateToPath(this.app, parseISO(iso)));
        const menu = new obsidian.Menu();
        if (file) {
            // populate with Obsidian's standard file-context items (open, rename, delete, move, …)
            this.app.workspace.trigger('file-menu', menu, file, 'mini-calendar');
        } else {
            menu.addItem(item => item
                .setTitle(t('Створити нотатку'))
                .setIcon('file-plus')
                .onClick(async () => {
                    const f = await getOrCreateDateFile(this.app, iso);
                    this.app.workspace.getLeaf().openFile(f);
                }));
        }
        menu.showAtMouseEvent(evt);
    }
}

export function miniDot(container, filled) {
    container.createEl('span', { cls: filled ? 'tcm-dot tcm-dot-filled' : 'tcm-dot tcm-dot-hollow' });
}
