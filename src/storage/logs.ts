import { db } from "@/src/storage/db";
import type { LogLevel, RunLogRecord } from "@/src/types/domain";

const LOG_RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // keep ~2 weeks of history
const LOG_MAX_ROWS = 5000; // hard cap so a noisy period can't grow the table without bound
const DETAIL_MAX_CHARS = 2000;

/**
 * Append one diagnostic entry. Logging must never break a caller, so all failures
 * (serialization, DB write) are swallowed.
 */
export async function logEvent(level: LogLevel, event: string, message: string, detail?: unknown): Promise<void> {
  const record: RunLogRecord = { ts: Date.now(), level, event, message };
  if (detail !== undefined) {
    const text = typeof detail === "string" ? detail : safeStringify(detail);
    if (text) record.detail = text.length > DETAIL_MAX_CHARS ? text.slice(0, DETAIL_MAX_CHARS) : text;
  }
  try {
    await db.logs.add(record);
  } catch (error) {
    // Never throw out of logging, but surface the failure so a broken log table
    // (e.g. a failed migration) is at least debuggable from the console.
    console.error("[bili-dynamic-groups] logEvent failed", error);
  }
}

/** Newest-first, for export and (future) in-app viewing. */
export async function getRecentLogs(limit = 500): Promise<RunLogRecord[]> {
  return db.logs.orderBy("ts").reverse().limit(limit).toArray();
}

/** Drop entries past the retention window, then enforce the hard row cap (oldest first).
 *  Wrapped in a transaction so a concurrent logEvent() can't slip a write between the
 *  count and the cap-delete and push the table over the cap. */
export async function pruneLogs(now = Date.now()): Promise<void> {
  await db.transaction("rw", db.logs, async () => {
    await db.logs.where("ts").below(now - LOG_RETENTION_MS).delete();
    const count = await db.logs.count();
    if (count > LOG_MAX_ROWS) {
      const excessKeys = await db.logs.orderBy("ts").limit(count - LOG_MAX_ROWS).primaryKeys();
      if (excessKeys.length) await db.logs.bulkDelete(excessKeys);
    }
  });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
