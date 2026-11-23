import type { Tx } from './db';

/** Gap-free, concurrency-safe document numbers: e.g. MB-0001, WO-0003. Must run inside the business transaction. */
export async function nextNo(tx: Tx, projectId: string, series: string, pad = 4): Promise<string> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    INSERT INTO "DocSequence" ("projectId", series, next) VALUES (${projectId}, ${series}, 2)
    ON CONFLICT ("projectId", series) DO UPDATE SET next = "DocSequence".next + 1
    RETURNING next - 1 AS n`;
  return `${series}-${String(rows[0].n).padStart(pad, '0')}`;
}
