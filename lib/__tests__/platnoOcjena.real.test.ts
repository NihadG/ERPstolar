/**
 * @jest-environment node
 */
// OCJENA PLANOVA S PLATNA — mjeri planove, ne mijenja ih. Čita snimak firme iz izvoza revizije
// (.bot-review/<datum>/snapshot.json, uz planning_scenarios), bez mreže, i piše platno.md pored
// njega (gitignore — stvarni nazivi): kraj plana, dokazano najraniji kraj i razlog, provjere.
//
//   npm run platno:ocjena        (zadnji izvoz; prije toga npm run bot:export)
//
// Kalendar = smjene + šihtarica + praznici (sačuvani u Postavkama, inače zadani bh.); stvarni
// nalozi zauzimaju radnike samo za PREOSTALI rad (plan − Knjiga rada, lib/canvas/opt/remaining.ts).

import fs from 'fs';
import path from 'path';
import { reviewDir } from '@/lib/testing/reviewDir';
import { buildWorkerCalendar } from '@/lib/canvas/opt/calendar';
import { buildInstance, isJobBlock } from '@/lib/canvas/opt/instance';
import { placementsFromScenario } from '@/lib/canvas/opt/evaluate';
import { qualityReport } from '@/lib/canvas/opt/quality';
import { remainingLines, remainingWork } from '@/lib/canvas/opt/remaining';
import { movableBlockIds, proposeSchedule } from '@/lib/canvas/opt/propose';
import { planVsReality } from '@/lib/canvas/opt/reality';
import { effectiveHolidays, holidayDates } from '@/lib/holidays';
import { todayISO } from '@/lib/planning';
import type { PlanScenario } from '@/lib/types';

const DIR = reviewDir(process.env.BOT_REVIEW);
const run = DIR && fs.existsSync(path.join(DIR, 'snapshot.json')) ? describe : describe.skip;

run('ocjena planova s Platna', () => {
    it('platno.md', () => {
        const snapshot: Record<string, any> = JSON.parse(fs.readFileSync(path.join(DIR, 'snapshot.json'), 'utf8'));
        const col = (name: string) => Object.entries(snapshot).filter(([k]) => k.startsWith(`${name}/`)).map(([, v]) => v);
        const scenarios = col('planning_scenarios').filter((s: PlanScenario) => !s.Is_Archived && (s.Blocks || []).some(isJobBlock));
        const workers = col('workers');
        const attendance = col('worker_attendance').map(a => ({ Worker_ID: a.Worker_ID, Date: String(a.Date).slice(0, 10), Status: a.Status }));
        const projects = col('projects');
        const today = todayISO();
        const holidays = holidayDates(effectiveHolidays(col('org_settings')[0]?.holidays, today));
        const items = col('work_order_items');
        const workOrders = col('work_orders').map(wo => ({ ...wo, items: items.filter(i => i.Work_Order_ID === wo.Work_Order_ID) }));
        const workLogs = col('work_logs');
        const out = ['# Planovi s Platna — ocjena', ''];
        const summary: string[] = [];
        for (const sc of scenarios.sort((a: PlanScenario, b: PlanScenario) => String(b.Modified_Date).localeCompare(String(a.Modified_Date)))) {
            const jobs = sc.Blocks.filter(isJobBlock);
            const startISO = jobs.map((b: { startISO: string }) => b.startISO).sort()[0];
            const calendar = buildWorkerCalendar({ workers, attendance, holidays });
            const linked = sc.Blocks.map((b: { linkedWorkOrderId?: string }) => b.linkedWorkOrderId).filter(Boolean) as string[];
            const rest = remainingWork({ workOrders, workLogs, calendar, startISO: today, skipWorkOrderIds: linked });
            const inst = buildInstance(sc, { startISO, calendar, projects, fixedLoad: rest.fixedLoad });
            const r = qualityReport(inst, placementsFromScenario(inst, sc.Blocks));
            out.push(`## ${sc.Name} (verzija ${sc.Version}, mijenjan ${String(sc.Modified_Date).slice(0, 16).replace('T', ' ')}, ${jobs.length} naloga)`, '');
            out.push(...r.lines.map(l => (l.startsWith('  ') ? `- ${l.trim()}` : l)), '');
            // Prijedlog optimizatora v2 od danas (isto što daje „Rasporedi" na Platnu).
            let optLine = '[platno]   → optimizator: nema naloga s kandidat-ekipama (nema šta rasporediti)';
            if (movableBlockIds(sc).size) {
                const t0 = Date.now();
                const p = proposeSchedule(sc, { workers, workOrders, attendance: attendance as never, projects, holidays, workLogs }, { startISO: today > startISO ? today : startISO, todayISO: today });
                const q = p.quality.after;
                out.push(`Prijedlog optimizatora (od ${today > startISO ? today : startISO}, ${p.quality.evals} rasporeda, ${Date.now() - t0} ms):`, ...q.lines.map(l => `- ${l.trim()}`), '');
                optLine = (`[platno]   → optimizator: ${q.lines[0]}; ${q.evaluation.violations.length ? `neizvodljiv (${q.evaluation.objective.violation})` : 'izvodljiv'}`);
            }
            // Plan vs stvarnost (faza 6): nalozi s Platna pretvoreni u stvarne naloge.
            const real = planVsReality({ scenario: sc, workOrders, workLogs, todayISO: today, isWorkFor: () => iso => calendar.available('__radionica__', iso) > 0 });
            out.push('Plan vs stvarnost:', ...real.lines.map(l => `- ${l}`), ...real.rows.slice(0, 15).map(r => `- ${r.title}: ${r.verdict}`), '');
            if (rest.orders.length) out.push('Stvarni nalozi u toku (preostali rad):', ...remainingLines(rest.orders).map(l => `- ${l}`), '');
            if (r.evaluation.violations.length) {
                out.push('Prekršene provjere:');
                r.evaluation.violations.slice(0, 40).forEach(v => out.push(`- ${v.text}`));
                if (r.evaluation.violations.length > 40) out.push(`- … još ${r.evaluation.violations.length - 40}`);
                out.push('');
            }
            summary.push(`[platno] ${sc.Name}: ${r.lines[0]}; ${r.evaluation.violations.length ? `neizvodljiv (${r.evaluation.objective.violation})` : 'izvodljiv'}`);
            summary.push(optLine);
        }
        const file = path.join(DIR, 'platno.md');
        fs.writeFileSync(file, out.join('\n'));
        console.log([...summary, `[platno] ${file}`].join('\n'));
        expect(scenarios.length).toBeGreaterThanOrEqual(0);
    });
});
