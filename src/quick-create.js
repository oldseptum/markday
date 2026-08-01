// ─── Task / Habit creation (modals, inline composer, FAB) ─────────────────────

import * as obsidian from 'obsidian';
import { WD_UA, addDays, charForStatusId, describeRule, humanDate, mondayIdx, parseISO, prioColor, priorityKeys, t, toISO, todayISO } from './core.js';
import { buildChips, buildHabitFields, buildRecurrenceFields, buildRule, newHabitDraft, ruleFromRecDraft, validateHabit } from './forms.js';
import { applyDefaults, collectGroups, collectTags, getOrCreateDateFile, insertLineUnderHeading, serializeTaskBody, setDescription } from './store.js';

export function newComposerDraft(date) {
    return { text: '', date: date || todayISO(), start: null, end: null, priority: null, tags: [], group: null,
             status: 'todo', descText: '',
             rec: { freq: 'none', interval: 1, weekdays: [], monthMode: 'day', monthday: '', nth: 1, weekday: 0, which: 'first', month: new Date().getMonth() },
             _tagChips: null, _groupChips: null };
}

export function nextMonday() { const d = new Date(); return addDays(d, 7 - mondayIdx(d)); }

export function syncDraftChips(d) {
    if (d._tagChips) d.tags = d._tagChips.get();
    if (d._groupChips) d.group = d._groupChips.get()[0] || null;
}

