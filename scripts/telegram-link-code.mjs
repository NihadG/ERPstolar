// Jednokratni link za povezivanje Telegrama s ERP nalogom — bez otvaranja
// aplikacije (isto što radi Postavke → Telegram asistent → Poveži).
//
//   node scripts/telegram-link-code.mjs korisnik@email.com
//
// Treba FIREBASE_ADMIN_* i TELEGRAM_BOT_TOKEN u .env.local. Kod vrijedi 30 min.

import { randomInt } from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { loadEnv, requireVar, tg } from './telegram-env.mjs';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email.includes('@')) {
    console.error('Upotreba: node scripts/telegram-link-code.mjs korisnik@email.com');
    process.exit(1);
}

const env = loadEnv();
const app = initializeApp({
    credential: cert({
        projectId: requireVar(env, 'FIREBASE_ADMIN_PROJECT_ID'),
        clientEmail: requireVar(env, 'FIREBASE_ADMIN_CLIENT_EMAIL'),
        privateKey: requireVar(env, 'FIREBASE_ADMIN_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
});

const user = await getAuth(app).getUserByEmail(email);
const profile = (await getFirestore(app).collection('users').doc(user.uid).get()).data();
const orgId = user.customClaims?.orgId || profile?.Organization_ID;
if (!orgId) {
    console.error(`❌ ${email} nema organizaciju (ni claim ni users/{uid}).`);
    process.exit(1);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
await getFirestore(app).collection('assistant_link_codes').doc(code).set({
    uid: user.uid,
    orgId,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
});

const me = await tg(requireVar(env, 'TELEGRAM_BOT_TOKEN'), 'getMe');
console.log(`✅ Kod ${code} za ${email} (vrijedi 30 min)`);
console.log(`   https://t.me/${me.username}?start=${code}`);
