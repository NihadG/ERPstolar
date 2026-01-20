/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    webpack: (config, { isServer }) => {
        // Handle undici with externals for server
        if (isServer) {
            config.externals.push('undici');
        }
        return config;
    },
}

module.exports = nextConfig


