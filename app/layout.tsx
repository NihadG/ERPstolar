import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/context/AuthContext'
import { DataProvider } from '@/context/DataContext'
import ErrorBoundary from '@/components/ui/ErrorBoundary'

const inter = Inter({ subsets: ['latin'] })

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
                <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Round" rel="stylesheet" />
            </head>
            <body className={inter.className}>
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


