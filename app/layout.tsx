import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import localFont from 'next/font/local'
import './globals.css'
import { AuthProvider } from '@/context/AuthContext'
import { DataProvider } from '@/context/DataContext'
import ErrorBoundary from '@/components/ui/ErrorBoundary'

const inter = Inter({ subsets: ['latin'] })

// Material Icons se self-hostuje umjesto <link> ka fonts.googleapis.com — vanjski
// stylesheet je blokirao prvi paint dok Google CDN ne odgovori (dva round-tripa:
// fonts.googleapis.com za CSS + fonts.gstatic.com za sam font).
// display:'block' a NE 'swap': sa swap-om bi se nakratko prikazale sirove ligature
// ("arrow_back", "business") umjesto ikona dok se font ne učita.
//
// adjustFontFallback:false — next/font inače sam napravi rezervni font iz
// local("Arial") sa size-adjust:219%. Za tekstualni font to je dobro (manje
// pomjeranja rasporeda), ali za IKONE je štetno: kad font ne stigne, taj
// rezervni ispiše imena ligatura ("receipt_long") i to uvećano 2.2×. Bez njega
// eventualni ispad ostane u normalnoj veličini umjesto da razbije raspored.
const materialIcons = localFont({
    src: './fonts/material-icons-round.woff2',
    variable: '--font-material-icons',
    display: 'block',
    weight: 'normal',
    style: 'normal',
    adjustFontFallback: false,
})

export const metadata: Metadata = {
    title: 'Furniture Production Tracker',
    description: 'ERP aplikacija za praćenje proizvodnje namještaja',
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="hr">
            <head>
                {/* PWA Meta Tags */}
                <link rel="manifest" href="/manifest.json" />
                <meta name="theme-color" content="#1D3557" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="default" />
                <meta name="apple-mobile-web-app-title" content="ERP Stolar" />
                <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
                {/* Bez eksplicitnog rel="icon" browser traži /favicon.ico, kojeg nema —
                    otud stalni 404 u konzoli. Koristi se postojeća PWA ikona. */}
                <link rel="icon" type="image/svg+xml" href="/icons/icon.svg" />
                <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192x192.png" />
                <meta name="mobile-web-app-capable" content="yes" />
                <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
            </head>
            <body className={`${inter.className} ${materialIcons.variable}`}>
                <ErrorBoundary>
                    <AuthProvider>
                        <DataProvider>
                            {children}
                        </DataProvider>
                    </AuthProvider>
                </ErrorBoundary>
            </body>
        </html>
    )
}


