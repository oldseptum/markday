// ─── Task Editor Modal (4-layer card; saves live, no Save/Cancel buttons) ──────

import * as obsidian from 'obsidian';
import { COLORS, DEFAULT_SETTINGS, STATUSES, autoColor, charForStatusId, humanDate, prioColor, priorityKeys, statusForChar, t, todayISO } from './core.js';
import { RecurrenceEditModal } from './edit-modals.js';
import { buildRule } from './forms.js';
import { parseTasks } from './parser.js';
import { DatePickerModal, RecurrenceCustomModal, attachInlineTagAutocomplete } from './quick-create.js';
import { makeCheckbox, makeStatusCheckbox, openStatusMenu, tintBadge } from './render.js';
import { addChild, collectGroups, collectTags, moveTaskToDay, openDay, removeSubtask, removeTaskBlock, rewriteTaskLine, serializeTaskBody, setDescription, toggleSubtask } from './store.js';

export class TaskEditorModal extends obsidian.Modal {
    constructor(app, task, onClose, plugin) {
        super(app);
        this.file = task.file;
        this.line = task.line;       // stays valid within a file for the modal's lifetime
        this.date = task.date;       // current day (for the date picker + cross-day move)
        this.project = !!task.project;   // project-scenario task: date lives in an inline >token, not the file name
        this.task = task;
        this.onCloseCb = onClose;
        this._plugin = plugin || null;
        this.deleted = false;
        this._lineSave = obsidian.debounce(() => this.applyLine(), 400, false);
        this._descSave = obsidian.debounce(() => this.saveDescription(), 500, false);
    }

    get plugin() {
        // prefer the explicitly threaded plugin; the app.plugins lookup is a legacy
        // fallback for any call site that predates the 4th constructor argument
        return this._plugin
            || (this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins['markday'])
            || { settings: DEFAULT_SETTINGS };
    }

    async reload() {
        const content = await this.app.vault.read(this.file);
        const found = parseTasks(content, { inlineDate: this.project }).find(t => t.line === this.line);
        if (!found) { this.task = null; return; }
        if (this.project) this.date = found.dateToken;
        this.task = { ...found, file: this.file, date: this.date, project: this.project };
    }

    onOpen() {
        // closable like any modal (×, backdrop click, Esc) — safe because every edit
        // is saved live and onClose() flushes the debounced title/description saves
        this.renderAll();
    }

    // ── live persistence ─────────────────────────────────────────────────────
    async applyLine() { if (!this.deleted && this.task) await rewriteTaskLine(this.app, this.file, this.line, this.task); }
    async saveDescription() { if (!this.deleted && this.task && this.descInput) await setDescription(this.app, this.file, this.task, this.descInput.value, this.plugin.settings); }
    // statusId: any configured checkbox status id (not just the 3 built-ins) — see STATUSES
    async setStatus(statusId) {
        const st = STATUSES.find(s => s.id === statusId) || statusForChar(charForStatusId(statusId));
        this.task.statusChar = st.char;
        this.task.done = st.behavior === 'done';
        this.task.cancelled = st.behavior === 'cancelled';
        await this.applyLine();
        this.renderAll();
    }

    dateLabel() {
        const time = this.task.start ? ' · ' + (this.task.end ? `${this.task.start}–${this.task.end}` : this.task.start) : '';
        return (this.date ? humanDate(this.date) : t('Без дати')) + time;
    }

    openDatePicker() {
        const draft = { date: this.date, start: this.task.start, end: this.task.end };
        const apply = async () => {
            if (draft.date && draft.date !== this.date) {
                const loc = await moveTaskToDay(this.app, this.task, draft.date, draft.start || null, draft.end || null, this.plugin.settings);
                this.file = loc.file; this.line = loc.line; this.date = draft.date;
            } else {
                this.task.start = draft.start || null;
                this.task.end = (this.task.start && draft.end) ? draft.end : null;
                await this.applyLine();
            }
            this.renderAll();
        };
        new DatePickerModal(this.app, draft, apply).open();
    }