export async function createFromDraft(app, plugin, d) {
    syncDraftChips(d);
    // sweep any #tag / @group tokens typed straight into the description into chips
    if (d.descText) {
        d.descText = d.descText.replace(/(^|\s)([#@])([^\s#@]+)/g, (m, pre, sig, val) => {
            if (sig === '#') { if (!d.tags.includes(val)) d.tags.push(val); }
            else { d.group = val; }
            return pre;
        }).replace(/[ \t]{2,}/g, ' ').trim();
    }
    const raw = serializeTaskBody(d);   // drafts carry the same field names as parsed tasks
    if (!raw.trim()) return;
    if (d.rec && d.rec.freq && d.rec.freq !== 'none') {
        plugin.settings.recurrences.push(buildRule(raw, d.date || todayISO(), null, d.rec));
        await plugin.saveSettings();
    } else {
        const file = await getOrCreateDateFile(app, d.date || todayISO());
        const mark = charForStatusId(d.status || 'todo');
        const lineNum = await insertLineUnderHeading(app, file, `- [${mark}] ${applyDefaults(raw, plugin.settings)}`, plugin.settings);
        if (d.descText && d.descText.trim() && lineNum != null) {
            await setDescription(app, file, { line: lineNum, text: d.text, descId: null }, d.descText, plugin.settings);
        }
    }
}

// date + time + recurrence options
export function buildScheduleFields(container, d, rerender) {
    new obsidian.Setting(container).setName(t('Дата'))
        .addText(c => { c.inputEl.type = 'date'; c.setValue(d.date || todayISO()).onChange(v => d.date = v); });
    new obsidian.Setting(container).setName(t('Час'))
        .addText(c => c.setPlaceholder('09:00').setValue(d.start || '').onChange(v => d.start = v.trim() || null))
        .addText(c => c.setPlaceholder('10:30').setValue(d.end || '').onChange(v => d.end = v.trim() || null));
    new obsidian.Setting(container).setName(t('Повторювати'))
        .addDropdown(dd => {
            dd.addOption('none', t('Без повтору')).addOption('daily', t('Щодня')).addOption('weekly', t('Щотижня')).addOption('monthly', t('Щомісяця'));
            dd.setValue(d.rec.freq).onChange(v => { d.rec.freq = v; rerender(); });
        });
    if (d.rec.freq !== 'none') {
        new obsidian.Setting(container).setName(t('Кожні N')).addText(c => c.setValue(String(d.rec.interval)).onChange(v => d.rec.interval = Math.max(1, Number(v) || 1)));
    }
    if (d.rec.freq === 'weekly') {
        const s = new obsidian.Setting(container).setName(t('Дні тижня'));
        WD_UA.forEach((w, i) => s.addButton(b => {
            b.setButtonText(w);
            if (d.rec.weekdays.includes(i)) b.setCta();
            b.onClick(() => { d.rec.weekdays = d.rec.weekdays.includes(i) ? d.rec.weekdays.filter(x => x !== i) : [...d.rec.weekdays, i]; rerender(); });
        }));
    }
}

// priority + tags + group
export function buildAttrFields(container, d, tags, groups) {
    new obsidian.Setting(container).setName(t('Пріоритет'))
        .addDropdown(dd => { dd.addOption('', '—'); priorityKeys.forEach(k => dd.addOption(k, k)); dd.setValue(d.priority || '').onChange(v => d.priority = v || null); });
    new obsidian.Setting(container).setName(t('Група')).setDesc(t('Enter — додати'))
        .then(s => { d._groupChips = buildChips(s.controlEl, d.group ? [d.group] : [], groups, true, t('група')); });
    new obsidian.Setting(container).setName(t('Теги')).setDesc(t('Enter — додати'))
        .then(s => { d._tagChips = buildChips(s.controlEl, d.tags, tags, false, t('+ тег')); });
}

// Floating popover anchored to an element; closes on outside click / Esc
export function openPopover(anchorEl, build) {
    const pop = document.body.createEl('div', { cls: 'tc-popover' });
    const close = () => {
        document.removeEventListener('mousedown', onDoc, true);
        document.removeEventListener('keydown', onKey, true);
        pop.remove();
    };
    const onDoc = e => { if (!pop.contains(e.target) && !anchorEl.contains(e.target)) close(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    build(pop, close);
    const a = anchorEl.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let left = Math.max(8, Math.min(a.right - pr.width, window.innerWidth - pr.width - 8));
    let top = a.bottom + 4;
    if (top + pr.height > window.innerHeight - 8) top = Math.max(8, a.top - pr.height - 4);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    setTimeout(() => {
        document.addEventListener('mousedown', onDoc, true);
        document.addEventListener('keydown', onKey, true);
    }, 0);
    return close;
}

// Inline composer: text field with two icons inside it; options open in popovers
export function renderTaskComposer(app, plugin, container, date, onCreate, defaults) {
    const d = newComposerDraft(date);
    if (defaults) { if (defaults.group) d.group = defaults.group; if (defaults.tags) d.tags = defaults.tags.slice(); }
    const field = container.createEl('div', { cls: 'tc-composer-field' });
    const input = field.createEl('input', { cls: 'tc-input tc-composer-input' });
    input.type = 'text';
    input.placeholder = t('Нова задача…');

    const create = async () => {
        d.text = input.value.trim();
        if (!d.text) return;
        await createFromDraft(app, plugin, d);
        onCreate();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });

    let tags = [], groups = [], loaded = false;
    const ensure = async () => { if (!loaded) { tags = collectTags(app); groups = await collectGroups(app, plugin.settings); loaded = true; } };
    const footer = (pop, close) => new obsidian.Setting(pop).addButton(b => b.setButtonText(t('Готово')).setCta().onClick(() => { syncDraftChips(d); close(); }));

    const icons = field.createEl('div', { cls: 'tc-composer-icons' });
    const cal = icons.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(cal, 'calendar-clock');
    cal.setAttribute('aria-label', t('Дата / час / повтор'));
    cal.onclick = async () => { await ensure(); openPopover(cal, (pop, close) => { const r = () => { pop.empty(); buildScheduleFields(pop, d, r); footer(pop, close); }; r(); }); };
    const more = icons.createEl('button', { cls: 'clickable-icon' }); obsidian.setIcon(more, 'sliders-horizontal');
    more.setAttribute('aria-label', t('Теги / пріоритет / група'));
    more.onclick = async () => { await ensure(); syncDraftChips(d); openPopover(more, (pop, close) => { buildAttrFields(pop, d, tags, groups); footer(pop, close); }); };

    return field;
}

// Inline #tag / @group autocomplete on a textarea. Calls onPick(sig, value) when a token
// is committed (the token text is first stripped from the textarea). Shared by the create
// modal's smart description and the task editor.
export function attachInlineTagAutocomplete(ta, tags, groups, onPick) {
    let sug = null, items = [], active = -1, token = null;
    const close = () => { if (sug) sug.remove(); sug = null; items = []; active = -1; token = null; };
    const commit = val => {
        if (!token || !val) { close(); return; }
        const sig = token.sig;
        ta.value = (ta.value.slice(0, token.start) + ta.value.slice(token.end)).replace(/[ \t]{2,}/g, ' ');
        ta.selectionStart = ta.selectionEnd = token.start;
        close();
        onPick(sig, val);
        ta.focus();
    };
    const render = () => {
        if (sug) sug.remove();
        sug = document.body.createEl('div', { cls: 'tc-suggest' });
        items.forEach((it, i) => {
            const row = sug.createEl('div', { cls: i === active ? 'tc-suggest-item is-active' : 'tc-suggest-item' });
            row.setText(token.sig + it);
            row.onmousedown = e => { e.preventDefault(); commit(it); };
        });
        const r = ta.getBoundingClientRect();
        sug.style.left = `${r.left}px`; sug.style.top = `${r.bottom + 2}px`; sug.style.minWidth = `${Math.min(r.width, 280)}px`;
    };
    const update = () => {
        const m = ta.value.slice(0, ta.selectionStart).match(/([#@])([^\s#@]*)$/);
        if (!m) { close(); return; }
        token = { sig: m[1], start: ta.selectionStart - m[0].length, end: ta.selectionStart };
        items = (m[1] === '#' ? tags : groups).filter(x => x.toLowerCase().includes(m[2].toLowerCase())).slice(0, 8);
        active = items.length ? 0 : -1;
        if (items.length) render(); else close();
    };
    ta.addEventListener('input', update);
    ta.addEventListener('keydown', e => {
        if (sug && items.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; render(); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(items[active]); return; }
            if (e.key === 'Escape') { close(); return; }
        }
        if (e.key === ' ' && token) { const frag = ta.value.slice(token.start + 1, ta.selectionStart); if (frag) { e.preventDefault(); commit(frag); } }
    });
    ta.addEventListener('blur', () => setTimeout(close, 150));
}

// Description textarea with inline #tag / @group autocomplete; picks become chips below.
export function buildSmartDescription(container, d, tags, groups) {
    const wrap = container.createEl('div', { cls: 'tc-smartdesc' });
    const ta = wrap.createEl('textarea', { cls: 'tc-editor-desc tc-smartdesc-input' });
    ta.rows = 4;
    ta.placeholder = t('Опис, теги #, групи @…');
    ta.value = d.descText || '';

    const chipsWrap = wrap.createEl('div', { cls: 'tc-chips tc-smartdesc-chips' });
    const drawChips = () => {
        chipsWrap.empty();
        const make = (val, kind) => {
            const chip = chipsWrap.createEl('span', { cls: kind === 'group' ? 'tc-chip tc-chip-group' : 'tc-chip' });
            chip.createSpan({ text: (kind === 'group' ? '@' : '#') + val });
            chip.createEl('span', { text: '✕', cls: 'tc-chip-x' }).onclick = () => {
                if (kind === 'group') d.group = null; else d.tags = d.tags.filter(x => x !== val);
                drawChips();
            };
        };
        d.tags.forEach(tg => make(tg, 'tag'));
        if (d.group) make(d.group, 'group');
        chipsWrap.toggleClass('tc-empty', !d.tags.length && !d.group);
    };
    drawChips();
    ta.addEventListener('input', () => d.descText = ta.value);
    attachInlineTagAutocomplete(ta, tags, groups, (sig, val) => {
        if (sig === '#') { if (!d.tags.includes(val)) d.tags.push(val); } else d.group = val;
        d.descText = ta.value; drawChips();
    });
}

// Date / time picker with quick buttons (Today / Tomorrow / Next Monday)
export class DatePickerModal extends obsidian.Modal {
    constructor(app, d, onDone) { super(app); this.d = d; this.onDone = onDone; }
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('tc-editor');
        contentEl.createEl('h3', { text: t('Дата та час') });
        new obsidian.Setting(contentEl).setName(t('Дата'))
            .addText(c => { c.inputEl.type = 'date'; c.setValue(this.d.date || todayISO()).onChange(v => this.d.date = v); });
        new obsidian.Setting(contentEl).setName(t('Час'))
            .addText(c => c.setPlaceholder('09:00').setValue(this.d.start || '').onChange(v => this.d.start = v.trim() || null))
            .addText(c => c.setPlaceholder('10:30').setValue(this.d.end || '').onChange(v => this.d.end = v.trim() || null));
        const done = () => { this.close(); if (this.onDone) this.onDone(); };
        const quick = contentEl.createEl('div', { cls: 'tc-quick-dates' });
        const pick = iso => { this.d.date = iso; done(); };
        quick.createEl('button', { text: t('Сьогодні') }).onclick = () => pick(todayISO());
        quick.createEl('button', { text: t('Завтра') }).onclick = () => pick(toISO(addDays(new Date(), 1)));
        quick.createEl('button', { text: t('Наступного понеділка') }).onclick = () => pick(toISO(nextMonday()));
        const footer = contentEl.createEl('div', { cls: 'tc-modal-btns' });
        footer.createEl('button', { text: t('Очистити') }).onclick = () => { this.d.start = null; this.d.end = null; done(); };
        footer.createEl('button', { text: t('Готово'), cls: 'mod-cta' }).onclick = done;
    }
    onClose() { this.contentEl.empty(); }
}

// Custom recurrence builder (wraps the shared schedule form, no raw/dates)
export class RecurrenceCustomModal extends obsidian.Modal {
    constructor(app, rec, onDone) { super(app); this.rec = rec; this.onDone = onDone; if (this.rec.freq === 'none') this.rec.freq = 'daily'; }
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('tc-editor');
        contentEl.createEl('h3', { text: t('Кастомне повторення') });
        const form = contentEl.createEl('div');
        const r = () => { form.empty(); buildRecurrenceFields(form, this.rec, r, { hideRaw: true, hideDates: true }); };
        r();
        const footer = contentEl.createEl('div', { cls: 'tc-modal-btns' });
        footer.createEl('button', { text: t('Скасувати') }).onclick = () => this.close();
        footer.createEl('button', { text: t('Готово'), cls: 'mod-cta' }).onclick = () => { this.close(); if (this.onDone) this.onDone(); };
    }
    onClose() { this.contentEl.empty(); }
}

// Full create modal (Ctrl+P "Створити задачу" + mobile FAB) — title, smart description, quick-param row
export class TaskCreateModal extends obsidian.Modal {
    constructor(app, plugin, date) { super(app); this.plugin = plugin; this.d = newComposerDraft(date || todayISO()); }
    async onOpen() {
        this.tags = collectTags(this.app);
        this.groups = await collectGroups(this.app, this.plugin.settings);
        this.render();
    }
    render() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('tc-editor', 'tc-create');

        const name = contentEl.createEl('input', { cls: 'tc-title-input' });
        name.placeholder = t('Назва задачі');
        name.value = this.d.text;
        name.addEventListener('input', () => this.d.text = name.value);
        name.addEventListener('keydown', e => { if (e.key === 'Enter') this.submit(); });
        setTimeout(() => name.focus(), 0);

        buildSmartDescription(contentEl, this.d, this.tags, this.groups);

        const row = contentEl.createEl('div', { cls: 'tc-quick-row' });
        const summary = contentEl.createEl('div', { cls: 'tc-quick-summary' });
        let statusBtn, prioBtn;
        const updateLabels = () => {
            const parts = [];
            if (this.d.date) parts.push('📅 ' + humanDate(this.d.date) + (this.d.start ? ' ' + this.d.start : ''));
            if (this.d.rec && this.d.rec.freq && this.d.rec.freq !== 'none') parts.push('↻ ' + describeRule(ruleFromRecDraft(this.d.rec)));
            summary.setText(parts.join('   ·   '));
            // status icon reflects todo / done / cancelled
            obsidian.setIcon(statusBtn, this.d.status === 'done' ? 'check-circle' : this.d.status === 'cancelled' ? 'x-circle' : 'circle');
            statusBtn.style.color = this.d.status === 'done' ? 'var(--color-green)' : this.d.status === 'cancelled' ? 'var(--color-red)' : '';
            statusBtn.toggleClass('is-set', this.d.status !== 'todo');
            // priority icon reflects the selected priority colour
            prioBtn.style.color = this.d.priority ? prioColor(this.d.priority) : '';
            prioBtn.toggleClass('is-set', !!this.d.priority);
        };
        const iconBtn = (icon, label, handler) => {
            const b = row.createEl('button', { cls: 'clickable-icon' });
            obsidian.setIcon(b, icon);
            b.setAttribute('aria-label', label);
            b.onclick = handler;
            return b;
        };

        statusBtn = iconBtn('circle', t('Статус'), e => {
            const menu = new obsidian.Menu();
            [['todo', t('Не виконана')], ['done', t('Виконана')], ['cancelled', t('Відмінена')]].forEach(o =>
                menu.addItem(it => it.setTitle(o[1]).setChecked(this.d.status === o[0]).onClick(() => { this.d.status = o[0]; updateLabels(); })));
            menu.showAtMouseEvent(e);
        });
        prioBtn = iconBtn('alert-circle', t('Пріоритет'), e => {
            const menu = new obsidian.Menu();
            menu.addItem(it => it.setTitle('—').setChecked(!this.d.priority).onClick(() => { this.d.priority = null; updateLabels(); }));
            priorityKeys.forEach(k => menu.addItem(it => it.setTitle(k).setChecked(this.d.priority === k).onClick(() => { this.d.priority = k; updateLabels(); })));
            menu.showAtMouseEvent(e);
        });
        iconBtn('calendar', t('Дата виконання'), () => new DatePickerModal(this.app, this.d, updateLabels).open());
        iconBtn('repeat', t('Повторення'), e => {
            const menu = new obsidian.Menu();
            const base = parseISO(this.d.date || todayISO());
            const setRec = rec => { Object.assign(this.d.rec, rec); updateLabels(); };
            menu.addItem(it => it.setTitle(t('Без повтору')).onClick(() => setRec({ freq: 'none' })));
            menu.addItem(it => it.setTitle(t('Щоденно')).onClick(() => setRec({ freq: 'daily', interval: 1 })));
            menu.addItem(it => it.setTitle(t('Щотижнево (поточний день)')).onClick(() => setRec({ freq: 'weekly', interval: 1, weekdays: [mondayIdx(base)] })));
            menu.addItem(it => it.setTitle(t('Щотижнево у робочі дні (Пн–Пт)')).onClick(() => setRec({ freq: 'weekly', interval: 1, weekdays: [0, 1, 2, 3, 4] })));
            menu.addItem(it => it.setTitle(t('Щомісячно (поточне число)')).onClick(() => setRec({ freq: 'monthly', interval: 1, monthMode: 'day', monthday: base.getDate() })));
            menu.addItem(it => it.setTitle(t('Щорічно (поточний день)')).onClick(() => setRec({ freq: 'yearly', interval: 1, month: base.getMonth(), monthMode: 'day', monthday: base.getDate() })));
            menu.addSeparator();
            menu.addItem(it => it.setTitle(t('Кастомне налаштування…')).onClick(() => new RecurrenceCustomModal(this.app, this.d.rec, updateLabels).open()));
            menu.showAtMouseEvent(e);
        });

        updateLabels();

        const footer = contentEl.createEl('div', { cls: 'tc-modal-btns' });
        footer.createEl('button', { text: t('Скасувати') }).onclick = () => this.close();
        footer.createEl('button', { text: t('Зберегти'), cls: 'mod-cta' }).onclick = () => this.submit();
    }
    async submit() {
        this.d.text = (this.contentEl.querySelector('.tc-title-input').value || '').trim();
        if (!this.d.text) { new obsidian.Notice(t('Введіть назву задачі')); return; }
        await createFromDraft(this.app, this.plugin, this.d);
        this.plugin.refreshViews();
        this.close();
    }
    onClose() { this.contentEl.empty(); }
}

// Habit create modal (Ctrl+P "Створити звичку")
export class HabitCreateModal extends obsidian.Modal {
    constructor(app, plugin) { super(app); this.plugin = plugin; this.d = newHabitDraft(); }
    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('tc-editor');
        contentEl.createEl('h3', { text: t('Нова звичка') });
        const form = contentEl.createEl('div');
        const r = () => { form.empty(); buildHabitFields(form, this.d, r); };
        r();
        const footer = contentEl.createEl('div', { cls: 'tc-modal-btns' });
        footer.createEl('button', { text: t('Скасувати') }).onclick = () => this.close();
        footer.createEl('button', { text: t('Створити'), cls: 'mod-cta' }).onclick = async () => {
            const h = validateHabit(this.d);
            if (!h) return;
            this.plugin.settings.habits.push(h);
            await this.plugin.saveSettings();
            this.close();
        };
    }
    onClose() { this.contentEl.empty(); }
}
