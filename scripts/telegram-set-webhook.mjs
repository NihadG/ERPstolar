// Poveži Telegram bota s produkcijom (pokreni jednom, i nakon promjene domena).
//
//   node scripts/telegram-set-webhook.mjs https://tvoj-domen.vercel.app
//
// Treba TELEGRAM_BOT_TOKEN i TELEGRAM_WEBHOOK_SECRET (iste vrijednosti kao na Vercelu).

import { loadEnv, requireVar, tg } from './telegram-env.mjs';

const env = loadEnv();
const token = requireVar(env, 'TELEGRAM_BOT_TOKEN');
const secret = requireVar(env, 'TELEGRAM_WEBHOOK_SECRET');
const base = (process.argv[2] || '').replace(/\/+$/, '');

if (!/^https:\/\//.test(base)) {
    console.error('Upotreba: node scripts/telegram-set-webhook.mjs https://tvoj-domen.vercel.app');
    process.exit(1);
}

const url = `${base}/api/telegram/webhook`;
await tg(token, 'setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
});
await tg(token, 'setMyCommands', {
    commands: [
        { command: 'danas', description: 'Podsjetnici i zadaci za danas' },
        { command: 'otvoreno', description: 'Bilježnica — otvorene stavke' },
        { command: 'pomoc', description: 'Šta sve mogu' },
    ],
});
const me = await tg(token, 'getMe');
const info = await tg(token, 'getWebhookInfo');
console.log(`✅ @${me.username} → ${info.url}`);
if (info.last_error_message) console.log(`   zadnja greška: ${info.last_error_message}`);
