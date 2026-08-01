// ─── Core: config, i18n, dates, recurrence engine, habits, daily-notes paths ───

import * as obsidian from 'obsidian';
import { parseTaskLine } from './parser.js';
import { getOrCreateDateFile, insertLineUnderHeading } from './store.js';

export const LIST_VIEW   = 'md-task-calendar-list';
export const CAL_VIEW    = 'md-task-calendar-cal';
export const HABITS_VIEW = 'md-task-calendar-habits';
export const MINI_VIEW   = 'md-task-calendar-mini';

// Coloring config is data-driven (from settings.colors); these are updated by applyConfig()
export let priorityKeys = ['low', 'med', 'high', 'urgent'];
export let priorityRank = { low: 1, med: 2, high: 3, urgent: 4 };
export let COLORS = { priorities: {}, tags: {}, groups: {} };
export let weekStartDay = 1;   // 0 = Sunday, 1 = Monday
export let SCENARIOS = [];     // [{ id, folder, mode: 'project' }] ordered; first matching folder wins

export function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ─── Checkbox statuses ────────────────────────────────────────────────────────
// A task's checkbox mark (the char inside `[ ]`) drives three independent things:
// its `behavior` — 'active' (open/pending), 'done', or 'cancelled' — which is what the
// rest of the app (habits, overdue, subtask roll-up, sorting) actually checks; its
// `char`/`label`, used when writing the mark back or listing it in a menu; and its
// `icon` — a built-in Obsidian/Lucide icon name (rendered via obsidian.setIcon, so it
// looks native with zero themes/snippets installed) shown instead of the bare character
// wherever Markday draws its own checkbox. Anything beyond plain todo/done/cancelled
// (in-progress, forwarded, …) is still just an 'active' mark as far as behavior goes —
// it doesn't complete the task, it's a richer "todo".
export const DEFAULT_CHECKBOX_STATUSES = [
    { id: 'todo', char: ' ', label: 'Не виконано', behavior: 'active', icon: '' },
    { id: 'done', char: 'x', label: 'Виконано', behavior: 'done', icon: '' },
    { id: 'cancelled', char: '-', label: 'Скасовано', behavior: 'cancelled', icon: 'x' },
    { id: 'in-progress', char: '/', label: 'У роботі', behavior: 'active', icon: 'clock' },
    { id: 'forwarded', char: '>', label: 'Перенесено', behavior: 'cancelled', icon: 'corner-up-right' },
    { id: 'scheduled', char: '<', label: 'Заплановано', behavior: 'active', icon: 'calendar-clock' },
    { id: 'important', char: '!', label: 'Важливо', behavior: 'active', icon: 'alert-triangle' },
    { id: 'question', char: '?', label: 'Під питанням', behavior: 'active', icon: 'help-circle' },
];
// Curated picks offered in the status-icon dropdown (Settings → Checkbox statuses). Any
// valid Lucide name works even if not listed here — "custom…" reveals a free-text field.
export const CHECKBOX_ICON_CHOICES = [
    'x', 'clock', 'corner-up-right', 'corner-down-right', 'calendar-clock', 'alert-triangle',
    'help-circle', 'flag', 'star', 'flame', 'zap', 'pause', 'play', 'rewind', 'fast-forward',
    'ban', 'circle-slash', 'thumbs-up', 'thumbs-down', 'message-circle', 'info', 'alert-circle',
    'bookmark', 'pin', 'eye', 'lock', 'circle-dot', 'loader-circle',
];
export let STATUSES = DEFAULT_CHECKBOX_STATUSES;
export let STATUS_BY_CHAR = new Map(STATUSES.map(s => [s.char, s]));

// Raw checkbox char -> its configured status. A char with no matching entry (e.g. a mark
// from another plugin/vault that hasn't been added here) degrades gracefully instead of
// crashing: 'x' still reads as done and '-' as cancelled, anything else as a plain active mark.
export function statusForChar(ch) {
    return STATUS_BY_CHAR.get(ch) || { id: null, char: ch, label: ch, behavior: ch === 'x' ? 'done' : ch === '-' ? 'cancelled' : 'active' };
}
// statusId (or the 3 built-in literals) -> the char to write. Falls back to the built-in
// mapping if that id was renamed/removed from settings, so old call sites never break.
export function charForStatusId(id) {
    const found = STATUSES.find(s => s.id === id);
    if (found) return found.char;
    if (id === 'done') return 'x';
    if (id === 'cancelled') return '-';
    return ' ';
}
// A task's effective on-disk mark: the exact statusChar it was parsed with (preserves
// rich statuses like in-progress through edits), or the plain done/cancelled/todo trio
// for tasks that never carried one (created fresh, or from an older flow).
export function taskMark(task) {
    return task.statusChar != null ? task.statusChar : (task.cancelled ? '-' : task.done ? 'x' : ' ');
}

