// ════════════════════════════════════════════════════════════════════
// TABELA U TELEGRAM — PDF koji je složio ERP (make_table) ide u chat
// ════════════════════════════════════════════════════════════════════

import { buildTablePdf } from '@/lib/server/tablePdf';
import { sendDocument } from '@/lib/telegram/api';
import type { TableDoc } from '@/lib/tables/table';
import { toZoned } from './datetime';
import { companyOf } from './orderDocuments';

export async function sendTablePdf(chatId: number | string, orgId: string, table: TableDoc, tz: string, now = new Date()): Promise<void> {
    const day = toZoned(now.toISOString(), tz).date;
    const pdf = buildTablePdf(table, await companyOf(orgId), `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}.`);
    await sendDocument(chatId, { buffer: pdf, filename: table.fileName }, `${table.title} · ${table.subtitle}`);
}
