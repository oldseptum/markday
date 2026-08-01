// ─── Settings tab ────────────────────────────────────────────────────────────

import * as obsidian from 'obsidian';
import { DEFAULT_CHECKBOX_STATUSES, DEFAULT_SETTINGS, describeRule, genId, getDailyNotesConfig, priorityKeys, t } from './core.js';
import { HabitEditModal, ListManagerModal, RecurrenceEditModal, StatusEditModal } from './edit-modals.js';
import { attachDatalist } from './forms.js';

export class TaskCalendarSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    // Native settings section — the exact DOM structure core Obsidian renders its own
    // grouped settings with (.setting-group → heading .setting-item + a .setting-items
    // wrapper holding the rows), so the app/theme styling applies with no custom CSS:
    //   <div class="setting-group">
    //     <div class="setting-item setting-item-heading">…</div>
    //     <div class="setting-items"> …rows… </div>
    //   </div>
    section(containerEl, title) {
        const group = containerEl.createEl('div', { cls: 'setting-group' });
        new obsidian.Setting(group).setName(title).setHeading();
        return group.createEl('div', { cls: 'setting-items' });
    }
    note(group, text) {
        group.createEl('p', { text, cls: 'tc-group-note' });
    }
    // Compact "N шт." count used on summary rows for list-backed sections
    countDesc(n) {
        return n ? `${n} ${t('шт.')}` : t('Порожньо');
    }
    // Up/down/trash trio shared by every reorderable list in the manager modals
    reorderControls(row, list, idx, rerender) {
        const swap = async j => { [list[j], list[idx]] = [list[idx], list[j]]; await this.plugin.saveSettings(); rerender(); };
        row.addExtraButton(b => b.setIcon('arrow-up').setTooltip(t('Вище')).onClick(() => { if (idx > 0) swap(idx - 1); }));
        row.addExtraButton(b => b.setIcon('arrow-down').setTooltip(t('Нижче')).onClick(() => { if (idx < list.length - 1) swap(idx + 1); }));
        row.addExtraButton(b => b.setIcon('trash').setTooltip(t('Видалити')).onClick(async () => {
            list.splice(idx, 1); await this.plugin.saveSettings(); rerender();
        }));
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        this.renderGeneral(containerEl);
        this.renderTimeline(containerEl);
        this.renderDefaults(containerEl);
        this.renderScenarios(containerEl);
        this.renderCheckboxStatuses(containerEl);
        this.renderRecurrences(containerEl);
        this.renderHabits(containerEl);
        this.renderColors(containerEl);
    }

    renderGeneral(containerEl) {
        const group = this.section(containerEl, t('Загальне'));

        new obsidian.Setting(group)
            .setName(t('Мова'))
            .addDropdown(d => {
                d.addOption('auto', t('Авто')).addOption('uk', 'Українська').addOption('en', 'English');
                d.setValue(this.plugin.settings.language || 'auto');
                d.onChange(async v => { this.plugin.settings.language = v; await this.plugin.saveSettings(); this.display(); });
            });

        const dn = getDailyNotesConfig(this.app);
        const loc = dn.folder ? `${dn.folder}/` : '(vault root)';
        this.note(group, `Daily Notes: ${loc}${dn.format}.md`);

        new obsidian.Setting(group)
            .setName(t('Рівень заголовка'))
            .setDesc(t('Під яким рівнем заголовка зберігати задачі (# = 1 … ###### = 6)'))
            .addDropdown(d => {
                for (let i = 1; i <= 6; i++) d.addOption(String(i), `${'#'.repeat(i)} (рівень ${i})`);
                d.setValue(String(this.plugin.settings.headingLevel));
                d.onChange(async v => {
                    this.plugin.settings.headingLevel = Number(v);
                    await this.plugin.saveSettings();
                });
            });

        new obsidian.Setting(group)
            .setName(t('Текст заголовка'))
            .setDesc(t('Назва заголовка, під яким будуть задачі (напр. "Задачі" або "Tasks")'))
            .addText(c => {
                c.setPlaceholder('Задачі');
                c.setValue(this.plugin.settings.headingText);
                c.onChange(async v => {
                    this.plugin.settings.headingText = v.trim() || DEFAULT_SETTINGS.headingText;
                    await this.plugin.saveSettings();
                });
            });

        new obsidian.Setting(group)
            .setName(t('Перший день тижня'))
            .addDropdown(d => {
                d.addOption('1', t('Понеділок')).addOption('0', t('Неділя'));
                d.setValue(String(this.plugin.settings.firstDayOfWeek));
                d.onChange(async v => { this.plugin.settings.firstDayOfWeek = Number(v); await this.plugin.saveSettings(); });
            });
    }

    renderTimeline(containerEl) {
        const group = this.section(containerEl, t('Часова шкала'));

        new obsidian.Setting(group)
            .setName(t('Робочі години — початок'))
            .setDesc(t('На часовій шкалі раніші години згорнуті (можна розгорнути)'))
            .addDropdown(d => {
                for (let h = 0; h <= 23; h++) d.addOption(String(h), `${String(h).padStart(2, '0')}:00`);
                d.setValue(String(this.plugin.settings.workStart));
                d.onChange(async v => { this.plugin.settings.workStart = Number(v); await this.plugin.saveSettings(); });
            });

        new obsidian.Setting(group)
            .setName(t('Робочі години — кінець'))
            .setDesc(t('На часовій шкалі пізніші години згорнуті (можна розгорнути)'))
            .addDropdown(d => {
                for (let h = 1; h <= 24; h++) d.addOption(String(h), `${String(h).padStart(2, '0')}:00`);
                d.setValue(String(this.plugin.settings.workEnd));
                d.onChange(async v => { this.plugin.settings.workEnd = Number(v); await this.plugin.saveSettings(); });
            });

        new obsidian.Setting(group)
            .setName(t('Крок часової шкали'))
            .setDesc(t('Прилипання при перетягуванні/зміні розміру'))
            .addDropdown(d => {
                [5, 10, 15, 30, 60].forEach(m => d.addOption(String(m), `${m} хв`));
                d.setValue(String(this.plugin.settings.snapMinutes));
                d.onChange(async v => { this.plugin.settings.snapMinutes = Number(v); await this.plugin.saveSettings(); });
            });
    }

    renderDefaults(containerEl) {
        const s = this.plugin.settings;
        const group = this.section(containerEl, t('Стандартні значення'));
        this.note(group, t('Підставляються в нову задачу, якщо не вказані вручну.'));

        new obsidian.Setting(group).setName(t('Стандартний тег'))
            .addText(c => c.setPlaceholder('—').setValue(s.defaultTag)
                .onChange(async v => { s.defaultTag = v.trim().replace(/^#/, ''); await this.plugin.saveSettings(); }));
        new obsidian.Setting(group).setName(t('Стандартна група'))
            .addText(c => c.setPlaceholder('—').setValue(s.defaultGroup)
                .onChange(async v => { s.defaultGroup = v.trim().replace(/^@/, ''); await this.plugin.saveSettings(); }));
        new obsidian.Setting(group).setName(t('Стандартний пріоритет'))
            .addDropdown(d => {
                d.addOption('', '—');
                priorityKeys.forEach(k => d.addOption(k, k));
                d.setValue(s.defaultPriority || '');
                d.onChange(async v => { s.defaultPriority = v; await this.plugin.saveSettings(); });
            });
    }

    // ── list-backed sections: one summary row on the page + full editor in a popup ────────

    renderScenarios(containerEl) {
        const s = this.plugin.settings;
        const list = s.scenarios || (s.scenarios = []);
        const desc = t('Задачі в цих теках читаються з датою поруч із текстом (>РРРР-ММ-ДД), а не з назви файлу. Перший збіг теки перемагає; решта нотаток лишається щоденними.');
        const group = this.section(containerEl, t('Сценарії парсингу'));
        new obsidian.Setting(group)
            .setName(t('Проєктні теки'))
            .setDesc(`${this.countDesc(list.length)} · ${desc}`)
            .addButton(b => b.setButtonText(t('Налаштувати')).onClick(() => {
                new ListManagerModal(this.app, {
                    title: t('Сценарії парсингу'), desc,
                    render: (body, rerender) => this.renderScenarioRows(body, rerender),
                    onDone: () => this.display(),
                }).open();
            }));
    }
    renderScenarioRows(body, rerender) {
        const list = this.plugin.settings.scenarios;
        if (!list.length) body.createEl('p', { text: t('Поки немає сценаріїв.'), cls: 'setting-item-description' });
        const folders = this.app.vault.getAllLoadedFiles()
            .filter(f => f instanceof obsidian.TFolder && f.path !== '/')
            .map(f => f.path).sort();

        list.forEach((sc, idx) => {
            const row = new obsidian.Setting(body);
            row.addText(c => {
                c.setPlaceholder(t('Тека проєкту')).setValue(sc.folder || '')
                    .onChange(async v => { sc.folder = v.trim(); await this.plugin.saveSettings(); });
                attachDatalist(c.inputEl, folders);
            });
            this.reorderControls(row, list, idx, rerender);
        });
        new obsidian.Setting(body).addButton(b => b.setButtonText(t('+ сценарій')).setCta()
            .onClick(async () => {
                list.push({ id: genId(), folder: '', mode: 'project' });
                await this.plugin.saveSettings(); rerender();
            }));
    }

    renderCheckboxStatuses(containerEl) {
        const s = this.plugin.settings;
        const list = s.checkboxStatuses && s.checkboxStatuses.length ? s.checkboxStatuses : (s.checkboxStatuses = DEFAULT_CHECKBOX_STATUSES.map(x => ({ ...x })));
        const desc = t('Символ, що записується в "- [ ]". Клік по чекбоксу завжди перемикає звичайне todo/done; інші статуси — через праву кнопку миші.');
        const group = this.section(containerEl, t('Статуси чекбоксів'));
        new obsidian.Setting(group)
            .setName(t('Статуси'))
            .setDesc(`${this.countDesc(list.length)} · ${desc}`)
            .addButton(b => b.setButtonText(t('Налаштувати')).onClick(() => {
                new ListManagerModal(this.app, {
                    title: t('Статуси чекбоксів'), desc,
                    render: (body, rerender) => this.renderStatusRows(body, rerender),
                    onDone: () => this.display(),
                }).open();
            }));
    }
    renderStatusRows(body, rerender) {
        const s = this.plugin.settings;
        const list = s.checkboxStatuses;
        const behaviorLabel = { active: t('Активна'), done: t('Виконано'), cancelled: t('Скасовано') };
        list.forEach((st, idx) => {
            const row = new obsidian.Setting(body)
                .setName(t(st.label) || t('Нова'))
                .setDesc(`${st.char.trim() ? st.char : '·'}  ·  ${behaviorLabel[st.behavior] || st.behavior}`);
            const preview = document.createElement('span');
            preview.className = 'tc-status-row-icon';
            if (st.icon) obsidian.setIcon(preview, st.icon); else preview.textContent = st.char.trim() ? st.char : '·';
            row.settingEl.prepend(preview);
            row.addExtraButton(b => b.setIcon('pencil').setTooltip(t('Редагувати')).onClick(() => {
                new StatusEditModal(this.app, this.plugin, st, () => rerender()).open();
            }));
            this.reorderControls(row, list, idx, rerender);
        });
        new obsidian.Setting(body)
            .addButton(b => b.setButtonText(t('+ статус')).setCta().onClick(() => {
                new StatusEditModal(this.app, this.plugin, null, () => rerender()).open();
            }))
            .addButton(b => b.setButtonText(t('Скинути до стандартних')).onClick(async () => {
                s.checkboxStatuses = DEFAULT_CHECKBOX_STATUSES.map(x => ({ ...x }));
                await this.plugin.saveSettings(); rerender();
            }));
    }

    renderColors(containerEl) {
        const c = this.plugin.settings.colors;
        const group = this.section(containerEl, t('Кольори та пріоритети'));

        new obsidian.Setting(group)
            .setName(t('Пріоритети'))
            .setDesc(`${this.countDesc(c.priorities.length)} · ${t('Ключ використовується у тексті задачі як !ключ. Порядок = ранг.')}`)
            .addButton(b => b.setButtonText(t('Налаштувати')).onClick(() => {
                new ListManagerModal(this.app, {
                    title: t('Пріоритети'),
                    desc: t('Ключ використовується у тексті задачі як !ключ. Порядок = ранг (нижчий зверху, вищий знизу).'),
                    render: (body, rerender) => this.renderPriorityRows(body, rerender),
                    onDone: () => this.display(),
                }).open();
            }));
        new obsidian.Setting(group)
            .setName(t('Кольори тегів'))
            .setDesc(this.countDesc(c.tags.length))
            .addButton(b => b.setButtonText(t('Налаштувати')).onClick(() => {
                new ListManagerModal(this.app, {
                    title: t('Кольори тегів'),
                    render: (body, rerender) => this.renderColorRows(body, rerender, c.tags, '#тег (без #)'),
                    onDone: () => this.display(),
                }).open();
            }));
        new obsidian.Setting(group)
            .setName(t('Кольори груп'))
            .setDesc(this.countDesc(c.groups.length))
            .addButton(b => b.setButtonText(t('Налаштувати')).onClick(() => {
                new ListManagerModal(this.app, {
                    title: t('Кольори груп'),
                    render: (body, rerender) => this.renderColorRows(body, rerender, c.groups, '@група (без @)'),
                    onDone: () => this.display(),
                }).open();
            }));
    }
    renderPriorityRows(body, rerender) {
        const c = this.plugin.settings.colors;
        c.priorities.forEach((p, idx) => {
            const s = new obsidian.Setting(body);
            s.addText(c => c.setPlaceholder('ключ').setValue(p.key)
                .onChange(async v => { p.key = v.trim(); await this.plugin.saveSettings(); }));
            s.addColorPicker(cp => cp.setValue(p.color || '#888888')
                .onChange(async v => { p.color = v; await this.plugin.saveSettings(); }));
            this.reorderControls(s, c.priorities, idx, rerender);
        });
        new obsidian.Setting(body).addButton(b => b.setButtonText(t('+ пріоритет')).setCta()
            .onClick(async () => {
                c.priorities.push({ key: 'new', color: '#888888' });
                await this.plugin.saveSettings(); rerender();
            }));
    }
    renderColorRows(body, rerender, arr, placeholder) {
        arr.forEach((item, idx) => {
            const s = new obsidian.Setting(body);
            s.addText(c => c.setPlaceholder(placeholder).setValue(item.name)
                .onChange(async v => { item.name = v.trim(); await this.plugin.saveSettings(); }));
            s.addColorPicker(cp => cp.setValue(item.color || '#888888')
                .onChange(async v => { item.color = v; await this.plugin.saveSettings(); }));
            s.addExtraButton(b => b.setIcon('trash').setTooltip(t('Видалити')).onClick(async () => {
                arr.splice(idx, 1); await this.plugin.saveSettings(); rerender();
            }));
        });
        new obsidian.Setting(body).addButton(b => b.setButtonText(t('+ додати')).setCta()
            .onClick(async () => {
                arr.push({ name: '', color: '#888888' });
                await this.plugin.saveSettings(); rerender();
            }));
    }

    renderHabits(containerEl) {
        const wc = this.plugin.settings.wordCount;
        const habits = this.plugin.settings.habits || [];
        const group = this.section(containerEl, t('Звички'));

        new obsidian.Setting(group)
            .setName(t('Звичка: кількість написаних слів'))
            .setDesc(t('Автоматично рахує слова в нотатці дня'))
            .addToggle(c => c.setValue(wc.enabled).onChange(async v => { wc.enabled = v; await this.plugin.saveSettings(); this.display(); }));
        if (wc.enabled) {
            new obsidian.Setting(group).setName(t('— емодзі'))
                .addText(c => { c.setValue(wc.emoji || '').onChange(async v => { wc.emoji = v.trim(); await this.plugin.saveSettings(); }); c.inputEl.style.width = '3em'; });
            new obsidian.Setting(group).setName(t('— колір'))
                .addColorPicker(cp => cp.setValue(wc.color || '#9aa0a6').onChange(async v => { wc.color = v; await this.plugin.saveSettings(); }));
        }

        new obsidian.Setting(group)
            .setName(t('Звички'))
            .setDesc(this.countDesc(habits.length))
            .addButton(b => b.setButtonText(t('Налаштувати')).onClick(() => {
                new ListManagerModal(this.app, {
                    title: t('Звички'),
                    desc: t('Створення — через швидке створення (Ctrl+P). Тут — редагування та видалення.'),
                    render: (body, rerender) => this.renderHabitRows(body, rerender),
                    onDone: () => this.display(),
                }).open();
            }));
    }
    renderHabitRows(body, rerender) {
        const habits = this.plugin.settings.habits || [];
        if (!habits.length) body.createEl('p', { text: t('Поки немає звичок.'), cls: 'setting-item-description' });
        for (const h of habits) {
            new obsidian.Setting(body)
                .setName(h.name)
                .setDesc(`property: ${h.property} · ${h.type === 'bool' ? t('так/ні') : t('Кількість') + (h.unit ? ` (${h.unit})` : '')}`)
                .addExtraButton(b => b.setIcon('pencil').setTooltip(t('Редагувати'))
                    .onClick(() => new HabitEditModal(this.app, this.plugin, h, () => rerender()).open()))
                .addExtraButton(b => b.setIcon('trash').setTooltip(t('Видалити')).onClick(async () => {
                    this.plugin.settings.habits = habits.filter(x => x.id !== h.id);
                    await this.plugin.saveSettings();
                    rerender();
                }));
        }
    }

    renderRecurrences(containerEl) {
        const rules = this.plugin.settings.recurrences || [];
        const group = this.section(containerEl, t('Регулярні задачі'));

        new obsidian.Setting(group)
            .setName(t('Регулярна задача у списку'))
            .setDesc(t('Скільки наступних повторів показувати у списку'))
            .addText(c => {
                c.inputEl.type = 'number'; c.inputEl.min = '1'; c.inputEl.style.width = '5em';
                c.setValue(String(this.plugin.settings.recurrenceAhead || 1));
                c.onChange(async v => { this.plugin.settings.recurrenceAhead = Math.max(1, Number(v) || 1); await this.plugin.saveSettings(); });
            });

        new obsidian.Setting(group)
            .setName(t('Регулярні задачі'))
            .setDesc(this.countDesc(rules.length))
            .addButton(b => b.setButtonText(t('Налаштувати')).onClick(() => {
                new ListManagerModal(this.app, {
                    title: t('Регулярні задачі'),
                    desc: t('Створення — через швидке створення (Ctrl+P). Тут — редагування та видалення.'),
                    render: (body, rerender) => this.renderRecurrenceRows(body, rerender),
                    onDone: () => this.display(),
                }).open();
            }));
    }
    renderRecurrenceRows(body, rerender) {
        const rules = this.plugin.settings.recurrences || [];
        if (!rules.length) body.createEl('p', { text: t('Поки немає регулярних задач.'), cls: 'setting-item-description' });
        for (const rule of rules) {
            new obsidian.Setting(body)
                .setName(rule.raw)
                .setDesc(`${describeRule(rule)} · з ${rule.start}${rule.end ? ` до ${rule.end}` : ''}`)
                .addExtraButton(b => b.setIcon('pencil').setTooltip(t('Редагувати'))
                    .onClick(() => new RecurrenceEditModal(this.app, this.plugin, rule, () => rerender()).open()))
                .addExtraButton(b => b.setIcon('trash').setTooltip(t('Видалити')).onClick(async () => {
                    this.plugin.settings.recurrences = rules.filter(r => r.id !== rule.id);
                    await this.plugin.saveSettings();
                    rerender();
                }));
        }
    }
}