// ─── i18n (Ukrainian source strings → English) ─────────────────────────────────
export let LANG = 'uk';
export function resolveLang(settings) {
    const s = settings && settings.language;
    if (s === 'uk' || s === 'en') return s;
    const l = ((window.localStorage && window.localStorage.getItem('language')) || '').toLowerCase();
    return l.startsWith('uk') ? 'uk' : 'en';   // auto: Ukrainian app → uk, otherwise English
}
export function t(s) { return LANG === 'en' ? (I18N[s] || s) : s; }

export function applyConfig(settings) {
    const c = (settings && settings.colors) || {};
    priorityKeys = (c.priorities || []).map(p => p.key).filter(Boolean);
    if (!priorityKeys.length) priorityKeys = ['low', 'med', 'high', 'urgent'];
    priorityRank = {};
    priorityKeys.forEach((k, i) => priorityRank[k] = i + 1);
    COLORS = { priorities: {}, tags: {}, groups: {} };
    (c.priorities || []).forEach(p => { if (p.key) COLORS.priorities[p.key] = p.color; });
    (c.tags || []).forEach(t => { if (t.name) COLORS.tags[t.name] = t.color; });
    (c.groups || []).forEach(g => { if (g.name) COLORS.groups[g.name] = g.color; });
    weekStartDay = (settings && settings.firstDayOfWeek != null) ? settings.firstDayOfWeek : 1;
    SCENARIOS = (settings && settings.scenarios) || [];
    STATUSES = (settings && settings.checkboxStatuses && settings.checkboxStatuses.length) ? settings.checkboxStatuses : DEFAULT_CHECKBOX_STATUSES;
    STATUS_BY_CHAR = new Map(STATUSES.map(s => [s.char, s]));
    LANG = resolveLang(settings);
    MONTHS_UA = LANG === 'en' ? MONTHS_EN : MONTHS_UK;
    MONTHS_GEN = LANG === 'en' ? MONTHS_EN : MONTHS_GEN_UK;
    WD_UA = LANG === 'en' ? WD_EN : WD_UK;
    WD_FULL = LANG === 'en' ? WD_FULL_EN : WD_FULL_UK;
}

export function prioColor(key) { return COLORS.priorities[key] || '#888888'; }

// "Compact" UI = real mobile OR a narrow pane (split view, small window)
export const COMPACT_WIDTH = 560;
export function compactMode(view) {
    if (obsidian.Platform.isMobile) return true;
    const w = view.containerEl ? view.containerEl.clientWidth : 0;
    return w > 0 && w < COMPACT_WIDTH;
}

// Deterministic pastel for a tag/group that has no explicit color
export function autoColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360}, 60%, 72%)`;
}

// Base color used to tint a task card, per the chosen colorBy mode (or null)
export function cardColor(task, colorBy) {
    if (colorBy === 'tag') { const t = task.tags && task.tags[0]; return t ? (COLORS.tags[t] || autoColor(t)) : null; }
    if (colorBy === 'group') { return task.group ? (COLORS.groups[task.group] || autoColor(task.group)) : null; }
    if (colorBy === 'none') return null;
    return task.priority ? prioColor(task.priority) : null;   // default: priority
}

export const MONTHS_UK = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
                   'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
export const MONTHS_GEN_UK = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
                       'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
export const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
export const WD_UK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
export const WD_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WD_FULL_UK = ['Понеділок', 'Вівторок', 'Середа', 'Четвер', 'Пʼятниця', 'Субота', 'Неділя'];
export const WD_FULL_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// these are swapped to the EN variants by applyConfig() when the language is English
export let MONTHS_UA = MONTHS_UK;
export let MONTHS_GEN = MONTHS_GEN_UK;
export let WD_UA = WD_UK;
export let WD_FULL = WD_FULL_UK;

// Human-friendly date header, e.g. "Сьогодні · 28 червня" / "Today · 28 June"
export function humanDate(iso) {
    const d = parseISO(iso);
    const dayMonth = `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
    if (iso === todayISO()) return `${t('Сьогодні')} · ${dayMonth}`;
    if (iso === toISO(addDays(new Date(), 1))) return `${t('Завтра')} · ${dayMonth}`;
    if (iso === toISO(addDays(new Date(), -1))) return `${t('Вчора')} · ${dayMonth}`;
    return `${WD_FULL[mondayIdx(d)]}, ${dayMonth}`;
}

