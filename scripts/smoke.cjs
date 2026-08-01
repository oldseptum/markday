// Loads the built main.js under Node with a stubbed 'obsidian' module.
// Catches module-evaluation errors (missing imports, bad top-level code) that a
// plain syntax check cannot see. Run automatically as part of `npm test`.
// main.js is compiled as a virtual .cjs module: the repo's package.json says
// "type": "module" (for src/ and scripts), but the bundle itself is CommonJS —
// Obsidian loads it with its own require and never consults our package.json.
const Module = require('module');
const path = require('path');
const fs = require('fs');

let stub;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'obsidian') return stub;
    return origLoad.apply(this, arguments);
};

(async () => {
    stub = await import(path.join(__dirname, '..', 'tests', 'obsidian-stub.mjs'));
    const mainPath = path.join(__dirname, '..', 'main.js');
    const m = new Module('markday-main', null);
    m.paths = Module._nodeModulePaths(path.dirname(mainPath));
    m._compile(fs.readFileSync(mainPath, 'utf8'), mainPath.replace(/\.js$/, '.smoke.cjs'));
    const PluginClass = m.exports.default || m.exports;
    if (typeof PluginClass !== 'function') throw new Error('main.js does not export a plugin class');
    if (!(PluginClass.prototype instanceof stub.Plugin)) throw new Error('exported class does not extend obsidian.Plugin');
    console.log('SMOKE OK: bundle evaluates and exports a Plugin subclass');
})().catch(e => { console.error('SMOKE FAIL:', e); process.exit(1); });
