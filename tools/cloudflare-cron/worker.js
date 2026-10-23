// Sat za ERP asistenta: svake minute pozovi /api/assistant/tick na Vercelu.
// Sva logika (koji podsjetnik, kome, jutarnji pregled) je u aplikaciji —
// ovdje je samo okidač. Besplatni Cloudflare plan je dovoljan: čekanje na
// fetch ne ulazi u CPU limit od 10 ms.

export default {
    async scheduled(_event, env, ctx) {
        ctx.waitUntil(
            fetch(env.TICK_URL, {
                method: 'POST',
                headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
            }).then(async res => {
                if (!res.ok) console.log('tick', res.status, (await res.text()).slice(0, 300));
            }),
        );
    },

    // Ručna provjera u pregledniku: https://<worker>.workers.dev
    async fetch() {
        return new Response('ERP asistent — sat radi. Okidač: svake minute.', { status: 200 });
    },
};