export const I18N = {
    // views / commands / ribbon
    'Календар': 'Calendar', 'Список задач': 'Tasks',
    'Звички': 'Habits', 'Міні-календар': 'Mini calendar',
    'Markday — Календар': 'Markday — Calendar',
    'Markday — Список': 'Markday — Tasks',
    'Markday — Звички': 'Markday — Habits',
    'Markday — Міні-календар': 'Markday — Mini calendar',
    'Відкрити Календар': 'Open Calendar',
    'Відкрити Список задач': 'Open Tasks', 'Відкрити Звички': 'Open Habits',
    'Відкрити Міні-календар (бічна панель)': 'Open Mini calendar (sidebar)',
    'Відкрити/створити нотатку сьогодні': "Open/create today's note",
    'Створити задачу': 'Create task', 'Створити звичку': 'Create habit',
    // calendar
    'Перелік': 'Overview', 'Робочий тиждень': 'Work week', '3 дні': '3 days',
    'Колір: пріоритет': 'Color: priority', 'Колір: тег': 'Color: tag', 'Колір: група': 'Color: group', 'Без кольору': 'No color',
    'Колір': 'Color', 'Сьогодні': 'Today', 'Вчора': 'Yesterday',
    'Відображення': 'Display', 'Назад': 'Back', 'Вперед': 'Forward',
    'Без фільтра': 'No filter', 'Пріоритети': 'Priorities',
    'Фільтр…': 'Filter…', 'Фільтр: змінити/зняти': 'Filter: change / clear',
    'Показувати теги': 'Show tags', 'Показувати групи': 'Show groups', 'Показувати пріоритети': 'Show priorities',
    'Крапка пріоритету': 'Priority dot', 'Задач немає': 'No tasks', 'Нотатка': 'Note',
    '+ задача': '+ task', 'весь день': 'all-day', 'Нова подія': 'New event',
    // list
    'Нова задача…': 'New task…', 'Нова задача (сьогодні)…': 'New task (today)…', 'Нова задача на сьогодні…': 'New task for today…',
    'Усі': 'All', 'Наступні 30 днів': 'Next 30 days',
    'Без груп': 'No grouping', 'За датою': 'By date', 'За тегом': 'By tag', 'За групою': 'By group', 'За пріоритетом': 'By priority',
    'Групування': 'Grouping', 'Сортування': 'Sorting', 'Сортування та групування': 'Sort & group', 'Період': 'Period', 
    'Пріоритет': 'Priority', 'Дата': 'Date', 'Час': 'Time', 'Назва': 'Name',
    'Протерміновані': 'Overdue', 'Сховати виконані': 'Hide done', 'Показувати деталі': 'Show details', 'Звички сьогодні': "Today's habits",
    'Задач не знайдено.': 'No tasks found.', 'Без групи': 'No group', 'Без тегів': 'No tags', 'Без пріоритету': 'No priority',
    'Без часу (найближче)': 'No time (upcoming)', 'Немає задач на сьогодні': 'No tasks for today',
    'Немає запланованих задач': 'No scheduled tasks',
    // habits
    'Цей тиждень': 'This week', 'так/ні': 'yes/no', 'Усі звички': 'All habits', 
    'Звичок ще немає. Створіть їх через Ctrl+P → Звичка.': 'No habits yet. Create them via Ctrl+P → Habit.',
    'Найдовша серія': 'Longest streak', 'днів підряд': 'days in a row', 'Рекорд за день': 'Best day',
    'За місяць': 'This month', 'За рік': 'This year', 'разів': 'times', 'звичок': 'habits', 'слів': 'words', 'сторінки': 'pages',
    'Скільки': 'How much', 'Виконано': 'Done', 'Не виконано': 'Not done', 'Скасовано': 'Cancelled', 'Статус': 'Status', 'Активна': 'Active', 'Виконана': 'Done', 'Скасована': 'Cancelled',
    'Не виконана': 'Not done', 'Відмінена': 'Cancelled', 'Опис': 'Description', 'Опис, теги #, групи @…': 'Description, tags #, groups @…',
    'Щоденно': 'Daily', 'Щотижнево (поточний день)': 'Weekly (this weekday)', 'Щотижнево у робочі дні (Пн–Пт)': 'Weekly (Mon–Fri)',
    'Щомісячно (поточне число)': 'Monthly (this day)', 'Щорічно (поточний день)': 'Yearly (this day)', 'Кастомне налаштування…': 'Custom…',
    'Завтра': 'Tomorrow', 'Наступного понеділка': 'Next Monday', 'Дата та час': 'Date & time', 'Очистити': 'Clear',
    'Одиниця': 'Unit', 'День': 'Day', 'Тиждень': 'Week', 'Місяць': 'Month', 'Рік': 'Year',
    'За днем місяця': 'By day of month', 'За днем тижня': 'By weekday', 'Робочий день': 'Working day', 'Режим': 'Mode', 'Який': 'Which', 
    'перший': 'first', 'другий': 'second', 'третій': 'third', 'четвертий': 'fourth', 'останній': 'last',
    'Кастомне повторення': 'Custom recurrence', 'Дата виконання': 'Due date', 'Пріоритет: ': 'Priority: ', 'Повторення: ': 'Repeat: ',
    'Щомісячні перевірки': 'Monthly checks', 'Загальна реєстрація': 'Total log', 'Щомісячна ставка реєстрації': 'Monthly rate',
    'Поточна серія': 'Current streak', 'Щомісячне виконання': 'Monthly total', 'Загальний обсяг виконання': 'Overall total',
    'Рахунок': 'Count', 'Ціль на день': 'Daily goal', 'Журнал звички': 'Habit log', 'Найкраща серія': 'Best streak', '← Назад': '← Back',
    'Немає записів': 'No entries', 'Оберіть звичку': 'Select a habit', 'Необов’язково — для кілець прогресу та %': 'Optional — for progress rings & %', 'дн.': 'd', 'До поточного': 'To current', 'Ціль': 'Goal',
    'Без дати': 'No date', 'Ще': 'More', 'Відкрити нотатку': 'Open note', 'Не буде виконано': 'Won’t do', 'без групи': 'no group',
    'Додати тег у опис': 'Add a tag in the description', 'Зробити регулярною': 'Make recurring',
    'Перегляди': 'Views', 'Групи': 'Lists', 'Теги': 'Tags', 'Панель фільтрів': 'Filters panel', 'Фільтр': 'Filter', 'Усі пріоритети': 'All priorities', 'Всі': 'All', 'Наступні 7 днів': 'Next 7 days', 'Більше': 'More',
    'Пізніше': 'Later', 'Регулярна задача у списку': 'Recurring task in the list', 'Скільки наступних повторів показувати у списку': 'How many upcoming occurrences to show in the list',
    'Статуси чекбоксів': 'Checkbox statuses',
    'Символ, що записується в "- [ ]". Клік по чекбоксу завжди перемикає звичайне todo/done; інші статуси — через праву кнопку миші.':
        'The character written into "- [ ]". Clicking the checkbox always toggles plain todo/done; other statuses are set via right-click.',
    'У роботі': 'In progress', 'Перенесено': 'Forwarded', 'Заплановано': 'Scheduled', 'Важливо': 'Important', 'Під питанням': 'Question',
    '+ статус': '+ status', 'Скинути до стандартних': 'Reset to defaults', 'Нова': 'New',
    'Символ': 'Character', 'Один символ, що записується як "- [X] текст задачі"': 'A single character written as "- [X] task text"',
    'Поведінка': 'Behavior', 'Як статус враховується: як відкрита задача, виконана чи скасована': 'How the status is counted: as open, done, or cancelled',
    'Іконка': 'Icon', 'Показується у списках/календарі Markday замість символу (працює без сторонніх тем чи плагінів)':
        "Shown in Markday's own list/calendar instead of the plain character (works with no themes or plugins installed)",
    'Без іконки (лише символ)': 'No icon (character only)', 'Інша…': 'Other…',
    'Новий статус': 'New status', 'Редагувати статус': 'Edit status',
    'шт.': 'items', 'Порожньо': 'Empty', 'Проєктні теки': 'Project folders', 'Статуси': 'Statuses',
    'Ключ використовується у тексті задачі як !ключ. Порядок = ранг.': 'The key is used in task text as !key. Order = rank.',
    // editor / create
    'Назва задачі': 'Task name', 'Опис (деталі)…': 'Description (details)…', 'Задача виконана': 'Task done',
    'Час (необов.)': 'Time (optional)', 'Група': 'Group', 'Enter — додати': 'Enter to add', 'Підзадачі': 'Subtasks',
    '+ підзадача': '+ subtask', 'Відхилити зміни': 'Discard changes', 'Зберегти зміни': 'Save changes', 'Видалити задачу': 'Delete task',
    'Дата / час / повтор': 'Date / time / repeat', 'Теги / пріоритет / група': 'Tags / priority / group',
    'Повторювати': 'Repeat', 'Без повтору': "Don't repeat", 'Щодня': 'Daily', 'Щотижня': 'Weekly', 'Щомісяця': 'Monthly', 'Щороку': 'Yearly',
    'Кожні N': 'Every N', 'Дні тижня': 'Weekdays', 'Скасувати': 'Cancel', 'Готово': 'Done', 'Додати': 'Add', 'Зберегти': 'Save',
    'щодня': 'daily', 'щотижня': 'weekly', 'щомісяця': 'monthly', 'щороку': 'yearly', 'Кінець (необов.)': 'End (optional)', 'Початок': 'Start',
    'Нова звичка': 'New habit', 'Введіть назву задачі': 'Enter a task name', 'група': 'group', '+ тег': '+ tag',
    'Емодзі': 'Emoji', 'Компактна іконка звички': 'Compact habit icon', 'Назва property': 'Property name',
    'Ключ у властивостях файлу (напр. pages_read)': 'Frontmatter key (e.g. pages_read)', 'Тип виміру': 'Measure type',
    'Кількість': 'Quantity', 'Так / Ні': 'Yes / No', 'Одиниці виміру': 'Units', 'напр. сторінки, км, хвилини': 'e.g. pages, km, minutes',
    'Введіть назву': 'Enter a name', 'Введіть назву property': 'Enter a property name', 'Введіть текст задачі': 'Enter task text',
    'Оберіть хоча б один день тижня': 'Pick at least one weekday',
    // settings
    'Рівень заголовка': 'Heading level', 'Під яким рівнем заголовка зберігати задачі (# = 1 … ###### = 6)': 'Heading level to store tasks under (# = 1 … ###### = 6)',
    'Текст заголовка': 'Heading text', 'Назва заголовка, під яким будуть задачі (напр. "Задачі" або "Tasks")': 'Heading the tasks live under (e.g. "Задачі" or "Tasks")',
    'Робочі години — початок': 'Working hours — start', 'Робочі години — кінець': 'Working hours — end',
    'На часовій шкалі раніші години згорнуті (можна розгорнути)': 'Earlier hours are collapsed on the timeline (expandable)',
    'На часовій шкалі пізніші години згорнуті (можна розгорнути)': 'Later hours are collapsed on the timeline (expandable)',
    'Крок часової шкали': 'Timeline step', 'Прилипання при перетягуванні/зміні розміру': 'Snap when dragging / resizing',
    'Перший день тижня': 'First day of week', 'Понеділок': 'Monday', 'Неділя': 'Sunday', 'Мова': 'Language', 'Авто': 'Auto',
    'Загальне': 'General', 'Часова шкала': 'Timeline',
    'Стандартні значення': 'Defaults', 'Підставляються в нову задачу, якщо не вказані вручну.': 'Applied to new tasks unless set manually.',
    'Стандартний тег': 'Default tag', 'Стандартна група': 'Default group', 'Стандартний пріоритет': 'Default priority',
    'Сценарії парсингу': 'Parsing scenarios',
    'Задачі в цих теках читаються з датою поруч із текстом (>РРРР-ММ-ДД), а не з назви файлу. Перший збіг теки перемагає; решта нотаток лишається щоденними.':
        'Tasks in these folders read their date from an inline token (>YYYY-MM-DD) next to the text, not the file name. The first matching folder wins; everything else stays daily notes.',
    'Тека проєкту': 'Project folder', 'Поки немає сценаріїв.': 'No scenarios yet.', '+ сценарій': '+ scenario',
    'Регулярні задачі': 'Recurring tasks', 'Створення — через швидке створення (Ctrl+P). Тут — редагування та видалення.': 'Create via quick-create (Ctrl+P). Here — edit and delete.',
    'Поки немає регулярних задач.': 'No recurring tasks yet.', 'Поки немає звичок.': 'No habits yet.',
    'Редагувати': 'Edit', 'Видалити': 'Delete', 'Вище': 'Up', 'Нижче': 'Down', 'Редагувати регулярну задачу': 'Edit recurring task', 'Редагувати звичку': 'Edit habit',
    'Кольори та пріоритети': 'Colors & priorities',
    'Ключ використовується у тексті задачі як !ключ. Порядок = ранг (нижчий зверху, вищий знизу).': 'The key is used in task text as !key. Order = rank (lower on top, higher below).',
    'Кольори тегів': 'Tag colors', 'Кольори груп': 'Group colors', '+ пріоритет': '+ priority', '+ додати': '+ add',
    'Звичка: кількість написаних слів': 'Habit: words written', 'Автоматично рахує слова в нотатці дня': "Auto-counts words in the day's note",
    '— емодзі': '— emoji', '— колір': '— color', 'Текст у форматі задачі: "14:00 Полити квіти #дім !med"': 'Task-format text: "14:00 Water plants #home !med"',
    'Формат задачі: "14:00 Полити квіти #дім !med"': 'Task format: "14:00 Water plants #home !med"',
    'напр. Полити квіти #дім': 'e.g. Water plants #home', 'Число місяця': 'Day of month', 'Інтервал': 'Interval',
    'Створити нотатку на ': 'Create a note for ', 'Створити нотатку': 'Create note', 'Створити': 'Create',
    'Задачі': 'Tasks',
};

