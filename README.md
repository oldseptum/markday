# Markday

A calendar **and** task manager for [Obsidian](https://obsidian.md) that works entirely on top of plain Markdown daily notes. No database, no proprietary format — every task is a normal `- [ ]` checkbox line you can read, edit and sync like any other note.

> 🇺🇦 Interface available in **Ukrainian** and **English** (auto-detected from your Obsidian language, switchable in settings).

> ⚠️ **Beta.** It’s stable enough for daily use, but back up your vault and expect occasional rough edges.

<!-- HERO: split view — the .md source on the left, the rendered calendar/list on the right.
     This is the single most important image: it proves "your tasks are just Markdown". -->
![Markday — your tasks are plain Markdown, shown as a calendar](docs/01-hero.png)

---

## Why

- **Your tasks stay in your notes.** Everything lives in your Daily Notes as ordinary Markdown, so it’s fully visible and editable in Obsidian (and in the Obsidian Tasks/Dataview ecosystems, with minor differences in syntax).
- **One place for time and to‑dos.** Calendar, agenda, timeline, list and habit tracking over the same files.
- **Works on desktop and mobile** (Android/iOS) — the UI adapts to narrow panes and small screens.

---

## Screenshots

### Month calendar
<!-- Calendar view in Month mode, full pane. Use the busy week (22–28) so badges, colors and "today" show. -->
![Month calendar](docs/02-calendar-month.png)

### Timeline (week / 3‑day)
<!-- Week or 3-day timeline with timed events. Caption that events can be dragged to move/resize/create.
     A short GIF here (docs/03-timeline.gif) is far more convincing than a still. -->
![Timeline week view with draggable events](docs/03-timeline.png)

### Tasks list
<!-- List view grouped/sorted, including the red "Overdue" section. -->
![Grouped task list with an overdue section](docs/04-tasks-list.png)

### Habits
<!-- Habits view: weekly tracker + GitHub-style heatmap + per-habit stats. -->
![Habit tracker and heatmap](docs/05-habits.png)

### Quick create & task editor
<!-- The inline composer with date/recurrence + tag/priority popovers, or the Ctrl/Cmd+P quick-create. -->
![Quick create and task editor](docs/06-create.png)

### Mobile
<!-- A narrow pane / mobile screenshot showing the floating + button and compact layout. -->
<img src="docs/07-mobile.png" alt="Markday on mobile" width="320">

---

## Features

- **Four views**
  - **Calendar** — Month, Overview (dots), Week, Work week and 3‑day modes.
  - **Tasks** — a grouped/sorted task list with a filter sidebar and an overdue section.
  - **Habits** — a two‑pane dashboard: weekly overview, per‑day progress rings, streaks, monthly/all‑time stats, a month ring‑calendar, a daily‑goals chart and a year heatmap.
  - **Mini calendar** — a compact month for the sidebar.
- **Configurable task statuses** — out of the box `- [ ]` to‑do, `- [x]` done, `- [-]` cancelled, plus `/` in progress, `>` forwarded, `<` scheduled, `!` important and `?` question (the same set the Tasks plugin and the Minimal theme use). Add, rename or remove your own in settings: each status has a character, a label, an **icon** (from Obsidian’s built‑in set, so it looks right with no theme or CSS snippet installed) and a **behavior** — counts as open, done, or cancelled.
- **Tasks & events** — a task becomes an **event** when it has a time (`14:00` or `14:00-15:30`). The week/3‑day **timeline** lets you drag to move, drag the edges to resize, drag across days, and create by click-dragging empty space (on touch: hold, then drag). A red line marks the current time.
- **Project folders** — besides Daily Notes, you can point Markday at project folders where tasks carry their date inline (`>2026-07-05`) instead of getting it from the file name. Both kinds show up together on the same day; undated project tasks act as a backlog.
- **Subtasks & descriptions** — indent a checkbox for a subtask (auto progress + auto‑complete of the parent); add a free‑form description that lives under a per‑task heading (text, images, anything).
- **Recurring tasks** — defined once, projected on the calendar virtually; a real line is written only when you tick a recurrence (no folder full of generated files). Rules cover daily/weekly/monthly/yearly with custom intervals, specific weekdays, **nth weekday** (e.g. last Friday), **first/last working day**, and yearly‑in‑a‑month.
- **Habits** — numeric (e.g. pages, km, minutes) or yes/no, with emoji, color and an optional **daily goal** (drives the progress rings and completion %). Values live in the day note’s frontmatter. Includes an optional built‑in **“words written”** habit that counts words in the day’s note automatically.
- **Organization** — priorities, `#tags`, `@groups`, color rules (by priority/tag/group) and filtering.
- **Desktop & touch interactions** — right‑click any task for the status menu, right‑click a day for “create task / open note”, double‑click a day to open its note. On touch: **swipe** left/right to change period, **long‑press** a task for the status menu, **swipe a task right** to complete it.
- **Quality of life** — a focused **create** window (title + description with inline `#`/`@` autocomplete, quick status/priority/date/recurrence row), a live‑saving **task editor** card, quick‑create commands (Ctrl/Cmd+P), an inline composer, first‑day‑of‑week, working hours, default tag/group/priority.

---

## Task syntax

Tasks are normal Markdown checkboxes under a configurable heading (default `## Tasks` / `## Задачі`) in each daily note. Metadata is compact:

```markdown
## Tasks
- [ ] 14:00-15:30 Project meeting #work !high @alpha
- [x] Read 30 pages #reading
- [/] Draft the proposal #work             ← in progress
- [-] File the tax return #chores          ← cancelled (won’t‑do)
- [ ] Plan the week !med
    - [ ] Review goals          ← subtask (indented checkbox)
    - A quick note               ← comment (indented bullet)

### Plan the week ^tcd-a1b2c3   ← optional description, linked to the task
Free text, images, links — anything.
```

The character inside the checkbox is the **status** (configurable — see Features). A recurring instance you tick gets a trailing `^rc-<id>` marker; a task with a description gets `^tcd-<id>` linking it to its heading.

| Element     | Syntax            | Example          |
|-------------|-------------------|------------------|
| Time/Event  | `HH:MM` / `HH:MM-HH:MM` at the start | `09:00 Standup` |
| Priority    | `!low` `!med` `!high` `!urgent` (customizable) | `!high` |
| Tag         | `#tag`            | `#work`          |
| Group       | `@group`          | `@alpha`         |
| Date *(project folders only)* | `>YYYY-MM-DD` | `>2026-07-05` |

Habit values are stored in the day note’s YAML frontmatter, e.g.:

```yaml
---
pages_read: 60
meditation: true
---
```

Recurring-task definitions and habit definitions are stored in the plugin’s settings (`data.json`), not scattered across notes.

---

## Installation (manual / beta)

This plugin is not yet in the community store.

1. Download `main.js`, `manifest.json` and `styles.css` (from a release or by building — see below).
2. Copy them into your vault: `<vault>/.obsidian/plugins/markday/`.
3. Enable **Settings → Community plugins → Markday**.
4. Make sure the core **Daily Notes** plugin is enabled — the calendar reads its folder and date format.

Open a view from the ribbon icons or via the command palette (search “Markday”).

### Try the demo vault

The repository includes `example-vault/` with the plugin pre‑installed and a few weeks of sample data. In Obsidian: **Open folder as vault → example-vault**.

---

## Settings highlights

- **Language** — Auto / Українська / English
- **Heading** level and text used to store tasks
- **First day of week**
- **Timeline** — working hours and step (snap)
- **Defaults** — default tag, group and priority for new tasks
- **Parsing scenarios** — project folders that use inline `>date` instead of Daily Notes
- **Checkbox statuses** — add/edit the recognized `- [x]` marks, their icons and behavior
- **Colors & priorities** — rename priorities, set colors for priorities/tags/groups
- Manage **recurring tasks** and **habits** (create them via Ctrl/Cmd+P; edit/delete here)

Long lists (statuses, scenarios, colors, recurrences, habits) open in their own dialog, so the settings page stays short.

---

## Building from source

The source lives in `src/` as ES modules and is bundled into `main.js` with esbuild. Requires Node.js:

```bash
npm install
npm run build   # bundle src/ -> main.js
npm run dev     # same, in watch mode
npm test        # run the test suite (also smoke-loads the bundle)
```

`./build.sh` (macOS/Linux) or `powershell -File build.ps1` (Windows) run build + tests together.
(`styles.css` and `manifest.json` are used directly — only `main.js` is generated.)

Tests live in `tests/` and run against the real modules in `src/`, with a small stub standing in for the Obsidian API — no vault or running Obsidian needed.

---

## Compatibility

- Obsidian 1.4.0+
- Desktop (Windows/macOS/Linux) and mobile (Android/iOS)

---

## License

MIT
