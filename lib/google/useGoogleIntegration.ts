'use client';

import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';

/**
 * Objedinjeno stanje Google integracije za UI (gating + postavke).
 *   moduleActive  — plaćeni paket „google_integration" aktivan
 *   connected     — povezan Google račun (org_settings.googleIntegration)
 *   driveReady    — spremno za Drive akcije (modul + veza + root folder)
 *   calendarReady — spremno za Calendar akcije (modul + veza)
 * autoCreateFolders/autoCalendarTasks su default TRUE kad nisu eksplicitno isključeni.
 */
export function useGoogleIntegration() {
    const { hasModule } = useAuth();
    const { googleIntegration } = useData();

    const moduleActive = hasModule('google_integration');
    const gi = googleIntegration || {};

    const connected = !!gi.connectedEmail;
    const rootFolderId = gi.rootFolderID || '';
    const calendarId = gi.calendarID || 'primary';

    return {
        moduleActive,
        connected,
        connectedEmail: gi.connectedEmail,
        rootFolderId,
        rootFolderUrl: gi.rootFolderURL,
        calendarId,
        autoCreateFolders: gi.autoCreateProjectFolders !== false,
        autoCalendarTasks: gi.autoCalendarTasks !== false,
        driveReady: moduleActive && connected && !!rootFolderId,
        calendarReady: moduleActive && connected,
    };
}