    async renderAll() {
        await this.reload();
        if (!this.task) { this.close(); return; }
        const tags = collectTags(this.app);
        const groups = await collectGroups(this.app, this.plugin.settings);
        this._groups = groups;

        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('tc-editor', 'tc-task-edit');

        // ── Layer 1: status checkbox · date/time · priority ──────────────────
        const l1 = contentEl.createEl('div', { cls: 'tc-te-l1' });
        const cb = makeStatusCheckbox(l1, this.task, checked => this.setStatus(checked ? 'done' : 'todo'), 'tc-te-check');
        cb.addEventListener('contextmenu', e => {
            e.preventDefault();
            openStatusMenu(e, this.task, st => this.setStatus(st.id));
        });

        const dateBtn = l1.createEl('button', { cls: 'tc-te-date' });
        const dic = dateBtn.createEl('span', { cls: 'tc-te-date-ic' }); obsidian.setIcon(dic, 'calendar');
        dateBtn.createEl('span', { cls: 'tc-te-date-txt', text: this.dateLabel() });
        dateBtn.onclick = () => this.openDatePicker();

        const prio = l1.createEl('button', { cls: 'tc-te-prio clickable-icon' });
        obsidian.setIcon(prio, 'alert-circle');
        prio.setAttribute('aria-label', t('Пріоритет'));
        if (this.task.priority) { prio.addClass('is-set'); prio.style.color = prioColor(this.task.priority); }
        prio.onclick = e => {
            const menu = new obsidian.Menu();
            menu.addItem(it => it.setTitle('—').setChecked(!this.task.priority).onClick(async () => { this.task.priority = null; await this.applyLine(); this.renderAll(); }));
            priorityKeys.forEach(k => menu.addItem(it => it.setTitle(k).setChecked(this.task.priority === k).onClick(async () => { this.task.priority = k; await this.applyLine(); this.renderAll(); })));
            menu.showAtMouseEvent(e);
        };

        // ── Layer 2: editable title ──────────────────────────────────────────
        const titleInput = contentEl.createEl('input', { cls: 'tc-title-input tc-te-title' });
        titleInput.placeholder = t('Назва задачі');
        titleInput.value = this.task.text || '';
        titleInput.addEventListener('input', () => { this.task.text = titleInput.value; this._lineSave(); });
        titleInput.addEventListener('blur', () => { this.task.text = titleInput.value.trim(); this.applyLine(); });

        // ── Layer 3: description (smart #/@) · subtasks · tag chips ───────────
        const l3 = contentEl.createEl('div', { cls: 'tc-te-l3' });
        const ta = l3.createEl('textarea', { cls: 'tc-editor-desc' });
        ta.rows = 4;
        ta.placeholder = t('Опис, теги #, групи @…');
        ta.value = this.task.desc || '';
        this.descInput = ta;
        ta.addEventListener('input', () => this._descSave());
        ta.addEventListener('blur', () => this.saveDescription());
        attachInlineTagAutocomplete(ta, tags, groups, (sig, val) => {
            if (sig === '#') { if (!this.task.tags.includes(val)) this.task.tags.push(val); this.drawTagChips(); }
            else { this.task.group = val; this.renderGroupBadge(); }
            this.applyLine();
        });

        this.subWrap = l3.createEl('div', { cls: 'tc-te-subs' });
        this.renderSubtasks();

        this.tagChipsEl = l3.createEl('div', { cls: 'tc-chips tc-te-tags' });
        this.drawTagChips();

        // ── Layer 4: group badge · more menu ─────────────────────────────────
        const l4 = contentEl.createEl('div', { cls: 'tc-te-l4' });
        this.groupSlot = l4.createEl('div', { cls: 'tc-te-groupslot' });
        this.renderGroupBadge();
        const more = l4.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(more, 'more-horizontal');
        more.setAttribute('aria-label', t('Ще'));
        more.onclick = e => this.moreMenu(e);
    }

    drawTagChips() {
        this.tagChipsEl.empty();
        for (const tg of (this.task.tags || [])) {
            const chip = this.tagChipsEl.createEl('span', { cls: 'tc-chip' });
            chip.createSpan({ text: '#' + tg });
            const col = COLORS.tags[tg]; if (col) tintBadge(chip, col);
            chip.createEl('span', { text: '✕', cls: 'tc-chip-x' }).onclick = () => { this.task.tags = this.task.tags.filter(x => x !== tg); this.applyLine(); this.drawTagChips(); };
        }
        const add = this.tagChipsEl.createEl('span', { cls: 'tc-chip tc-chip-add', text: '+' });
        add.setAttribute('aria-label', t('Додати тег у опис'));
        add.onclick = () => { this.descInput.focus(); };
    }