export const DEFAULT_SETTINGS = {
    headingLevel: 2,
    headingText: 'Задачі',
    recurrences: [],  // [{ id, raw, freq, interval, weekdays, monthday, start, end, exceptions }]
    habits: [],       // [{ id, name, property, unit, type: 'number'|'bool' }]
    scenarios: [],    // [{ id, folder, mode: 'project' }] ordered; folders parsed with an inline >date token instead of daily notes
    checkboxStatuses: DEFAULT_CHECKBOX_STATUSES.map(x => ({ ...x })),   // [{ id, char, label, behavior: 'active'|'done'|'cancelled' }]
    workStart: 8,     // timeline working-hours start (hour 0-23); earlier hours collapse
    workEnd: 20,      // timeline working-hours end (hour 1-24); later hours collapse
    snapMinutes: 15,  // timeline drag/resize snap step in minutes
    colorBy: 'priority',   // card coloring: priority | tag | group | none
    priorityDot: true,     // when colorBy != priority, show priority as a dot
    firstDayOfWeek: 1,     // 0 = Sunday, 1 = Monday
    recurrenceAhead: 1,    // list: how many upcoming occurrences of a recurrence to show
    language: 'auto',      // auto | uk | en
    showTags: true,        // show tag badges on cards
    showGroups: true,      // show group badges on cards
    showPriority: true,    // show priority badge/label on cards
    defaultTag: '',        // applied to new tasks when set
    defaultGroup: '',
    defaultPriority: '',
    wordCount: { enabled: false, name: 'Написано слів', emoji: '✍️', color: '#9aa0a6' },
    colors: {
        priorities: [
            { key: 'low', color: '#8b949e' },
            { key: 'med', color: '#58a6ff' },
            { key: 'high', color: '#d29922' },
            { key: 'urgent', color: '#e5534b' }
        ],
        tags: [],     // [{ name, color }]
        groups: []    // [{ name, color }]
    }
};

