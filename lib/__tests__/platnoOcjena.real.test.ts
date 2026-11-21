/**
 * @jest-environment node
 */
// OCJENA PLANOVA S PLATNA — mjeri planove, ne mijenja ih. Čita snimak firme iz izvoza revizije
// (.bot-review/<datum>/snapshot.json, uz planning_scenarios), bez mreže, i piše platno.md pored
// njega (gitignore — stvarni nazivi): kraj plana, dokazano najraniji kraj i razlog, provjere.
//
//   npm run platno:ocjena        (zadnji izvoz; prije toga npm run bot:export)
//
// Faza 1: kalendar = smjene + šihtarica + fiksni državni praznici; stvarni nalozi još ne
// zauzimaju radnike u ocjeni (faza 2: preostali rad iz Knjige rada).

import fs from 'fs';
import path from 'path';
import { reviewDir } from '@/lib/testing/reviewDir';
import { buildWorkerCalendar } from '@/lib/canvas/opt/calendar';
import { buildInstance, isJobBlock } from '@/lib/canvas/opt/instance';
import { placementsFromScenario } from '@/lib/canvas/opt/evaluate';
import { qualityReport } from '@/lib/canvas/opt/quality';
import type { PlanScenario } from '@/lib/types';

const DIR = reviewDir(process.env.BOT_REVIEW);
const run = DIR && fs.existsSync(path.join(DIR, 'snapshot.json')) ? describe : describe.skip;

/** Fiksni državni praznici FBiH (vjerski i korisnikovi dolaze u fazi 2, iz Postavki). */
function stateHolidays(years: number[]): string[] {
    return years.flatMap(y => ['01-01', '01-02', '03-01', '05-01', '05-02', '11-25'].map(md => `${y}-${md}`));
}

run('ocjena planova s Platna', () => {
    it('platno.md', () => {
        const snapshot: Record<string, any> = JSON.parse(fs.readFileSync(path.join(DIR, 'snapshot.json'), 'utf8'));
        const col = (name: string) => Object.entries(snapshot).filter(([k]) => k.startsWith(`${name}/`)).map(([, v]) => v);
        const scenarios = col('planning_scenarios').filter((s: PlanScenario) => !s.Is_Archived && (s.Blocks || []).some(isJobBlock));
        const workers = col('workers');
        const attendance = col('worker_attendance').map(a => ({ Worker_ID: a.Worker_ID, Date: String(a.Date).slice(0, 10), Status: a.Status }));
        const projects = col('projects');
        const out = ['# Planovi s Platna — ocjena', ''];
        const summary: string[] = [];
        for (const sc of scenarios.sort((a: PlanScenario, b: PlanScenario) => String(b.Modified_Date).localeCompare(String(a.Modified_Date)))) {
            const jobs = sc.Blocks.filter(isJobBlock);
            const startISO = jobs.map((b: { startISO: string }) => b.startISO).sort()[0];
            const year = Number(startISO.slice(0, 4));
            const calendar = buildWorkerCalendar({ workers, attendance, holidays: stateHolidays([year, year + 1]) });
            const inst = buildInstance(sc, { startISO, calendar, projects });
            const r = qualityReport(inst, placementsFromScenario(inst, sc.Blocks));
            out.push(`## ${sc.Name} (verzija ${sc.Version}, mijenjan ${String(sc.Modified_Date).slice(0, 16).replace('T', ' ')}, ${jobs.length} naloga)`, '');
            out.push(...r.lines.map(l => (l.startsWith('  ') ? `- ${l.trim()}` : l)), '');
            if (r.evaluation.violations.length) {
                out.push('Prekršene provjere:');
                r.evaluation.violations.slice(0, 40).forEach(v => out.push(`- ${v.text}`));
                if (r.evaluation.violations.length > 40) out.push(`- … još ${r.evaluation.violations.length - 40}`);
                out.push('');
            }
            summary.push(`[platno] ${sc.Name}: ${r.lines[0]}; ${r.evaluation.violations.length ? `neizvodljiv (${r.evaluation.objective.violation})` : 'izvodljiv'}`);
        }
        const file = path.join(DIR, 'platno.md');
        fs.writeFileSync(file, out.join('\n'));
        console.log([...summary, `[platno] ${file}`].join('\n'));
        expect(scenarios.length).toBeGreaterThanOrEqual(0);
    });
});