    renderGroupBadge() {
        this.groupSlot.empty();
        const badge = this.groupSlot.createEl('button', { cls: this.task.group ? 'tc-te-group' : 'tc-te-group tc-te-nogroup' });
        badge.setText(this.task.group ? '@' + this.task.group : t('без групи'));
        if (this.task.group) tintBadge(badge, COLORS.groups[this.task.group] || autoColor(this.task.group));
        badge.onclick = e => {
            const menu = new obsidian.Menu();
            menu.addItem(it => it.setTitle(t('без групи')).setChecked(!this.task.group).onClick(async () => { this.task.group = null; await this.applyLine(); this.renderGroupBadge(); }));
            for (const g of (this._groups || [])) menu.addItem(it => it.setTitle('@' + g).setChecked(this.task.group === g).onClick(async () => { this.task.group = g; await this.applyLine(); this.renderGroupBadge(); }));
            menu.showAtMouseEvent(e);
        };
    }

    moreMenu(e) {
        const menu = new obsidian.Menu();
        menu.addItem(it => it.setTitle(t('Відкрити нотатку')).setIcon('file-text').onClick(() => { openDay(this.app, this.date); this.close(); }));
        if (this.task.recId) {
            menu.addItem(it => it.setTitle(t('Редагувати регулярну задачу')).setIcon('repeat').onClick(() => {
                const rule = (this.plugin.settings.recurrences || []).find(r => r.id === this.task.recId);
                if (rule) new RecurrenceEditModal(this.app, this.plugin, rule, () => this.plugin.refreshViews && this.plugin.refreshViews()).open();
            }));
        } else {
            menu.addItem(it => it.setTitle(t('Зробити регулярною')).setIcon('repeat').onClick(() => this.convertToRecurring()));
        }
        menu.addSeparator();
        menu.addItem(it => it.setTitle(t('Видалити')).setIcon('trash').onClick(async () => {
            await removeTaskBlock(this.app, this.file, this.task);
            this.deleted = true;
            this.close();
        }));
        menu.showAtMouseEvent(e);
    }

    convertToRecurring() {
        const rec = { freq: 'daily', interval: 1, weekdays: [], monthMode: 'day', monthday: '', nth: 1, weekday: 0, which: 'first', month: new Date().getMonth() };
        new RecurrenceCustomModal(this.app, rec, async () => {
            const rule = buildRule(serializeTaskBody(this.task), this.date || todayISO(), null, rec);
            this.plugin.settings.recurrences.push(rule);
            await this.plugin.saveSettings();
            await removeTaskBlock(this.app, this.file, this.task);   // one-off line removed; now shows as a virtual recurrence
            this.deleted = true;
            if (this.plugin.refreshViews) this.plugin.refreshViews();
            this.close();
        }).open();
    }

    renderSubtasks() {
        this.subWrap.empty();
        for (const s of this.task.subtasks) {
            const r = this.subWrap.createEl('div', { cls: 'tc-subrow' });
            makeCheckbox(r, s.done, async checked => {
                await toggleSubtask(this.app, this.file, this.line, s.line, checked);
                await this.reload(); this.renderSubtasks();
            });
            r.createEl('span', { text: s.text || '(порожня)', cls: s.done ? 'tc-label tc-done' : 'tc-label' });
            r.createEl('span', { text: '✕', cls: 'tc-del' }).onclick = async () => {
                await removeSubtask(this.app, this.file, this.line, s.line);
                await this.reload(); this.renderSubtasks();
            };
        }
        const add = this.subWrap.createEl('div', { cls: 'tc-add-row' });
        const inp = add.createEl('input', { cls: 'tc-input' });
        inp.type = 'text';
        inp.placeholder = t('+ підзадача');
        inp.addEventListener('keydown', async e => {
            if (e.key !== 'Enter') return;
            const v = inp.value.trim();
            if (!v) return;
            await addChild(this.app, this.file, this.task, `- [ ] ${v}`);
            await this.reload(); this.renderSubtasks();
        });
    }

    onClose() {
        const text = this.descInput ? this.descInput.value : null;
        this.contentEl.empty();
        (async () => {
            if (!this.deleted && this.task) {
                await this.applyLine();
                if (text != null) await setDescription(this.app, this.file, this.task, text, this.plugin.settings);
            }
            if (this.onCloseCb) this.onCloseCb();
        })();
    }
}
