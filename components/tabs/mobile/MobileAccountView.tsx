'use client';

// ════════════════════════════════════════════════════════════════════
// JA — mobilni ekran naloga (glavna/staff aplikacija)
//
// Na telefonu se sidebar NE renderuje, pa je ovo jedini put do identiteta,
// postavki i ODJAVE. Namjerno tanak: ko sam, koja firma/uloga, prečac na
// postavke i „Odjavi se". Desktop i dalje sve to ima u sidebaru.
// ════════════════════════════════════════════════════════════════════

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ROLE_LABELS } from '@/lib/types';
import { MLarge, MSection, MList, MItem, MCell, MText, MValue, MButton, MAvatar } from './MobileUI';
import './MobileUI.css';

export default function MobileAccountView() {
    const router = useRouter();
    const { user, organization, signOut } = useAuth();

    const initials = (user?.Name || '?').split(' ').map(n => n[0] || '').join('').toUpperCase().slice(0, 2) || '?';
    const isSuperAdmin = user?.Is_Super_Admin === true;

    async function handleLogout() {
        await signOut();
        router.push('/login');
    }

    return (
        <div className="mui">
            <MLarge title="Ja">{organization?.Name}</MLarge>

            <MList lead>
                <MItem>
                    <MCell>
                        <MAvatar tone="blue">{initials}</MAvatar>
                        <MText title={user?.Name || '—'} sub={user?.Email} />
                    </MCell>
                </MItem>
            </MList>

            <MSection title="Nalog" />
            <MList>
                <MItem><MCell><MText title="Uloga" /><MValue num={false}>{user ? ROLE_LABELS[user.Role] : '—'}</MValue></MCell></MItem>
                <MItem><MCell><MText title="Firma" /><MValue num={false}>{organization?.Name || '—'}</MValue></MCell></MItem>
            </MList>

            <MSection title="Postavke" />
            <MList>
                <MItem><MCell onClick={() => router.push('/settings')} chevron><MText title="Postavke naloga" /></MCell></MItem>
                {isSuperAdmin && (
                    <MItem><MCell onClick={() => router.push('/admin')} chevron><MText title="Admin panel" /></MCell></MItem>
                )}
            </MList>

            <div style={{ padding: '26px 0 8px' }}>
                <MButton variant="danger" onClick={() => { void handleLogout(); }}>
                    <LogOut size={18} /> Odjavi se
                </MButton>
            </div>
        </div>
    );
}
