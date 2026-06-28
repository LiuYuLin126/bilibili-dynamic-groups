import type { RunLogRecord } from "@/src/types/domain";

/**
 * Render run-log records as a plain-text block suitable for pasting into a bug report.
 * Pure (no DB / DOM), so the dashboard can use it without bundling Dexie and it stays
 * unit-testable. Records are expected newest-first; output is rendered oldest-first so it
 * reads like a chronological log.
 */
export function formatLogsForReport(logs: RunLogRecord[]): string {
  return [...logs]
    .sort((a, b) => a.ts - b.ts)
    .map((log) => {
      const time = formatTimestamp(log.ts);
      const head = `[${time}] ${log.level.toUpperCase()} ${log.event}: ${log.message}`;
      return log.detail ? `${head} | ${log.detail}` : head;
    })
    .join("\n");
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
