// ─── Reusable creation forms (shared by settings tab & quick-create modal) ─────

import * as obsidian from 'obsidian';
import { CHECKBOX_ICON_CHOICES, MONTHS_UA, WD_UA, describeRule, genId, parseISO, t, todayISO } from './core.js';

// Attach a native autocomplete <datalist> to an input (suggests existing tags / groups)
export function attachDatalist(inputEl, options) {
    if (!options || !options.length) return;
    const dl = document.createElement('datalist');
    dl.id = 'tcdl-' + Math.random().toString(36).slice(2, 9);
    for (const o of options) { const opt = document.createElement('option'); opt.value = o; dl.appendChild(opt); }
    inputEl.setAttribute('list', dl.id);
    inputEl.insertAdjacentElement('afterend', dl);
}

// Chip editor: type + Enter adds a chip (with datalist autocomplete). Returns { get: () => string[] }.
export function buildChips(container, values, options, single, placeholder) {
    const state = (values || []).filter(Boolean).slice();
    const wrap = container.createEl('div', { cls: 'tc-chips' });
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tc-chip-input';
    input.placeholder = placeholder || '';

    const draw = () => {
        wrap.empty();
        for (const v of state) {
            const chip = wrap.createEl('span', { cls: 'tc-chip' });
            chip.createSpan({ text: v });
            chip.createEl('span', { text: '✕', cls: 'tc-chip-x' }).onclick = () => {
                const i = state.indexOf(v); if (i >= 0) state.splice(i, 1); draw();
            };
        }
        wrap.appendChild(input);
        attachDatalist(input, options);
        input.focus();
    };

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const v = input.value.trim().replace(/^[#@]/, '');
            if (v) { if (single) state.length = 0; if (!state.includes(v)) state.push(v); }
            input.value = '';
            draw();
        } else if (e.key === 'Backspace' && !input.value && state.length) {
            state.pop(); draw();
        }
    });

    draw();
    input.blur();   // don't steal focus on initial render
    return { get: () => state.slice() };
}


// Map a recurrence draft → schedule fields of a rule (no id/raw/start/end). Shared by
// the create flow, the settings edit modal and the live preview.
export function ruleFromRecDraft(d) {
    const rule = { freq: d.freq, interval: Math.max(1, Number(d.interval) || 1) };
    if (d.freq === 'weekly') rule.weekdays = (d.weekdays || []).slice();
    if (d.freq === 'monthly' || d.freq === 'yearly') {
        rule.monthMode = d.monthMode || 'day';
        if (rule.monthMode === 'day') rule.monthday = Number(d.monthday) || null;
        else if (rule.monthMode === 'weekday') { rule.nth = Number(d.nth) || 1; rule.weekday = Number(d.weekday) || 0; }
        else if (rule.monthMode === 'workday') rule.which = d.which || 'first';
    }
    if (d.freq === 'yearly') rule.month = (d.month != null && d.month !== '') ? Number(d.month) : new Date().getMonth();
    return rule;
}
export function newHabitDraft() { return { name: '', property: '', unit: '', type: 'number', emoji: '', color: '#9aa0a6', goal: '' }; }

// Assemble a persisted recurrence rule from raw task text + dates + a schedule draft.
// Monthly/yearly rules in "by day of month" mode default their day to the start date's.
export function buildRule(raw, start, end, d) {
    const rule = Object.assign({ id: genId(), raw, start, end: end || null }, ruleFromRecDraft(d));
    if ((rule.freq === 'monthly' || rule.freq === 'yearly') && rule.monthMode === 'day' && !rule.monthday)
        rule.monthday = parseISO(start).getDate();
    return rule;
}

