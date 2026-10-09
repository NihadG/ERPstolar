// ════════════════════════════════════════════════════════════════════
// SINHRONIZACIJA ZAJEDNIČKOG KODA → SketchUp plugin (Component Manager)
//
// lib/sketchup/match.ts (prepoznavanje materijala) i lib/sketchup/sastav.ts
// (furnir / MDF / HPL) su JEDINI izvor. Skripta ih prevede u JS i upiše
// između markera NT-ERP-SHARED u component_manager.rb, kao globalni `NTS`
// ({ match, sastav }). Pokreni poslije svake izmjene tih fajlova:
//
//   node scripts/sync-sketchup-plugin.mjs "G:/…/sketchuo/component_manager.rb"
//
// (bez argumenta koristi SKETCHUP_PLUGIN env varijablu)
// ════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] || process.env.SKETCHUP_PLUGIN;
if (!target) {
    console.error('Navedi put do component_manager.rb (argument ili SKETCHUP_PLUGIN).');
    process.exit(1);
}

const MODULES = ['match', 'sastav'];
const BEGIN = '/* >>> NT-ERP-SHARED';
const END = '/* <<< NT-ERP-SHARED <<< */';
const INDENT = '      ';

const parts = MODULES.map(name => {
    const src = fs.readFileSync(path.join(root, 'lib', 'sketchup', `${name}.ts`), 'utf8');
    const out = ts.transpileModule(src, {
        compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, removeComments: true },
    }).outputText;
    return `(function(exports, require){\n${out}\n})(M['${name}'] = {}, req);`;
});

const sha = (await import('node:crypto')).createHash('sha1')
    .update(MODULES.map(n => fs.readFileSync(path.join(root, 'lib', 'sketchup', `${n}.ts`))).join('')).digest('hex').slice(0, 10);

const body = [
    `${BEGIN} — generisano iz ERP-a (lib/sketchup/${MODULES.join('.ts, ')}.ts, ${sha}); NE MIJENJATI RUČNO, nego scripts/sync-sketchup-plugin.mjs >>> */`,
    'var NTS = (function(){',
    '  var M = {};',
    "  function req(n){ return M[String(n).replace(/^\\.\\//, '')]; }",
    ...parts,
    '  return M;',
    '})();',
    END,
].join('\n').split('\n').map(l => (l.trim() ? INDENT + l : l)).join('\n');

if (body.split('\n').some(l => l.trim() === 'HTML')) throw new Error('Generisani kod sadrži red „HTML" — prekinuo bi Ruby heredoc.');

const rb = fs.readFileSync(target, 'utf8');
const a = rb.indexOf(BEGIN);
const b = rb.indexOf(END);
if (a < 0 || b < 0 || b < a) throw new Error(`Markeri NT-ERP-SHARED nisu pronađeni u ${target}.`);
const lineStart = rb.lastIndexOf('\n', a) + 1;
const next = rb.slice(0, lineStart) + body + rb.slice(b + END.length);
if (next === rb) {
    console.log('Plugin je već sinhronizovan.');
} else {
    fs.writeFileSync(target, next);
    console.log(`Upisano u ${target} (${sha}, ${body.length} znakova).`);
}
