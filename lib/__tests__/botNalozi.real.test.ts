/**
 * @jest-environment node
 */
// PROVJERA NALOGA — gdje nalozi odstupaju od onoga što ERP sam traži (lib/orderLife.ts orderProblems).
// Mjeri sistem, ne poruke: čita snimak firme iz izvoza revizije (.bot-review/<datum>/snapshot.json),
// bez modela i bez mreže, i piše nalozi.md pored njega (gitignore — stvarni nazivi).
//
//   npm run bot:nalozi        (zadnji izvoz; prije toga npm run bot:export)

//   npm run bot:nalozi:proba  isto, pa na KOPIJI snimka (lažna baza) dovede naloge u red istim
//                             pravilima (healOrders) i izmjeri ponovo → nalozi-poslije.md i
//                             nalozi-ops.json (šta bi se promijenilo; u živi ERP ništa ne ide)

jest.mock('@/lib/server/firebaseAdmin', () => require('@/lib/testing/fakeFirestore').firebaseAdminMock);

import fs from 'fs';
import path from 'path';
import { orderProblems, type OrderProblem } from '@/lib/orderLife';
import { healOrders } from '@/lib/server/workDiary';
import { fakeStore as store } from '@/lib/testing/fakeFirestore';
import { reviewDir } from '@/lib/testing/reviewDir';

const DIR = reviewDir(process.env.BOT_REVIEW);
const run = DIR && fs.existsSync(path.join(DIR, 'snapshot.json')) ? describe : describe.skip;

const RULES: Record<OrderProblem['rule'], string> = {
    ceka: 'rad upisan, a nalog nije „U toku"',
    ekipa: 'radili ove sedmice, a nisu u ekipi naloga',
    planer: '„U toku", a nije u Planeru',
    pocetak: 'početak naloga poslije prvog rada',
    otvoren: 'svi proizvodi završeni, nalog otvoren',
    plan: 'proizvodni nalog bez plana procesa',
    proizvod: 'status proizvoda na projektu ne prati nalog',
};

type Snapshot = Record<string, any>;

function audit(snapshot: Snapshot, file: string): number {
    const col = (name: string) => Object.entries(snapshot).filter(([k]) => k.startsWith(`${name}/`)).map(([, v]) => v);
    const orders = col('work_orders');
    const logs = col('work_logs');
    const today = lastDay(snapshot);
    const problems = orderProblems({ orders, items: col('work_order_items'), logs, products: col('products'), today });
    const open = orders.filter(o => o.Status !== 'Završeno' && o.Status !== 'Otkazano');
    const bad = new Set(problems.map(p => p.order));
    const lines = [`# Nalozi: ${open.length - bad.size} od ${open.length} otvorenih po pravilima ERP-a (stanje ${today})`, ''];
    for (const rule of Object.keys(RULES) as OrderProblem['rule'][]) {
        const mine = problems.filter(p => p.rule === rule);
        if (!mine.length) continue;
        lines.push(`## ${RULES[rule]} — ${new Set(mine.map(p => p.order)).size} naloga`);
        mine.forEach(p => lines.push(`- ${p.order}: ${p.detail}`));
        lines.push('');
    }
    fs.writeFileSync(path.join(DIR, file), lines.join('\n'));
    const count = (Object.keys(RULES) as OrderProblem['rule'][]).map(r => `${r} ${new Set(problems.filter(p => p.rule === r).map(p => p.order)).size}`).join(', ');
    console.log(`[nalozi] ${lines[0].slice(2)}\n[nalozi] po pravilu (broj naloga): ${count}\n[nalozi] ${path.join(DIR, file)}`);
    return bad.size;
}

const lastDay = (snapshot: Snapshot) => Object.entries(snapshot).filter(([k]) => k.startsWith('work_logs/')).map(([, l]) => String(l.Date || '').slice(0, 10)).sort().at(-1)
    || new Date().toISOString().slice(0, 10);

run('provjera naloga nad snimkom firme', () => {
    const snapshot: Snapshot = DIR ? JSON.parse(fs.readFileSync(path.join(DIR, 'snapshot.json'), 'utf8')) : {};

    it('nalozi.md', () => {
        audit(snapshot, 'nalozi.md');
    });

    (process.env.BOT_NALOZI_PROBA === '1' ? it : it.skip)('proba na kopiji: nalozi dovedeni u red istim pravilima → nalozi-poslije.md, nalozi-ops.json', async () => {
        store.clear();
        for (const [k, v] of Object.entries(snapshot)) store.set(k, JSON.parse(JSON.stringify(v)));
        const orgId = Object.values(snapshot).find(d => d?.Organization_ID)?.Organization_ID as string;
        const before = new Map<string, Record<string, unknown> | null>();
        await healOrders(orgId, lastDay(snapshot), (p, data) => { if (!before.has(p)) before.set(p, data); });
        const after: Snapshot = {};
        store.forEach((v: unknown, k: string) => { after[k] = v; });
        // Samo polja koja se stvarno mijenjaju — to je spisak za primjenu u živom ERP-u (uz odobrenje i kopiju).
        const ops = Array.from(before.entries()).map(([p, was]) => {
            const now = after[p] as Record<string, unknown>;
            const set = Object.fromEntries(Object.entries(now || {}).filter(([f, v]) => JSON.stringify(v) !== JSON.stringify((was || {})[f])));
            return { path: p, set, was: Object.fromEntries(Object.keys(set).map(f => [f, (was || {})[f] ?? null])) };
        }).filter(o => Object.keys(o.set).length);
        fs.writeFileSync(path.join(DIR, 'nalozi-ops.json'), JSON.stringify(ops, null, 1));
        const left = audit(after, 'nalozi-poslije.md');
        console.log(`[nalozi] proba: ${ops.length} dokumenata bi se promijenilo (${path.join(DIR, 'nalozi-ops.json')}); odstupa još ${left} naloga`);
    }, 120_000);
});
