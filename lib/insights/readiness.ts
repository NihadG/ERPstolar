// ════════════════════════════════════════════════════════════════════
// SPREMNOST SISTEMA — kada podaci dozvoljavaju precizno planiranje.
//
// Poenta nije ocjena nego GEJT: dok ovo ne poraste, gradnja prediktivnog
// planiranja je gubljenje vremena jer bi stajala na rupama.
//
// JEDNO MJERILO JE POSEBNO — STABILNOST (koeficijent varijacije trajanja).
// Ostalih sedam mjere KOLIKO podataka ima. Stabilnost mjeri da li podaci
// UOPŠTE mogu dati precizan odgovor: ako isti tip proizvoda nekad traje 2 a
// nekad 14 dana, ni hiljadu naloga neće dati uzak raspon.
// Zato stabilnost NE ulazi samo u zbir — ona OGRANIČAVA nivo. Bez toga bi
// indikator pokazivao 95%, a planiranje i dalje promašivalo.
// ════════════════════════════════════════════════════════════════════

import type { ProductionSnapshot } from '../types';
import { coefficientOfVariation, sharePct, round2 } from './stats';

export type ReadinessLevel = 'evidencija' | 'indikativno' | 'raspon' | 'precizno';

export interface ReadinessMetric {
    key: string;
    label: string;
    score: number;       // 0..100
    weight: number;
    value: string;       // trenutno stanje, ljudski čitljivo
    why: string;         // zašto je bitno
    actions: string[];   // konkretno šta uraditi
}

export interface Readiness {
    score: number;                 // 0..100, ponderisano
    level: ReadinessLevel;
    levelLabel: string;
    unlocked: string;              // šta ovaj nivo omogućava
    nextUnlock: string | null;     // šta otključava sljedeći nivo
    /** Postavljeno kad je nivo SPUŠTEN zbog stabilnosti, uprkos dobrom zbiru. */
    cappedBy: string | null;
    metrics: ReadinessMetric[];
    topActions: string[];
}

export interface ReadinessInput {
    snapshots: ProductionSnapshot[];
    /** Ukupno završenih naloga u bazi (i onih bez snapshota). */
    completedWorkOrders: number;
    /** Ukupno dnevnica i koliko ih ima pripisan proces. */
    workLogsTotal: number;
    workLogsWithProcess: number;
    /** Za svježinu; default danas. */
    today?: string;
}

const LEVELS: { min: number; level: ReadinessLevel; label: string; unlocked: string }[] = [
    { min: 80, level: 'precizno', label: 'Spremno za precizno planiranje', unlocked: 'Procjena po procesima i čekanjima; planiranje s uskim rasponom.' },
    { min: 60, level: 'raspon', label: 'Planiranje s rasponom', unlocked: 'Procjena trajanja po tipu proizvoda je upotrebljiva — ali kao RASPON, ne kao jedan datum.' },
    { min: 30, level: 'indikativno', label: 'Profili su indikativni', unlocked: 'Profili radnika i tipova pokazuju smjer, ali uzorci su premali za obavezujuću procjenu.' },
    { min: 0, level: 'evidencija', label: 'Samo evidencija', unlocked: 'Podaci se urednо skupljaju; još nema osnove za zaključke.' },
];

/** Ispod ovog rezultata stabilnosti nivo se ograničava na „raspon". */
const STABILITY_CAP_THRESHOLD = 50;
/** Uzorak po tipu koji se smatra „dubokim". */
const DEEP_SAMPLE = 15;
/** Minimum opažanja da prelaz uđe u statistiku. */
const TRANSITION_MIN = 5;

const pct = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);

