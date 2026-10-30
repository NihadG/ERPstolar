#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// IZVOZ ZA REVIZIJU BOTA — SAMO ČITANJE produkcije (Firestore Admin SDK)
//
//   node scripts/bot-review/export.cjs [--days N] [--since ISO] [--no-snapshot]
//
// Poruke botu od zadnje revizije (ili zadnjih 14 dana) sa signalima,
// napomenama, alatima i potrošnjom, plus snimak firme za ponavljanje kroz
// bota. Sve ide u .bot-review/<datum>/ (gitignore — stvarne poruke i imena
// nikad u repo); .bot-review/latest.txt pokazuje na zadnji izvoz.
//
// Ništa se ne upisuje u bazu. Gmail tokeni (email_accounts) se ne izvoze.
// Korisnik i firma: Telegram veza (assistant_links), ili --uid.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_ROOT = path.join(ROOT, '.bot-review');
const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const SNAPSHOT_COLS = ['projects', 'products', 'product_materials', 'materials', 'orders', 'order_items', 'suppliers', 'workers',
    'work_orders', 'work_order_items', 'work_logs', 'worker_attendance', 'tasks', 'memory_items', 'contacts', 'assistant_vocab',
    'process_catalog', 'process_material_rules', 'process_flow_templates', 'offers', 'offer_products'];

function env() {
    const out = {};
    for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
        const m = l.match(/^([A-Z_]+)=(.*)$/);
        if (m) out[m[1]] = m[2];
    }
    return out;
}

function stamp(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

(async () => {
    const e = env();
    const key = e.FIREBASE_ADMIN_PRIVATE_KEY.replace(/^["']|["']$/g, '').split('\\n').join('\n');
    initializeApp({ credential: cert({ projectId: e.FIREBASE_ADMIN_PROJECT_ID, clientEmail: e.FIREBASE_ADMIN_CLIENT_EMAIL.split(/\s+/)[0], privateKey: key }) });
    const db = getFirestore();

    // Ko: Telegram veza (jedan korisnik bota) ili --uid.
    const links = (await db.collection('assistant_links').get()).docs.map(d => d.data());
    const link = arg('--uid') ? links.find(l => l.uid === arg('--uid')) : links[0];
    if (!link) throw new Error('Nema Telegram veze (assistant_links) — navedi --uid.');
    const { uid, orgId } = link;

    // Od kad: --since, --days, kursor zadnje revizije, inače 14 dana.
    fs.mkdirSync(OUT_ROOT, { recursive: true });
    const cursorFile = path.join(OUT_ROOT, 'cursor.json');
    const cursor = fs.existsSync(cursorFile) ? JSON.parse(fs.readFileSync(cursorFile, 'utf8')) : {};
    const since = arg('--since')
        || (arg('--days') ? new Date(Date.now() - Number(arg('--days')) * 86_400_000).toISOString() : '')
        || cursor.lastAt
        || new Date(Date.now() - 14 * 86_400_000).toISOString();

    const es = await db.collection('assistant_entries').where('Owner_UID', '==', uid).get();
    const entries = es.docs.map(d => d.data())
        .filter(x => x.Organization_ID === orgId && x.Created_At > since && (x.Raw_Text || '').trim())
        .sort((a, b) => String(a.Created_At).localeCompare(String(b.Created_At)))
        .map(x => ({
            id: x.Entry_ID, at: x.Created_At, kind: x.Kind, text: x.Raw_Text, forwardFrom: x.Forward_From,
            outcome: x.Outcome, reply: x.Reply_Text, changes: x.Changes || [],
            tools: (x.Tool_Calls || []).map(t => ({ name: t.name, ok: t.ok, args: t.args, ...(t.error ? { error: t.error } : {}) })),
            usage: x.Usage, attempts: x.Attempts, signals: x.Signals || [], feedback: x.Feedback || [],
        }));

    const dir = path.join(OUT_ROOT, stamp(new Date()));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'entries.json'), JSON.stringify(entries, null, 1));

    if (!args.includes('--no-snapshot')) {
        const snapshot = {};
        for (const c of SNAPSHOT_COLS) {
            const snap = await db.collection(c).where('Organization_ID', '==', orgId).get();
            snap.docs.forEach(d => { snapshot[`${c}/${d.id}`] = d.data(); });
        }
        for (const [c, id] of [['org_settings', orgId], ['organizations', orgId], ['users', uid], ['mail_people', uid]]) {
            const d = await db.collection(c).doc(id).get();
            if (d.exists) snapshot[`${c}/${id}`] = d.data();
        }
        (await db.collection('mail_inbox').where('Owner_UID', '==', uid).get()).docs.forEach(d => { snapshot[`mail_inbox/${d.id}`] = d.data(); });
        fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snapshot));
        console.log('snimak dokumenata:', Object.keys(snapshot).length);
    }

    fs.writeFileSync(path.join(OUT_ROOT, 'latest.txt'), dir);
    if (entries.length) fs.writeFileSync(cursorFile, JSON.stringify({ lastAt: entries[entries.length - 1].at, exportedAt: new Date().toISOString() }, null, 1));
    const withSignal = entries.filter(x => x.signals.length || x.feedback.length).length;
    console.log(`poruka: ${entries.length} (od ${since.slice(0, 16)}), sa signalom ili napomenom: ${withSignal}`);
    console.log(`folder: ${dir}`);
})().catch(err => { console.error('GREŠKA', err.message); process.exit(1); });
