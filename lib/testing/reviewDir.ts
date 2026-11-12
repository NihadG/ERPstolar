// Folder lokalnog izvoza za reviziju bota (scripts/bot-review/export.cjs):
// „latest" → .bot-review/latest.txt; „skup" → stalni skup za ponavljanje
// (.bot-review/stalni-skup); inače putanja kakva jeste; prazno = test se preskače.

import fs from 'fs';
import path from 'path';

export const SKUP_DIR = path.join('.bot-review', 'stalni-skup');

export function reviewDir(value: string | undefined): string {
    if (!value) return '';
    if (value === 'skup') return path.join(process.cwd(), SKUP_DIR);
    if (value !== 'latest') return value;
    const pointer = path.join(process.cwd(), '.bot-review', 'latest.txt');
    return fs.existsSync(pointer) ? fs.readFileSync(pointer, 'utf8').trim() : '';
}
