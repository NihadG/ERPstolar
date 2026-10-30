/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    experimental: {
        // PDF narudžbe za Telegram crta se na serveru fontom iz assets/fonts (čita se fs-om).
        outputFileTracingIncludes: {
            '/api/telegram/webhook': ['./assets/fonts/**/*'],
            // Dnevnik unapređenja bota (Postavke → Telegram) čita se fs-om.
            '/api/assistant/journal': ['./docs/bot/**/*'],
        },
    },
    webpack: (config, { isServer, dev }) => {
        // Handle undici with externals for server
        if (isServer) {
            config.externals.push('undici');
        }
        // Projekat je na OneDrive putanji — native fs.watch evente OneDrive-ov
        // sync driver često ne isporuči, pa se izmjene ne hot-reload-uju. Polling je pouzdan fallback.
        if (dev) {
            config.watchOptions = { poll: 800, aggregateTimeout: 300 };
        }
        return config;
    },
}

const withBundleAnalyzer = require('@next/bundle-analyzer')({
    enabled: process.env.ANALYZE === 'true',
})

module.exports = withBundleAnalyzer(nextConfig)