export const LIST_HORIZON_DAYS = 60;   // how far ahead virtual recurrences are projected in the list

// ─── Date utils ──────────────────────────────────────────────────────────────

export function pad(n) { return String(n).padStart(2, '0'); }
export function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function parseISO(s) { const [y, m, day] = s.split('-').map(Number); return new Date(y, m - 1, day); }
export function todayISO() { return toISO(new Date()); }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
// Weekday as 0=Mon..6=Sun (JS getDay() is 0=Sun) — the indexing every WD_* array uses
export function mondayIdx(d) { return (d.getDay() + 6) % 7; }
export function startOfWeek(d) { const x = new Date(d); const off = (x.getDay() - weekStartDay + 7) % 7; x.setDate(x.getDate() - off); return x; }
export function startOfWorkWeek(d) { const x = new Date(d); x.setDate(x.getDate() - mondayIdx(x)); return x; } // Monday
// Weekday header labels ordered from the configured first day
export function weekdayHeaders() {
    const startIdx = (weekStartDay + 6) % 7;   // WD_UA index of the first column (Mon=0)
    return WD_UA.map((_, i) => WD_UA[(startIdx + i) % 7]);
}

// The 42 dates (6 weeks) of a month grid, starting from the configured week start
export function monthGridDays(y, m) {
    const start = startOfWeek(new Date(y, m, 1));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function normTime(t) { const [h, m] = t.split(':'); return `${pad(Number(h))}:${m}`; }
export function timeMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

// Ordering within a single day: events first (by start time), then timeless tasks (file order)
export function dayOrder(a, b) {
    const ae = a.start != null, be = b.start != null;
    if (ae !== be) return ae ? -1 : 1;
    if (ae && be) return timeMin(a.start) - timeMin(b.start);
    return 0;
}

export function daysBetween(a, b) { return Math.round((b.getTime() - a.getTime()) / 86400000); }
export function genId() { return Math.random().toString(36).slice(2, 8); }

// ─── Recurrence engine ───────────────────────────────────────────────────────

// Does a recurrence rule fire on the given Date?
export function lastDayOfMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
export function clampMonthDay(y, m, d) { return Math.min(d, lastDayOfMonth(y, m)); }

// nth occurrence of a weekday (0=Mon..6=Sun) in month; nth=-1 → last. Returns day-of-month or null.
export function nthWeekdayOfMonth(y, m, wd0Mon, nth) {
    if (nth === -1) {
        for (let d = lastDayOfMonth(y, m); d >= 1; d--) {
            if (mondayIdx(new Date(y, m, d)) === wd0Mon) return d;
        }
        return null;
    }
    let count = 0;
    for (let d = 1; d <= lastDayOfMonth(y, m); d++) {
        if (mondayIdx(new Date(y, m, d)) === wd0Mon && ++count === nth) return d;
    }
    return null;
}

// first/last working day (Mon–Fri) of a month → day-of-month
export function workdayOfMonth(y, m, which) {
    if (which === 'last') {
        for (let d = lastDayOfMonth(y, m); d >= 1; d--) {
            if (mondayIdx(new Date(y, m, d)) <= 4) return d;
        }
    } else {
        for (let d = 1; d <= lastDayOfMonth(y, m); d++) {
            if (mondayIdx(new Date(y, m, d)) <= 4) return d;
        }
    }
    return null;
}

// Does `date` match the rule's month-mode within month (y,m)? (shared by monthly + yearly)
export function matchesMonthMode(rule, date, y, m, fallbackDay) {
    const mode = rule.monthMode || 'day';
    if (mode === 'weekday') {
        const day = nthWeekdayOfMonth(y, m, rule.weekday || 0, rule.nth || 1);
        return day != null && date.getDate() === day;
    }
    if (mode === 'workday') {
        const day = workdayOfMonth(y, m, rule.which || 'first');
        return day != null && date.getDate() === day;
    }
    return date.getDate() === clampMonthDay(y, m, rule.monthday || fallbackDay);
}

export function occursOn(rule, date) {
    const start = parseISO(rule.start);
    if (daysBetween(start, date) < 0) return false;
    if (rule.end && daysBetween(date, parseISO(rule.end)) < 0) return false;

    const interval = rule.interval || 1;
    switch (rule.freq) {
        case 'daily':
            return daysBetween(start, date) % interval === 0;
        case 'weekly': {
            const wd = mondayIdx(date); // 0 = Mon
            const weekdays = (rule.weekdays && rule.weekdays.length)
                ? rule.weekdays : [mondayIdx(start)];
            if (!weekdays.includes(wd)) return false;
            const weeks = Math.floor(daysBetween(startOfWeek(start), date) / 7);
            return weeks % interval === 0;
        }
        case 'monthly': {
            const months = (date.getFullYear() - start.getFullYear()) * 12
                + (date.getMonth() - start.getMonth());
            if (months < 0 || months % interval !== 0) return false;
            return matchesMonthMode(rule, date, date.getFullYear(), date.getMonth(), start.getDate());
        }
        case 'yearly': {
            const ym = (rule.month != null) ? rule.month : start.getMonth();
            if (date.getMonth() !== ym) return false;
            const years = date.getFullYear() - start.getFullYear();
            if (years < 0 || years % interval !== 0) return false;
            // legacy rules (no monthMode) keep exact start day-of-month
            if (!rule.monthMode) return date.getDate() === start.getDate();
            return matchesMonthMode(rule, date, date.getFullYear(), ym, start.getDate());
        }
    }
    return false;
}

export function describeRule(rule) {
    const i = rule.interval || 1;
    const en = LANG === 'en';
    const ev = n => en ? `every ${i} ${n}` : `кожні ${i} ${n}`;
    const ord = { '1': en ? 'first' : 'перший', '2': en ? 'second' : 'другий', '3': en ? 'third' : 'третій',
                  '4': en ? 'fourth' : 'четвертий', '-1': en ? 'last' : 'останній' };
    const monthModePart = () => {
        const mode = rule.monthMode || 'day';
        if (mode === 'weekday') return `${ord[String(rule.nth || 1)]} ${WD_FULL[rule.weekday || 0]}`;
        if (mode === 'workday') return rule.which === 'last'
            ? (en ? 'last working day' : 'останній робочий день')
            : (en ? 'first working day' : 'перший робочий день');
        return en ? `day ${rule.monthday || '?'}` : `${rule.monthday || '?'} числа`;
    };
    if (rule.freq === 'daily') return i === 1 ? t('щодня') : ev(en ? 'days' : 'дн.');
    if (rule.freq === 'weekly') {
        const wd = (rule.weekdays || []).slice().sort((a, b) => a - b).map(d => WD_UA[d]).join(', ');
        return (i === 1 ? t('щотижня') : ev(en ? 'weeks' : 'тиж.')) + (wd ? ` (${wd})` : '');
    }
    if (rule.freq === 'monthly') return (i === 1 ? t('щомісяця') : ev(en ? 'months' : 'міс.')) + ', ' + monthModePart();
    if (rule.freq === 'yearly') {
        const base = i === 1 ? t('щороку') : ev(en ? 'years' : 'р.');
        if (rule.month == null) return base;
        return `${base} — ${monthModePart()} ${MONTHS_GEN[rule.month]}`;
    }
    return '';
}

// date(ISO) -> Set(recId) of recurrences already materialized as real lines that day
export function buildMaterializedIndex(realMap) {
    const idx = new Map();
    for (const [date, entry] of realMap) {
        const set = new Set();
        for (const t of entry.tasks) if (t.recId) set.add(t.recId);
        idx.set(date, set);
    }
    return idx;
}

// Inject virtual recurrence instances into realMap for [startISO, endISO]
export function addVirtuals(realMap, rules, startISO, endISO) {
    if (!rules || !rules.length) return realMap;
    const matIdx = buildMaterializedIndex(realMap);
    const end = parseISO(endISO);
    for (let d = parseISO(startISO); daysBetween(d, end) >= 0; d = addDays(d, 1)) {
        const iso = toISO(d);
        const matSet = matIdx.get(iso) || new Set();
        for (const rule of rules) {
            if (matSet.has(rule.id)) continue;
            if (rule.exceptions && rule.exceptions.includes(iso)) continue;
            if (!occursOn(rule, d)) continue;
            const t = parseTaskLine(`- [ ] ${rule.raw}`, -1);
            if (!t) continue;
            t.date = iso;
            t.recId = rule.id;
            t.raw = rule.raw;
            t.virtual = true;
            if (realMap.has(iso)) realMap.get(iso).tasks.push(t);
            else realMap.set(iso, { file: null, tasks: [t] });
        }
    }
    return realMap;
}

// Materialize a virtual instance into its daily note (with ^rc- marker).
// Returns where it landed so callers can act on the new line immediately
// (e.g. open the editor without waiting for a second click).
export async function materializeVirtual(app, task, done, settings) {
    const file = await getOrCreateDateFile(app, task.date);
    const taskLine = `- [${done ? 'x' : ' '}] ${task.raw} ^rc-${task.recId}`;
    const line = await insertLineUnderHeading(app, file, taskLine, settings);
    return { file, line };
}

// ─── Habits ──────────────────────────────────────────────────────────────────

// Read a day note's frontmatter (or {} if no file)
export function readFrontmatter(app, isoDate) {
    const file = app.vault.getAbstractFileByPath(dateToPath(app, parseISO(isoDate)));
    if (!file) return {};
    return (app.metadataCache.getFileCache(file) || {}).frontmatter || {};
}

// Write/clear a habit value in a day note's frontmatter (merges with existing props)
export async function setHabitValue(app, isoDate, habit, value) {
    const file = await getOrCreateDateFile(app, isoDate);
    await app.fileManager.processFrontMatter(file, fm => {
        if (value === null || value === '' || value === false) delete fm[habit.property];
        else fm[habit.property] = value;
    });
}

// Count words in a day note's body (frontmatter stripped)
export function countWords(content) {
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const m = body.match(/\S+/g);
    return m ? m.length : 0;
}

// Effective habit list = user habits (+ the built-in word-count habit when enabled)
export function habitList(settings) {
    const arr = (settings.habits || []).slice();
    const wc = settings.wordCount;
    if (wc && wc.enabled) {
        arr.push({ id: '__words', name: wc.name || 'Написано слів', emoji: wc.emoji || '✍️', color: wc.color || '', unit: 'слів', type: 'number', auto: 'words', goal: wc.goal || null });
    }
    return arr;
}

// A habit's numeric value for a date (bool→0/1; word-count read from the file)
export async function getHabitValue(app, isoDate, habit) {
    if (habit.auto === 'words') {
        const file = app.vault.getAbstractFileByPath(dateToPath(app, parseISO(isoDate)));
        if (!file) return 0;
        return countWords(await app.vault.read(file));
    }
    const v = readFrontmatter(app, isoDate)[habit.property];
    if (habit.type === 'bool') return (v === true || v === 'true') ? 1 : 0;
    return Number(v) || 0;
}

// A day's completion fraction (0..1) for a habit
export function habitProgress(value, habit) {
    if (habit.type === 'bool') return value > 0 ? 1 : 0;
    if (habit.goal > 0) return Math.max(0, Math.min(1, value / habit.goal));
    return value > 0 ? 1 : 0;
}
// Whether a day counts as "done" (goal met, or any value when no goal)
export function habitDone(value, habit) {
    if (habit.type === 'bool') return value > 0;
    if (habit.goal > 0) return value >= habit.goal;
    return value > 0;
}

// ─── Parsing scenarios ────────────────────────────────────────────────────────

// Which configured 'project' scenario (if any) claims a given vault path — ordered,
// first matching folder wins. Files that match none fall back to daily-note parsing.
export function matchScenario(path) {
    for (const sc of SCENARIOS) {
        if (sc.mode !== 'project') continue;
        const folder = (sc.folder || '').replace(/^\/+|\/+$/g, '');
        if (!folder || path === folder || path.startsWith(folder + '/')) return sc;
    }
    return null;
}

// ─── Daily Notes integration ─────────────────────────────────────────────────

export function getDailyNotesConfig(app) {
    let folder = '';
    let format = 'YYYY-MM-DD';
    let template = '';
    try {
        const dn = app.internalPlugins.getPluginById('daily-notes');
        const opts = dn && dn.instance && dn.instance.options;
        if (opts) {
            if (opts.folder) folder = String(opts.folder).trim();
            if (opts.format) format = String(opts.format).trim() || 'YYYY-MM-DD';
            if (opts.template) template = String(opts.template).trim();
        }
    } catch (e) { /* daily-notes unavailable → defaults */ }
    // strip leading/trailing slashes from folder
    folder = folder.replace(/^\/+|\/+$/g, '');
    return { folder, format, template };
}

// Substitute Daily-Notes template placeholders for a given date
export function applyTemplate(content, date, format) {
    const m = obsidian.moment(date);
    const now = obsidian.moment();
    return content
        .replace(/{{\s*date\s*:\s*([^}]+)}}/gi, (_, f) => m.format(f.trim()))
        .replace(/{{\s*time\s*:\s*([^}]+)}}/gi, (_, f) => now.format(f.trim()))
        .replace(/{{\s*date\s*}}/gi, m.format(format))
        .replace(/{{\s*time\s*}}/gi, now.format('HH:mm'))
        .replace(/{{\s*title\s*}}/gi, m.format(format));
}