// Render recurrence fields into `containerEl`. `rerender` is called when the set of
// visible fields changes (frequency / weekday toggles) so the caller can rebuild.
// opts.hideRaw → omit the task-text field; opts.hideDates → omit start/end (create flow).
export function buildRecurrenceFields(containerEl, d, rerender, opts) {
    opts = opts || {};
    if (!opts.hideRaw) {
        new obsidian.Setting(containerEl).setName(t('Назва'))
            .setDesc(t('Формат задачі: "14:00 Полити квіти #дім !med"'))
            .addText(c => c.setPlaceholder(t('напр. Полити квіти #дім')).setValue(d.raw).onChange(v => d.raw = v));
    }

    new obsidian.Setting(containerEl).setName(t('Повторювати'))
        .addDropdown(dd => {
            dd.addOption('daily', t('Щодня')).addOption('weekly', t('Щотижня'))
              .addOption('monthly', t('Щомісяця')).addOption('yearly', t('Щороку'));
            dd.setValue(d.freq).onChange(v => { d.freq = v; rerender(); });
        });

    new obsidian.Setting(containerEl).setName(t('Кожні N'))
        .addText(c => c.setValue(String(d.interval)).onChange(v => d.interval = Math.max(1, Number(v) || 1)));

    if (d.freq === 'weekly') {
        const s = new obsidian.Setting(containerEl).setName(t('Дні тижня'));
        WD_UA.forEach((w, i) => s.addButton(b => {
            b.setButtonText(w);
            if (d.weekdays.includes(i)) b.setCta();
            b.onClick(() => {
                d.weekdays = d.weekdays.includes(i) ? d.weekdays.filter(x => x !== i) : [...d.weekdays, i];
                rerender();
            });
        }));
    }

    if (d.freq === 'yearly') {
        new obsidian.Setting(containerEl).setName(t('Місяць'))
            .addDropdown(dd => { MONTHS_UA.forEach((mn, i) => dd.addOption(String(i), mn)); dd.setValue(String(d.month != null ? d.month : new Date().getMonth())).onChange(v => d.month = Number(v)); });
    }

    if (d.freq === 'monthly' || d.freq === 'yearly') {
        new obsidian.Setting(containerEl).setName(t('Режим'))
            .addDropdown(dd => {
                dd.addOption('day', t('За днем місяця')).addOption('weekday', t('За днем тижня')).addOption('workday', t('Робочий день'));
                dd.setValue(d.monthMode || 'day').onChange(v => { d.monthMode = v; rerender(); });
            });
        const mode = d.monthMode || 'day';
        if (mode === 'day') {
            new obsidian.Setting(containerEl).setName(t('Число місяця'))
                .addText(c => c.setPlaceholder('1-31').setValue(String(d.monthday || '')).onChange(v => d.monthday = Number(v) || ''));
        } else if (mode === 'weekday') {
            new obsidian.Setting(containerEl).setName(t('Який'))
                .addDropdown(dd => { [['1', t('перший')], ['2', t('другий')], ['3', t('третій')], ['4', t('четвертий')], ['-1', t('останній')]].forEach(o => dd.addOption(o[0], o[1])); dd.setValue(String(d.nth || 1)).onChange(v => d.nth = Number(v)); })
                .addDropdown(dd => { WD_UA.forEach((w, i) => dd.addOption(String(i), w)); dd.setValue(String(d.weekday || 0)).onChange(v => d.weekday = Number(v)); });
        } else {
            new obsidian.Setting(containerEl).setName(t('Робочий день'))
                .addDropdown(dd => { dd.addOption('first', t('перший')).addOption('last', t('останній')); dd.setValue(d.which || 'first').onChange(v => d.which = v); });
        }
    }

    if (!opts.hideDates) {
        new obsidian.Setting(containerEl).setName(t('Початок'))
            .addText(c => { c.inputEl.type = 'date'; c.setValue(d.start).onChange(v => d.start = v); });
        new obsidian.Setting(containerEl).setName(t('Кінець (необов.)'))
            .addText(c => { c.inputEl.type = 'date'; c.setValue(d.end).onChange(v => d.end = v); });
    }

    containerEl.createEl('div', { cls: 'tc-rec-preview', text: '↻ ' + describeRule(ruleFromRecDraft(d)) });
}

export function validateRecurrence(d) {
    if (!d.raw.trim()) { new obsidian.Notice(t('Введіть текст задачі')); return null; }
    if (d.freq === 'weekly' && (d.weekdays || []).length === 0) { new obsidian.Notice(t('Оберіть хоча б один день тижня')); return null; }
    return buildRule(d.raw.trim(), d.start || todayISO(), d.end, d);
}

