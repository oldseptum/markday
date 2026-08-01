// ─── Plugin ──────────────────────────────────────────────────────────────────

import * as obsidian from 'obsidian';
import { CalendarView } from './calendar-view.js';
import { CAL_VIEW, DEFAULT_CHECKBOX_STATUSES, DEFAULT_SETTINGS, HABITS_VIEW, LIST_VIEW, MINI_VIEW, applyConfig, t, todayISO } from './core.js';
import { HabitsView } from './habits-view.js';
import { ListView } from './list-view.js';
import { MiniCalendarView } from './mini-calendar-view.js';
import { HabitCreateModal, TaskCreateModal } from './quick-create.js';
import { TaskCalendarSettingTab } from './settings-tab.js';
import { getOrCreateDateFile, invalidateTaskCache } from './store.js';

export class TaskCalendarPlugin extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();

        this.registerView(LIST_VIEW, leaf => new ListView(leaf, this));
        this.registerView(CAL_VIEW, leaf => new CalendarView(leaf, this));
        this.registerView(HABITS_VIEW, leaf => new HabitsView(leaf, this));
        this.registerView(MINI_VIEW, leaf => new MiniCalendarView(leaf, this));

        this.addRibbonIcon('list-checks', t('Markday — Список'), () => this.openView(LIST_VIEW));
        this.addRibbonIcon('calendar', t('Markday — Календар'), () => this.openView(CAL_VIEW));
        this.addRibbonIcon('check-circle', t('Markday — Звички'), () => this.openView(HABITS_VIEW));
        this.addRibbonIcon('calendar-days', t('Markday — Міні-календар'), () => this.openView(MINI_VIEW, true));

        this.addCommand({ id: 'open-calendar', name: t('Відкрити Календар'), callback: () => this.openView(CAL_VIEW) });
        this.addCommand({ id: 'open-list', name: t('Відкрити Список задач'), callback: () => this.openView(LIST_VIEW) });
        this.addCommand({ id: 'open-habits', name: t('Відкрити Звички'), callback: () => this.openView(HABITS_VIEW) });
        this.addCommand({ id: 'open-mini', name: t('Відкрити Міні-календар (бічна панель)'), callback: () => this.openView(MINI_VIEW, true) });
        this.addCommand({
            id: 'open-today-file', name: t('Відкрити/створити нотатку сьогодні'),
            callback: async () => {
                const file = await getOrCreateDateFile(this.app, todayISO());
                this.app.workspace.getLeaf().openFile(file);
            }
        });
        this.addCommand({
            id: 'create-task', name: t('Створити задачу'),
            callback: () => new TaskCreateModal(this.app, this).open()
        });
        this.addCommand({
            id: 'create-habit', name: t('Створити звичку'),
            callback: () => new HabitCreateModal(this.app, this).open()
        });

        this.addSettingTab(new TaskCalendarSettingTab(this.app, this));

        // parse-cache invalidation (belt & braces on top of the mtime check in parseFileCached)
        this.registerEvent(this.app.vault.on('modify', f => invalidateTaskCache(f.path)));
        this.registerEvent(this.app.vault.on('delete', f => invalidateTaskCache(f.path)));
        this.registerEvent(this.app.vault.on('rename', (f, oldPath) => { invalidateTaskCache(f.path); invalidateTaskCache(oldPath); }));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        // copy arrays/objects so we never mutate DEFAULT_SETTINGS
        this.settings.recurrences = (this.settings.recurrences || []).slice();
        this.settings.habits = (this.settings.habits || []).slice();
        this.settings.scenarios = (this.settings.scenarios || []).map(x => ({ ...x }));
        this.settings.checkboxStatuses = (this.settings.checkboxStatuses && this.settings.checkboxStatuses.length)
            ? this.settings.checkboxStatuses.map(x => ({ ...x }))
            : DEFAULT_CHECKBOX_STATUSES.map(x => ({ ...x }));
        this.settings.wordCount = Object.assign({}, DEFAULT_SETTINGS.wordCount, this.settings.wordCount);
        const c = this.settings.colors || {};
        this.settings.colors = {
            priorities: (c.priorities || DEFAULT_SETTINGS.colors.priorities).map(x => ({ ...x })),
            tags: (c.tags || []).map(x => ({ ...x })),
            groups: (c.groups || []).map(x => ({ ...x }))
        };
        applyConfig(this.settings);
    }

    async saveSettings() {
        await this.saveData(this.settings);
        applyConfig(this.settings);
        invalidateTaskCache();   // priority keys / scenarios feed the parser → cached parses are stale
        this.refreshViews();
    }

    refreshViews() {
        [LIST_VIEW, CAL_VIEW, HABITS_VIEW, MINI_VIEW].forEach(type =>
            this.app.workspace.getLeavesOfType(type).forEach(l => {
                if (l.view && l.view.refresh) l.view.refresh();
            }));
    }

    async openView(type, left = false) {
        this.app.workspace.detachLeavesOfType(type);
        // on mobile open full-screen in the main area; on desktop use a side panel
        const leaf = obsidian.Platform.isMobile
            ? this.app.workspace.getLeaf(false)
            : (left ? this.app.workspace.getLeftLeaf(false) : this.app.workspace.getRightLeaf(false));
        await leaf.setViewState({ type, active: true });
        this.app.workspace.revealLeaf(leaf);
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(LIST_VIEW);
        this.app.workspace.detachLeavesOfType(CAL_VIEW);
        this.app.workspace.detachLeavesOfType(HABITS_VIEW);
        this.app.workspace.detachLeavesOfType(MINI_VIEW);
    }
}

export default TaskCalendarPlugin;