import { describe, expect, it } from "vitest";
import { calculateQuadrants } from "@/src/analytics/quadrants";
import type { DynamicRecord, UpRecord, ViewLogRecord } from "@/src/types/domain";

const baseUp = (mid: number): UpRecord => ({
  mid,
  name: `up-${mid}`,
  face: "",
  sign: "",
  tagIds: [],
  tagNames: [],
  lastUpdateTs: 0,
  lastViewedTs: 0,
  viewCount7d: 0,
  viewCount30d: 0,
  postCount30d: 0,
  updateCount24h: 0,
  updatedAt: 0
});

describe("calculateQuadrants", () => {
  it("classifies UPs by recent view and update medians", () => {
    const now = 1_700_000_000_000;
    const ups = [baseUp(1), baseUp(2), baseUp(3), baseUp(4)];
    const dynamics: DynamicRecord[] = [
      { dynamicId: "a", mid: 1, type: "video", pubTs: now, summary: "" },
      { dynamicId: "b", mid: 1, type: "video", pubTs: now, summary: "" },
      { dynamicId: "c", mid: 3, type: "video", pubTs: now, summary: "" }
    ];
    const viewLogs: ViewLogRecord[] = [
      { mid: 1, ts: now, source: "video" },
      { mid: 2, ts: now, source: "space" },
      { mid: 2, ts: now, source: "dynamic" }
    ];

    const snapshot = calculateQuadrants(ups, dynamics, viewLogs, now);
    expect(snapshot.items.find((item) => item.mid === 1)?.quadrant).toBe("frequent-view-frequent-update");
    expect(snapshot.items.find((item) => item.mid === 2)?.quadrant).toBe("frequent-view-quiet-update");
    expect(snapshot.items.find((item) => item.mid === 3)?.quadrant).toBe("quiet-view-frequent-update");
    expect(snapshot.items.find((item) => item.mid === 4)?.quadrant).toBe("quiet-view-quiet-update");
  });

  it("treats scores equal to the median as quiet (uses > not >=)", () => {
    const now = 1_700_000_000_000;
    // No dynamics and no views → every view/update score is 0, so both medians are 0.
    // With a >= boundary every UP would be misclassified as frequent on both axes.
    const ups = [baseUp(1), baseUp(2), baseUp(3)];
    const snapshot = calculateQuadrants(ups, [], [], now);
    expect(snapshot.viewMedian).toBe(0);
    expect(snapshot.updateMedian).toBe(0);
    for (const item of snapshot.items) {
      expect(item.quadrant).toBe("quiet-view-quiet-update");
    }
  });
});
