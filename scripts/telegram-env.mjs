// Zajedničko za Telegram skripte: čita .env.local (pa .env) bez dodatnih paketa.
// Vrijednosti iz okruženja imaju prednost nad fajlom.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv() {
    const env = {};
    for (const file of ['.env', '.env.local']) {
        const path = resolve(process.cwd(), file);
        if (!existsSync(path)) continue;
        for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (!m) continue;
            env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    }
    return { ...env, ...process.env };
}

export function requireVar(env, name) {
    const v = env[name]?.trim();
    if (!v) {
        console.error(`❌ Nedostaje ${name} (u .env.local ili okruženju).`);
        process.exit(1);
    }
    return v;
}

export async function tg(token, method, payload = {}) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`${method}: ${data.description}`);
    return data.result;
}
