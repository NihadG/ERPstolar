/**
 * @jest-environment node
 */
// TRIJAŽA ZADNJEG IZVOZA — bez modela i bez mreže, samo čita lokalni izvoz:
//
//   npm run bot:triage          (zadnji izvoz iz .bot-review/latest.txt)
//
// Piše <folder>/triage.md (lib/assistant/reviewReport.ts). Stvarne poruke
// ostaju u .bot-review/ (gitignore).

import fs from 'fs';
import path from 'path';
import { reviewReport, type ReviewEntry } from '@/lib/assistant/reviewReport';
import { reviewDir } from '@/lib/testing/reviewDir';

const DIR = reviewDir(process.env.BOT_REVIEW);
const run = DIR ? describe : describe.skip;

run('trijaža izvoza za reviziju', () => {
    it('triage.md', () => {
        const entries: ReviewEntry[] = JSON.parse(fs.readFileSync(path.join(DIR, 'entries.json'), 'utf8'));
        fs.writeFileSync(path.join(DIR, 'triage.md'), reviewReport(entries, path.basename(DIR)));
        console.log(`[revizija] ${entries.length} poruka → ${path.join(DIR, 'triage.md')}`);
    });
});
