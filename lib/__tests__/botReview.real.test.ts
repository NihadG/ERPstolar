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
import { reviewReport, slotReview, type ReviewEntry, type ReviewSlot } from '@/lib/assistant/reviewReport';
import { reviewDir } from '@/lib/testing/reviewDir';

const DIR = reviewDir(process.env.BOT_REVIEW);
const run = DIR ? describe : describe.skip;

run('trijaža izvoza za reviziju', () => {
    it('triage.md', () => {
        const entries: ReviewEntry[] = JSON.parse(fs.readFileSync(path.join(DIR, 'entries.json'), 'utf8'));
        // Termini su u izvozu od 12.11.; stariji izvozi ih nemaju.
        const slotsFile = path.join(DIR, 'slots.json');
        const slots: ReviewSlot[] = fs.existsSync(slotsFile) ? JSON.parse(fs.readFileSync(slotsFile, 'utf8')) : [];
        const report = [reviewReport(entries, path.basename(DIR)), slotReview(slots)].filter(Boolean).join('\n\n');
        fs.writeFileSync(path.join(DIR, 'triage.md'), report);
        console.log(`[revizija] ${entries.length} poruka → ${path.join(DIR, 'triage.md')}`);
    });
});
