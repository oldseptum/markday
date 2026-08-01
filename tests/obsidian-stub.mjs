// Minimal stand-in for the 'obsidian' module so the bundle and src modules can be
// loaded (and pure logic exercised) under Node — no Obsidian app required.

export class Plugin {
    constructor(app, manifest) { this.app = app; this.manifest = manifest; }
    registerView() {} addRibbonIcon() {} addCommand() {} addSettingTab() {} registerEvent() {}
    async loadData() { return null; } async saveData() {}
}
export class Modal {
    constructor(app) { this.app = app; this.modalEl = null; this.contentEl = null; }
    open() {} close() {}
}
export class ItemView { constructor(leaf) { this.leaf = leaf; } registerEvent() {} }
export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
export class Menu { addItem() { return this; } addSeparator() { return this; } showAtMouseEvent() {} }
export class Setting {
    setName() { return this; } setDesc() { return this; } setHeading() { return this; }
    addText() { return this; } addDropdown() { return this; } addToggle() { return this; }
    addButton() { return this; } addExtraButton() { return this; } addColorPicker() { return this; }
    then(fn) { fn(this); return this; }
}
export class TFile {}
export class TFolder {}
export const Platform = { isMobile: false };
export function setIcon() {}
export function debounce(fn) { return fn; }
export function normalizePath(p) { return p; }

// moment shim — just enough for the plugin's daily-note paths: strict YYYY-MM-DD
// parse/format (the only format the tests configure).
export function moment(input, fmt, strict) {
    let d = null;
    if (input instanceof Date) d = new Date(input);
    else if (typeof input === 'string' && fmt) {
        const m = fmt === 'YYYY-MM-DD' && input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    } else if (input === undefined) d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return {
        isValid: () => d !== null && !isNaN(d),
        toDate: () => d,
        format: f => {
            if (!d) return '';
            return (f || 'YYYY-MM-DD')
                .replace('YYYY', String(d.getFullYear()))
                .replace('MM', pad(d.getMonth() + 1))
                .replace('DD', pad(d.getDate()))
                .replace('HH', pad(d.getHours()))
                .replace('mm', pad(d.getMinutes()));
        },
    };
}
