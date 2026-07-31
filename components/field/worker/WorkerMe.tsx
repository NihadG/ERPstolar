'use client';

// ════════════════════════════════════════════════════════════════════
// RADNIK — JA
//
// Identitet + SUPTILAN pregled efikasnosti. Pravila (obavezna): nijedan iznos,
// nijedna ocjena/skor, nijedno poređenje s drugima, nijedna rečenica u drugom
// licu. Brojke stoje jedna pored druge; zaključak izvodi radnik.
//
// „Tempo" prikazuje planirano/utrošeno/moj-udio ODVOJENO — dijeljenje bi lažno
// pripisalo timski trošak jednom čovjeku. „Ritam" pokazuje sedmice: plava =
// proknjiženi dani, siva linija = prisutni dani (razmak između njih je vlastiti
// signal, bez ijedne izgovorene riječi).
// ════════════════════════════════════════════════════════════════════

import { LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import type { FieldHomePayload } from '@/lib/field/fieldHome';
import type { WorkerEfficiency, WorkerTempoRow } from '@/lib/field/fieldWorker';
import { useWorkerMe } from '@/lib/field/useFieldWorker';
import {
    MList, MItem, MCell, MText, MValue, MButton, MSection, MEmpty,
} from '@/components/tabs/mobile/MobileUI';
import CutlistLauncher from '../cutlist/CutlistLauncher';

interface Props {
    data: FieldHomePayload;
    previewUid?: string | null;
    readOnly?: boolean;
}

export default function WorkerMe({ data, previewUid, readOnly }: Props) {
    const { signOut } = useAuth();
    const { efficiency, loading } = useWorkerMe(previewUid);

    return (
        <>
            <div className="mui-large"><h1>Ja</h1><p>{data.organization.name}</p></div>

            <MList>
                <MItem><MCell><MText title="Ime" /><MValue num={false}>{data.user.name}</MValue></MCell></MItem>
                <MItem><MCell><MText title="Uloga" /><MValue num={false}>{data.user.roleLabel}</MValue></MCell></MItem>
                {data.user.workerName && (
                    <MItem><MCell><MText title="Radnik" /><MValue num={false}>{data.user.workerName}</MValue></MCell></MItem>
                )}
            </MList>

            <MSection title="Alati" />
            <CutlistLauncher />

            {efficiency && <EfficiencyPanel eff={efficiency} />}
            {loading && !efficiency && <div className="fld-loading">Učitavanje…</div>}

            {!readOnly && (
                <div className="fld-submit">
                    <MButton variant="danger" onClick={() => signOut()}>
                        <LogOut size={18} /> Odjavi se
                    </MButton>
                </div>
            )}
        </>
    );
}

function EfficiencyPanel({ eff }: { eff: WorkerEfficiency }) {
    const hasAny = eff.workedDays > 0 || eff.tempo.length > 0;

    return (
        <>
            <MSection title="Moj mjesec" />

            <div className="fwk-eff-stats">
                <div className="fwk-eff-stat">
                    <div className="fwk-eff-num">{eff.workedDays}</div>
                    <div className="fwk-eff-lbl">radnih dana</div>
                </div>
                <div className="fwk-eff-stat">
                    <div className="fwk-eff-num">{eff.presentDays}</div>
                    <div className="fwk-eff-lbl">prisutan</div>
                </div>
                <div className="fwk-eff-stat">
                    <div className="fwk-eff-num">{eff.productsWorked}</div>
                    <div className="fwk-eff-lbl">proizvoda</div>
                </div>
            </div>

            {!hasAny && (
                <MEmpty title="Još nema podataka" sub="Kad se rad proknjiži, ovdje se pojavljuje pregled." />
            )}

            {eff.tempo.length > 0 && (
                <>
                    <MSection title="Tempo po proizvodu" />
                    {eff.tempo.slice(0, 6).map((t, i) => <TempoCard key={i} t={t} />)}
                </>
            )}

            {eff.rhythm.some(w => w.bookedDays > 0 || w.presentDays > 0) && (
                <>
                    <MSection title="Ritam — 8 sedmica" />
                    <RhythmChart eff={eff} />
                </>
            )}
        </>
    );
}

function TempoCard({ t }: { t: WorkerTempoRow }) {
    // Traka predstavlja veći od (planirano, utrošeno); siva = utrošeno tima,
    // plava = moj udio (uvijek ≤ utrošeno). Brojke nose planirano-vs-utrošeno.
    const scale = Math.max(t.plannedDays, t.actualDays, 1);
    const actualPct = Math.min(100, (t.actualDays / scale) * 100);
    const minePct = Math.min(actualPct, (t.myDays / scale) * 100);

    return (
        <div className="fwk-tempo">
            <div className="fwk-tempo-name">{t.productName}</div>
            {t.projectName && <div className="fwk-tempo-proj">{t.projectName}</div>}
            <div className="fwk-tempo-track">
                <div className="fwk-tempo-actual" style={{ width: `${actualPct}%` }} />
                <div className="fwk-tempo-mine" style={{ width: `${minePct}%` }} />
            </div>
            <div className="fwk-tempo-legend">
                <span>Planirano <b>{t.plannedDays || '—'}</b></span>
                <span>Utrošeno <b>{t.actualDays}</b></span>
                <span>Moj udio <b>{t.myDays}</b></span>
            </div>
        </div>
    );
}

function RhythmChart({ eff }: { eff: WorkerEfficiency }) {
    const scale = Math.max(1, ...eff.rhythm.map(w => Math.max(w.bookedDays, w.presentDays)));
    return (
        <div className="fwk-rhythm">
            {eff.rhythm.map((w, i) => {
                const barPct = (w.bookedDays / scale) * 100;
                const presentPct = (w.presentDays / scale) * 100;
                return (
                    <div key={i} className={`fwk-rhythm-col${w.isCurrent ? ' cur' : ''}`}>
                        <div className="fwk-rhythm-track">
                            {w.presentDays > 0 && (
                                <div className="fwk-rhythm-present" style={{ bottom: `${presentPct}%` }} />
                            )}
                            <div className="fwk-rhythm-bar" style={{ height: `${barPct}%` }} />
                        </div>
                        <div className="fwk-rhythm-lbl">{w.label.split('–')[0]}</div>
                    </div>
                );
            })}
        </div>
    );
}
