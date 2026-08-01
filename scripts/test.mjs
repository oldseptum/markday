// Test runner: bundles each tests/*.test.mjs with esbuild (aliasing 'obsidian' to the
// stub so real src/ modules can load under Node), imports it, and runs its exported
// `tests` object ({ name: fn }). Finishes with a smoke-load of the built main.js.
import { buildSync } from 'esbuild';
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const OUT = path.join(ROOT, '.testbuild');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const files = readdirSync(path.join(ROOT, 'tests')).filter(f => f.endsWith('.test.mjs')).sort();
let pass = 0, fail = 0;

for (const f of files) {
    const outfile = path.join(OUT, f);
    buildSync({
        entryPoints: [path.join(ROOT, 'tests', f)],
        bundle: true,
        format: 'esm',
        platform: 'node',
        alias: { obsidian: path.join(ROOT, 'tests', 'obsidian-stub.mjs') },
        outfile,
        logLevel: 'silent',
    });
    const mod = await import(pathToFileURL(outfile));
    console.log(`\n── ${f}`);
    for (const [name, fn] of Object.entries(mod.tests || {})) {
        try {
            await fn();
            console.log(`  OK   ${name}`);
            pass++;
        } catch (e) {
            console.log(`  FAIL ${name}\n       ${e.message}`);
            fail++;
        }
    }
}

console.log(`\n${pass} passed, ${fail} failed`);

const smoke = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'smoke.cjs')], { stdio: 'inherit' });
if (smoke.status !== 0) fail++;

rmSync(OUT, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
