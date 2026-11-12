/**
 * @jest-environment node
 */
// STALNI SKUP ZA PONAVLJANJE — dodaj poruke iz izvoza revizije u grupu skupa.
// Bez modela i bez mreže; čita lokalni izvoz, piše u .bot-review/stalni-skup/<grupa>/
// (gitignore — stvarne poruke). Provjere (expect.json) se poslije popune rukom.
//
//   npx cross-env SKUP_FROM=.bot-review/<izvoz> SKUP_GROUP=<grupa> SKUP_IDS=<id>,<id> \
//       [SKUP_CUT=<ISO>] [SKUP_CARRY=1] jest lib/__tests__/botSkup.real.test.ts
//
// SKUP_CUT: snimak firme kakav je bio prije poruka (dokumenti nastali od tog
// trenutka ispadaju — upisi tih istih poruka). SKUP_CARRY=1: baza ide kroz razgovor.
// Pokretanje skupa: npm run bot:replay:skup (lib/assistant/replaySet.ts).

import fs from 'fs';
import path from 'path';
import { cutSnapshot, mergeEntries, mergeExpect, type ReplayGroupExpect } from '@/lib/assistant/replaySet';
import { reviewDir } from '@/lib/testing/reviewDir';

const FROM = reviewDir(process.env.SKUP_FROM);
const GROUP = process.env.SKUP_GROUP || '';
const run = FROM && GROUP ? describe : describe.skip;

const read = <T,>(file: string, fallback: T): T => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);

run('stalni skup: poruke iz izvoza u grupu', () => {
    it('entries.json, snapshot.json, expect.json', () => {
        const dir = path.join(reviewDir('skup'), GROUP);
        fs.mkdirSync(dir, { recursive: true });
        const ids = (process.env.SKUP_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!ids.length) throw new Error('SKUP_IDS je prazan — navedi ID-eve (ili početke ID-a) poruka iz entries.json izvoza.');

        const source = read<{ id: string; at: string }[]>(path.join(FROM, 'entries.json'), []);
        const { entries, missing } = mergeEntries(read(path.join(dir, 'entries.json'), []), source, ids);
        if (missing.length) throw new Error(`Nema u izvozu: ${missing.join(', ')}`);
        fs.writeFileSync(path.join(dir, 'entries.json'), JSON.stringify(entries, null, 1));

        const raw = read<Record<string, Record<string, unknown>>>(path.join(FROM, 'snapshot.json'), {});
        const cut = process.env.SKUP_CUT;
        const { snapshot, dropped } = cut ? cutSnapshot(raw, cut) : { snapshot: raw, dropped: {} };
        fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snapshot));

        const full = ids.map(id => source.find(x => x.id === id || x.id.startsWith(id))!.id);
        const prev = read<ReplayGroupExpect | null>(path.join(dir, 'expect.json'), null);
        const exp = mergeExpect(prev, full);
        if (process.env.SKUP_CARRY === '1') exp.carry = true;
        fs.writeFileSync(path.join(dir, 'expect.json'), JSON.stringify(exp, null, 1));

        console.log(`[skup] ${GROUP}: ${entries.length} poruka, snimak ${Object.keys(snapshot).length} dokumenata`
            + (cut ? ` (prije ${cut}; ispalo: ${Object.entries(dropped).map(([c, n]) => `${c} ${n}`).join(', ') || 'ništa'})` : ''));
    });
});
