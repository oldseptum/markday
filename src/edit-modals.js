// ─── Edit modals for recurrences, habits & checkbox statuses ───────────────────

import * as obsidian from 'obsidian';
import { t } from './core.js';
import { buildHabitFields, buildRecurrenceFields, buildStatusFields, newStatusDraft, validateHabit, validateRecurrence, validateStatus } from './forms.js';

// Generic "manage a whole list in one popup" modal — opened from a settings section's
// "Налаштувати" button so a potentially long list (tags, groups, statuses, …) never
// clutters the main settings page; the page just shows one summary row. `render(bodyEl,
// rerender)` draws the current rows into bodyEl and is called again after any add / edit /
// reorder / delete so the list redraws in place without closing the modal. `onDone` runs on
// close, to refresh the summary row's count back on the settings page.
export class ListManagerModal extends obsidian.Modal {
    constructor(app, opts) {
        super(app);
        this.title = opts.title;
        this.desc = opts.desc;
        this.render = opts.render;
        this.onDone = opts.onDone;
    }
    onOpen() {
        this.modalEl.addClass('tc-list-modal');
        const { contentEl } = this;
        contentEl.addClass('tc-editor');
        contentEl.createEl('h3', { text: this.title });
        if (this.desc) contentEl.createEl('p', { text: this.desc, cls: 'setting-item-description' });
        const body = contentEl.createEl('div', { cls: 'tc-list-modal-body' });
        const rerender = () => { body.empty(); this.render(body, rerender); };
        rerender();
        const footer = contentEl.createEl('div', { cls: 'tc-modal-btns' });
        footer.createEl('button', { text: t('Готово'), cls: 'mod-cta' }).onclick = () => this.close();
    }
    onClose() {
        this.contentEl.empty();
        if (this.onDone) this.onDone();
    }
}

export class RecurrenceEditModal extends obsidian.Modal {
    constructor(app, plugin, rule, onSave) {
        super(app);
        this.plugin = plugin;
        this.rule = rule;
        this.onSave = onSave;
        this.draft = {
            raw: rule.raw, freq: rule.freq, interval: rule.interval || 1,
            weekdays: (rule.weekdays || []).slice(), monthMode: rule.monthMode || 'day',
            monthday: rule.monthday || '', nth: rule.nth || 1, weekday: rule.weekday || 0,
            which: rule.which || 'first', month: rule.month != null ? rule.month : new Date().getMonth(),
            start: rule.start, end: rule.end || ''
        };
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('tc-editor');
        contentEl.createEl('h3', { text: t('Редагувати регулярну задачу') });
        const form = contentEl.createEl('div');
        const r = () => { form.empty(); buildRecurrenceFields(form, this.draft, r); };
        r();
        const footer = contentEl.createEl('div', { cls: 'tc-modal-btns' });
        footer.createEl('button', { text: t('Скасувати') }).onclick = () => this.close();
        footer.createEl('button', { text: t('Зберегти'), cls: 'mod-cta' }).onclick = async () => {
            const updated = validateRecurrence(this.draft);
            if (!updated) return;
            updated.id = this.rule.id;
            const arr = this.plugin.settings.recurrences;
            const i = arr.findIndex(x => x.id === this.rule.id);
            if (i >= 0) arr[i] = updated;
            await this.plugin.saveSettings();
            this.close();
            if (this.onSave) this.onSave();
        };
    }
    onClose() { this.contentEl.empty(); }
}

// status: existing entry to edit, or null to create a new one
export class StatusEditModal extends obsidian.Modal {
    constructor(app, plugin, status, onSave) {
        super(app);
        this.plugin = plugin;
        this.status = status;
        this.onSave = onSave;
        this.draft = newStatusDraft(status);
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('tc-editor');
        contentEl.createEl('h3', { text: this.status ? t('Редагувати статус') : t('Новий статус') });
        const form = contentEl.createEl('div');
        const r = () => { form.empty(); buildStatusFields(form, this.draft, r); };
        r();
        const footer = contentEl.createEl('div', { cls: 'tc-modal-btns' });
        footer.createEl('button', { text: t('Скасувати') }).onclick = () => this.close();
        footer.createEl('button', { text: t('Зберегти'), cls: 'mod-cta' }).onclick = async () => {
            const updated = validateStatus(this.draft);
            if (!updated) return;
            const arr = this.plugin.settings.checkboxStatuses;
            if (this.status) {
                const i = arr.findIndex(x => x.id === this.status.id);
                if (i >= 0) arr[i] = updated;
            } else {
                arr.push(updated);
            }
            await this.plugin.saveSettings();
            this.close();
            if (this.onSave) this.onSave();
        };
    }
    onClose() { this.contentEl.empty(); }
}

export class HabitEditModal extends obsidian.Modal {
    constructor(app, plugin, habit, onSave) {
        super(app);
        this.plugin = plugin;
        this.habit = habit;
        this.onSave = onSave;
        this.draft = { name: habit.name, property: habit.property, unit: habit.unit || '', type: habit.type, emoji: habit.emoji || '', color: habit.color || '#9aa0a6', goal: habit.goal || '' };
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('tc-editor');
        contentEl.createEl('h3', { text: t('Редагувати звичку') });
        const form = contentEl.createEl('div');
        const r = () => { form.empty(); buildHabitFields(form, this.draft, r); };
        r();
        const footer = contentEl.createEl('div', { cls: 'tc-modal-btns' });
        footer.createEl('button', { text: t('Скасувати') }).onclick = () => this.close();
        footer.createEl('button', { text: t('Зберегти'), cls: 'mod-cta' }).onclick = async () => {
            const updated = validateHabit(this.draft);
            if (!updated) return;
            updated.id = this.habit.id;
            const arr = this.plugin.settings.habits;
            const i = arr.findIndex(x => x.id === this.habit.id);
            if (i >= 0) arr[i] = updated;
            await this.plugin.saveSettings();
            this.close();
            if (this.onSave) this.onSave();
        };
    }
    onClose() { this.contentEl.empty(); }
}
