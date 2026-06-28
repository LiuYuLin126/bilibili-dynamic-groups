import { describe, expect, it } from "vitest";
import { formatLogsForReport } from "@/src/storage/logFormat";
import type { RunLogRecord } from "@/src/types/domain";

describe("formatLogsForReport", () => {
  it("renders oldest-first with level/event/message and optional detail", () => {
    const logs: RunLogRecord[] = [
      { id: 2, ts: 2000, level: "error", event: "sync", message: "失败", detail: "code -352" },
      { id: 1, ts: 1000, level: "info", event: "heartbeat", message: "快照" }
    ];
    const lines = formatLogsForReport(logs).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("INFO heartbeat: 快照"); // oldest first
    expect(lines[1]).toContain("ERROR sync: 失败");
    expect(lines[1]).toContain("| code -352");
  });

  it("returns an empty string when there are no logs", () => {
    expect(formatLogsForReport([])).toBe("");
  });
});
