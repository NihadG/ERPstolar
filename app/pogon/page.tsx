'use client';

// ════════════════════════════════════════════════════════════════════
// /pogon — ekran za radnika i kontrolora
//
// Dvije publike:
//   • pogonska uloga → puni ekran (na telefonu je to cijeli uređaj),
//   • vlasnik/admin s `?preview=<uid>` → „Pogledaj kao", u okviru telefona.
//
// Vlasnik bez `preview` nema šta ovdje tražiti i vraća se na `/`. Suprotno
// preusmjeravanje (pogonska uloga s `/` na `/pogon`) je u app/page.tsx.
// ════════════════════════════════════════════════════════════════════

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import FieldShell from '@/components/field/FieldShell';

export const dynamic = 'force-dynamic';

function PogonInner() {
    const router = useRouter();
    const params = useSearchParams();
    const { firebaseUser, loading, isField, isStaff } = useAuth();

    const previewUid = params.get('preview');
    const isPreview = !!previewUid && isStaff;

    useEffect(() => {
        if (loading) return;
        if (!firebaseUser) { router.replace('/login'); return; }
        // Vlasnik koji nije došao gledati tuđi ekran — nazad u aplikaciju.
        if (!isField && !isPreview) router.replace('/');
    }, [loading, firebaseUser, isField, isPreview, router]);

    if (loading || !firebaseUser) {
        return (
            <div className="pogon-boot">
                <div className="loading-spinner" />
                <p>Učitavanje…</p>
                <style jsx>{`
                    .pogon-boot {
                        min-height: 100vh; display: flex; flex-direction: column;
                        align-items: center; justify-content: center; gap: 14px;
                        background: #eef1f6; color: rgba(60,60,67,0.6);
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    }
                `}</style>
            </div>
        );
    }

    // ── Pregled (vlasnik gleda tuđi ekran) ───────────────────────────
    if (isPreview) {
        return (
            <div className="pogon-preview">
                <header className="pogon-preview-top">
                    <Link href="/settings" className="pogon-back">← Nazad na Postavke</Link>
                    <span className="pogon-preview-hint">
                        Ovako izgleda aplikacija na telefonu tog korisnika. Akcije su onemogućene.
                    </span>
                </header>

                <div className="pogon-phone">
                    <FieldShell previewUid={previewUid} />
                </div>

                <style jsx>{`
                    .pogon-preview {
                        min-height: 100vh;
                        background: radial-gradient(120% 80% at 50% 0%, #2b2f3a 0%, #14161c 60%);
                        display: flex; flex-direction: column; align-items: center;
                        padding: 22px 16px 40px; gap: 18px;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    }
                    .pogon-preview-top {
                        width: 100%; max-width: 760px;
                        display: flex; align-items: center; justify-content: space-between;
                        gap: 16px; flex-wrap: wrap;
                    }
                    .pogon-back {
                        color: #fff; text-decoration: none; font-size: 14px;
                        padding: 7px 13px; border-radius: 9px;
                        background: rgba(255,255,255,0.12);
                    }
                    .pogon-back:hover { background: rgba(255,255,255,0.2); }
                    .pogon-preview-hint { color: rgba(255,255,255,0.55); font-size: 13px; }

                    /* Okvir telefona: 390×844 = iPhone 14/15 logička rezolucija. */
                    .pogon-phone {
                        width: 390px; height: 844px; max-height: calc(100vh - 130px);
                        border-radius: 44px; overflow: hidden;
                        border: 11px solid #0b0d12;
                        box-shadow: 0 34px 80px rgba(0,0,0,0.6), 0 0 0 1.5px rgba(255,255,255,0.09);
                        background: #eef1f6;
                    }
                    @media (max-width: 460px) {
                        .pogon-preview { padding: 12px 0 0; }
                        .pogon-phone {
                            width: 100%; height: calc(100vh - 70px); max-height: none;
                            border-radius: 0; border: none;
                        }
                    }
                `}</style>
            </div>
        );
    }

    // ── Stvarni pogonski korisnik ────────────────────────────────────
    if (!isField) return null;   // preusmjeravanje je u toku

    return <FieldShell />;
}

export default function PogonPage() {
    // useSearchParams traži Suspense granicu u App Routeru.
    return (
        <Suspense fallback={null}>
            <PogonInner />
        </Suspense>
    );
}
