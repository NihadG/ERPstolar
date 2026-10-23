// Lokalni razvoj bez tunela: čita poruke botu (getUpdates) i prosljeđuje ih
// lokalnom webhooku, isto kao što bi Telegram radio u produkciji.
//
//   npm run dev                         (u drugom terminalu)
//   node scripts/telegram-dev-poll.mjs  [http://localhost:3000]
//
// PAŽNJA: getUpdates radi samo bez webhooka, pa skripta BRIŠE produkcijski
// webhook. Kad završiš, ponovo pokreni scripts/telegram-set-webhook.mjs.

import { loadEnv, requireVar, tg } from './telegram-env.mjs';

const env = loadEnv();
const token = requireVar(env, 'TELEGRAM_BOT_TOKEN');
const secret = requireVar(env, 'TELEGRAM_WEBHOOK_SECRET');
const target = `${(process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '')}/api/telegram/webhook`;

await tg(token, 'deleteWebhook', { drop_pending_updates: false });
console.log(`🔁 Prosljeđujem poruke na ${target} (Ctrl+C za kraj)`);

// Lokalni „sat": isto što Cloudflare radi u produkciji — svake minute tick.
const cronSecret = env.CRON_SECRET?.trim();
if (cronSecret) {
    const tickUrl = target.replace('/api/telegram/webhook', '/api/assistant/tick');
    setInterval(async () => {
        try {
            const res = await fetch(tickUrl, { method: 'POST', headers: { Authorization: `Bearer ${cronSecret}` } });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.sent || body.digests) console.log(`⏰ tick ${res.status}`, JSON.stringify(body));
        } catch (e) {
            console.error('tick:', e.message);
        }
    }, 60_000);
}

let offset = 0;
for (;;) {
    let updates = [];
    try {
        updates = await tg(token, 'getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
    } catch (e) {
        console.error('getUpdates:', e.message);
        await new Promise(r => setTimeout(r, 3000));
        continue;
    }
    for (const u of updates) {
        offset = u.update_id + 1;
        const t0 = Date.now();
        try {
            const res = await fetch(target, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
                body: JSON.stringify(u),
            });
            const kind = u.callback_query ? `dugme ${u.callback_query.data}` : (u.message?.voice ? 'glas' : (u.message?.text || '').slice(0, 40));
            console.log(`${res.status} ${Date.now() - t0} ms  ${kind}`);
        } catch (e) {
            console.error('webhook:', e.message);
        }
    }
}