export function buildHabitFields(containerEl, d, rerender) {
    new obsidian.Setting(containerEl).setName(t('Назва'))
        .addText(c => c.setPlaceholder('Читання').setValue(d.name).onChange(v => d.name = v));
    new obsidian.Setting(containerEl).setName(t('Емодзі'))
        .setDesc(t('Компактна іконка звички'))
        .addText(c => { c.setPlaceholder('📖').setValue(d.emoji || ''); c.inputEl.maxLength = 4; c.inputEl.style.width = '3em'; c.onChange(v => d.emoji = v.trim()); });
    new obsidian.Setting(containerEl).setName(t('Колір'))
        .addColorPicker(cp => cp.setValue(d.color || '#9aa0a6').onChange(v => d.color = v));
    new obsidian.Setting(containerEl).setName(t('Назва property'))
        .setDesc(t('Ключ у властивостях файлу (напр. pages_read)'))
        .addText(c => c.setPlaceholder('pages_read').setValue(d.property).onChange(v => d.property = v));
    new obsidian.Setting(containerEl).setName(t('Тип виміру'))
        .addDropdown(dd => {
            dd.addOption('number', t('Кількість')).addOption('bool', t('Так / Ні'));
            dd.setValue(d.type).onChange(v => { d.type = v; rerender(); });
        });
    if (d.type === 'number') {
        new obsidian.Setting(containerEl).setName(t('Одиниці виміру'))
            .setDesc(t('напр. сторінки, км, хвилини'))
            .addText(c => c.setPlaceholder(t('сторінки')).setValue(d.unit).onChange(v => d.unit = v));
        new obsidian.Setting(containerEl).setName(t('Ціль на день'))
            .setDesc(t('Необов’язково — для кілець прогресу та %'))
            .addText(c => { c.inputEl.type = 'number'; c.setPlaceholder('30').setValue(d.goal != null ? String(d.goal) : '').onChange(v => d.goal = v.trim() === '' ? '' : (Number(v) || '')); });
    }
}

export function validateHabit(d) {
    const name = d.name.trim();
    const prop = d.property.trim();
    if (!name) { new obsidian.Notice(t('Введіть назву')); return null; }
    if (!prop) { new obsidian.Notice(t('Введіть назву property')); return null; }
    return { id: genId(), name, property: prop, type: d.type, unit: d.type === 'number' ? d.unit.trim() : '', emoji: (d.emoji || '').trim(), color: d.color || '', goal: d.type === 'number' ? (Number(d.goal) || null) : null };
}

export function newStatusDraft(status) {
    return status
        ? { id: status.id, char: status.char, label: status.label, behavior: status.behavior, icon: status.icon || '' }
        : { id: null, char: '/', label: '', behavior: 'active', icon: '' };
}

// Checkbox-status fields: char + label + behavior + icon (curated dropdown, or free-text
// via "Інша…" for any valid Lucide name) with a live preview of what Markday will draw.
export function buildStatusFields(containerEl, d, rerender) {
    new obsidian.Setting(containerEl).setName(t('Символ'))
        .setDesc(t('Один символ, що записується як "- [X] текст задачі"'))
        .addText(c => {
            c.inputEl.maxLength = 1; c.inputEl.style.width = '3em';
            c.setValue(d.char).onChange(v => { d.char = (v.trim() || v).slice(0, 1) || ' '; rerender(); });
        });
    new obsidian.Setting(containerEl).setName(t('Назва'))
        .addText(c => c.setPlaceholder(t('Нова')).setValue(d.label).onChange(v => d.label = v));
    new obsidian.Setting(containerEl).setName(t('Поведінка'))
        .setDesc(t('Як статус враховується: як відкрита задача, виконана чи скасована'))
        .addDropdown(dd => {
            dd.addOption('active', t('Активна')).addOption('done', t('Виконано')).addOption('cancelled', t('Скасовано'));
            dd.setValue(d.behavior).onChange(v => d.behavior = v);
        });

    const isCustomIcon = !!(d.icon && !CHECKBOX_ICON_CHOICES.includes(d.icon));
    const iconSetting = new obsidian.Setting(containerEl).setName(t('Іконка'))
        .setDesc(t('Показується у списках/календарі Markday замість символу (працює без сторонніх тем чи плагінів)'));
    iconSetting.addDropdown(dd => {
        dd.addOption('', t('Без іконки (лише символ)'));
        CHECKBOX_ICON_CHOICES.forEach(name => dd.addOption(name, name));
        dd.addOption('__custom', t('Інша…'));
        dd.setValue(isCustomIcon ? '__custom' : (d.icon || ''));
        dd.onChange(v => { d.icon = v === '__custom' ? (d.icon || 'circle') : v; rerender(); });
    });
    if (isCustomIcon) {
        iconSetting.addText(c => c.setPlaceholder('lucide-name').setValue(d.icon || '').onChange(v => { d.icon = v.trim(); }));
    }
    const preview = iconSetting.controlEl.createSpan({ cls: 'tc-icon-preview' });
    if (d.icon) obsidian.setIcon(preview, d.icon); else preview.setText(d.char.trim() ? d.char : '·');
}

export function validateStatus(d) {
    // d.char is kept to exactly one character by buildStatusFields' onChange (defaults to
    // a space if cleared), so it never needs the same "empty" guard as label/property below.
    const char = (d.char || ' ').slice(0, 1);
    const label = (d.label || '').trim();
    if (!label) { new obsidian.Notice(t('Введіть назву')); return null; }
    return { id: d.id || genId(), char, label, behavior: d.behavior || 'active', icon: (d.icon || '').trim() };
}