// Read the configured Daily-Notes template and resolve it for `date`
export async function readTemplate(app, templatePath, date, format) {
    if (!templatePath) return null;
    let path = templatePath.replace(/^\/+/, '');
    let f = app.vault.getAbstractFileByPath(path);
    if (!f && !/\.md$/i.test(path)) f = app.vault.getAbstractFileByPath(path + '.md');
    if (!(f instanceof obsidian.TFile)) return null;
    const raw = await app.vault.read(f);
    return applyTemplate(raw, date, format);
}

// JS Date → vault path of its daily note
export function dateToPath(app, date) {
    const { folder, format } = getDailyNotesConfig(app);
    const name = obsidian.moment(date).format(format);
    const path = folder ? `${folder}/${name}.md` : `${name}.md`;
    return obsidian.normalizePath(path);
}

// TFile → JS Date (or null if it is not a daily note for the current config)
export function fileToDate(file, folder, format) {
    let rel = file.path.replace(/\.md$/i, '');
    if (folder) {
        const prefix = folder + '/';
        if (!rel.startsWith(prefix)) return null;
        rel = rel.slice(prefix.length);
    }
    const m = obsidian.moment(rel, format, true); // strict parse
    return m.isValid() ? m.toDate() : null;
}

export async function ensureFolders(app, filePath) {
    const parts = filePath.split('/');
    parts.pop(); // drop filename
    let cur = '';
    for (const p of parts) {
        cur = cur ? `${cur}/${p}` : p;
        if (!app.vault.getAbstractFileByPath(cur)) {
            try { await app.vault.createFolder(cur); } catch (e) { /* race / exists */ }
        }
    }
}