export function computeReadiness(input: ReadinessInput): Readiness {
    const { snapshots, completedWorkOrders, workLogsTotal, workLogsWithProcess } = input;
    const today = input.today || new Date().toISOString().slice(0, 10);

    const v3 = snapshots.filter(s => (s.Snapshot_Version || 1) >= 3);
    const items = v3.flatMap(s => s.Items || []);
    const metrics: ReadinessMetric[] = [];

    // ── 1. Pokrivenost snapshotima ──────────────────────────────────
    const covScore = pct(v3.length, Math.max(completedWorkOrders, v3.length));
    const missing = Math.max(0, completedWorkOrders - v3.length);
    metrics.push({
        key: 'coverage', label: 'Pokrivenost snapshotima', weight: 15,
        score: round2(covScore),
        value: `${v3.length}/${completedWorkOrders} završenih naloga`,
        why: 'Nalog bez snapshota ne postoji ni za jednu analizu.',
        actions: missing > 0 ? [`${missing} naloga bez v3 snapshota — pokreni „Regeneriši snapshote"`] : [],
    });

    // ── 2. Klasifikacija ────────────────────────────────────────────
    const classified = v3.filter(s => (s.Normalized_Product_Types?.length || 0) > 0).length;
    const tokenCounts = new Map<string, number>();
    for (const s of v3) for (const t of s.Unmatched_Name_Tokens || []) {
        tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1);
    }
    const materialCounts = new Map<string, number>();
    for (const s of v3) for (const m of s.Unmatched_Materials || []) {
        materialCounts.set(m, (materialCounts.get(m) || 0) + 1);
    }
    const topToken = [...tokenCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const topMaterial = [...materialCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const classActions: string[] = [];
    if (topToken) classActions.push(`Neprepoznat naziv: „${topToken[0]}" (${topToken[1]}×) — mapiraj u tip`);
    if (topMaterial) classActions.push(`Neprepoznat materijal: „${topMaterial[0]}" (${topMaterial[1]}×) — mapiraj u tip`);
    metrics.push({
        key: 'classification', label: 'Klasifikacija naloga', weight: 15,
        score: round2(pct(classified, v3.length || 1)),
        value: `${classified}/${v3.length} naloga ima tip; ${tokenCounts.size} nepoznatih riječi, ${materialCounts.size} nepoznatih materijala`,
        why: 'Bez tipa se nalog ne može uporediti ni s čim — ne ulazi ni u jedan profil.',
        actions: classActions,
    });

    // ── 3. Atribucija procesa ───────────────────────────────────────
    const attrScore = pct(workLogsWithProcess, workLogsTotal || 1);
    const noProcess = Math.max(0, workLogsTotal - workLogsWithProcess);
    metrics.push({
        key: 'processAttribution', label: 'Rad pripisan procesima', weight: 20,
        score: round2(attrScore),
        value: `${workLogsWithProcess}/${workLogsTotal} dnevnica`,
        why: 'Bez procesa na dnevnici nema ni trajanja procesa ni čekanja — otpada cijela analiza toka.',
        actions: noProcess > 0 ? [`${noProcess} dnevnica bez procesa — provjeri graf procesa na tim nalozima`] : [],
    });

    // ── 4. Plan vs stvarno ──────────────────────────────────────────
    const comparable = items.filter(i => (i.Planned_Worker_Days || 0) > 0 && (i.Actual_Labor_Days || 0) > 0);
    const noPlan = items.length - comparable.length;
    metrics.push({
        key: 'planVsActual', label: 'Plan i stvarno uporedivi', weight: 15,
        score: round2(pct(comparable.length, items.length || 1)),
        value: `${comparable.length}/${items.length} stavki ima i plan i stvarno`,
        why: 'Bez oba broja procjena se ne može kalibrisati — ne zna se koliko ponuda griješi.',
        actions: noPlan > 0 ? [`${noPlan} stavki bez planiranih dana — dopuni ponude (dani × radnici)`] : [],
    });

    // ── 5. Dubina po tipu ───────────────────────────────────────────
    const byType = new Map<string, number>();
    for (const s of v3) for (const it of s.Items || []) {
        const types = it.Product_Types?.length ? it.Product_Types : (s.Name_Derived_Types || []);
        for (const t of types) byType.set(t, (byType.get(t) || 0) + 1);
    }
    // Djelimičan kredit: tip s n=7 vrijedi ~pola tipa s n=15, ponderisano brojem stavki
    let creditedItems = 0, totalTypedItems = 0;
    for (const [, n] of byType) {
        totalTypedItems += n;
        creditedItems += n * Math.min(1, n / DEEP_SAMPLE);
    }
    const deepTypes = [...byType.values()].filter(n => n >= DEEP_SAMPLE).length;
    metrics.push({
        key: 'typeDepth', label: 'Dubina uzorka po tipu', weight: 15,
        score: round2(pct(creditedItems, totalTypedItems || 1)),
        value: `${deepTypes} tipova s ≥${DEEP_SAMPLE} stavki (od ${byType.size})`,
        why: `Ispod ${DEEP_SAMPLE} stavki raspon je preširok da bi bio obavezujući.`,
        actions: byType.size > 0 && deepTypes === 0
            ? ['Nijedan tip još nema dubok uzorak — nastavi s evidencijom']
            : [],
    });

    // ── 6. Pokrivenost prelaza ──────────────────────────────────────
    const transCounts = new Map<string, number>();
    for (const s of v3) for (const tr of s.Transitions || []) {
        const id = `${tr.From_Name}→${tr.To_Name}`;
        transCounts.set(id, (transCounts.get(id) || 0) + 1);
    }
    const solidTransitions = [...transCounts.values()].filter(n => n >= TRANSITION_MIN).length;
    metrics.push({
        key: 'transitionCoverage', label: 'Pokrivenost prelaza procesa', weight: 8,
        score: round2(pct(solidTransitions, transCounts.size || 1)),
        value: `${solidTransitions}/${transCounts.size} prelaza s ≥${TRANSITION_MIN} opažanja`,
        why: 'Čekanje između procesa je najveći dio proteklog vremena; bez opažanja se ne može planirati.',
        actions: [],
    });

    // ── 7. STABILNOST — ograničava nivo ─────────────────────────────
    const cvs: number[] = [];
    for (const [type, n] of byType) {
        if (n < 3) continue;
        const days: number[] = [];
        for (const s of v3) for (const it of s.Items || []) {
            const types = it.Product_Types?.length ? it.Product_Types : (s.Name_Derived_Types || []);
            if (!types.includes(type)) continue;
            const qty = it.Quantity > 0 ? it.Quantity : 1;
            if ((it.Actual_Labor_Days || 0) > 0) days.push(it.Actual_Labor_Days / qty);
        }
        const cv = coefficientOfVariation(days);
        if (cv !== null) cvs.push(cv);
    }
    const medianCV = cvs.length
        ? [...cvs].sort((a, b) => a - b)[Math.floor(cvs.length / 2)]
        : null;
    // CV 0 → 100, CV 1 → 0. Linearno, jer je i tumačenje linearno („±100% rasipanja").
    const stabilityScore = medianCV === null ? 0 : Math.max(0, Math.min(100, (1 - medianCV) * 100));
    metrics.push({
        key: 'stability', label: 'Stabilnost trajanja', weight: 8,
        score: round2(stabilityScore),
        value: medianCV === null
            ? 'nema dovoljno podataka'
            : `rasipanje ±${Math.round(medianCV * 100)}% (medijan po tipovima)`,
        why: 'Ako je rasipanje veliko, procjena NEĆE biti precizna ma koliko podataka skupili. Ovo mjerilo ograničava nivo.',
        actions: medianCV !== null && stabilityScore < STABILITY_CAP_THRESHOLD
            ? ['Veliko rasipanje — provjeri jesu li tipovi prekrupni (npr. „kuhinja" spaja male i velike poslove)']
            : [],
    });

    // ── 8. Svježina ─────────────────────────────────────────────────
    const cutoff = new Date(today + 'T12:00:00');
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const cutoffISO = cutoff.toISOString().slice(0, 10);
    const fresh = v3.filter(s => (s.Actual_End || '').slice(0, 10) >= cutoffISO).length;
    metrics.push({
        key: 'freshness', label: 'Svježina podataka', weight: 4,
        score: round2(pct(fresh, v3.length || 1)),
        value: `${fresh}/${v3.length} naloga iz zadnjih 12 mjeseci`,
        why: 'Stara istorija ne opisuje današnji pogon (drugi ljudi, drugi materijali, druge mašine).',
        actions: [],
    });

    // ── Zbir i nivo ─────────────────────────────────────────────────
    const totalWeight = metrics.reduce((s, m) => s + m.weight, 0);
    const score = round2(metrics.reduce((s, m) => s + m.score * m.weight, 0) / totalWeight);

    let band = LEVELS.find(l => score >= l.min)!;
    let cappedBy: string | null = null;
    // Stabilnost obara nivo bez obzira na zbir — količina podataka ne liječi rasipanje.
    if (stabilityScore < STABILITY_CAP_THRESHOLD && (band.level === 'precizno')) {
        band = LEVELS.find(l => l.level === 'raspon')!;
        cappedBy = `Zbir dozvoljava viši nivo, ali je rasipanje trajanja preveliko (±${Math.round((medianCV ?? 1) * 100)}%). Više podataka to neće popraviti — treba suziti tipove ili razdvojiti poslove.`;
    }

    const nextBand = LEVELS.filter(l => l.min > band.min).sort((a, b) => a.min - b.min)[0] || null;

    return {
        score,
        level: band.level,
        levelLabel: band.label,
        unlocked: band.unlocked,
        nextUnlock: nextBand ? `Na ${nextBand.min} bodova: ${nextBand.unlocked}` : null,
        cappedBy,
        metrics: metrics.sort((a, b) => a.score - b.score || b.weight - a.weight),
        topActions: metrics
            .filter(m => m.actions.length > 0)
            .sort((a, b) => (a.score * a.weight) - (b.score * b.weight))
            .flatMap(m => m.actions)
            .slice(0, 6),
    };
}
