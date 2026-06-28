import { RECENT_WINDOW_MS } from "@/src/shared/constants";
import type {
  DynamicRecord,
  QuadrantKey,
  QuadrantSnapshot,
  UpRecord,
  ViewLogRecord,
  ViewSource
} from "@/src/types/domain";

const VIEW_WEIGHTS: Record<ViewSource, number> = {
  dynamic: 1,
  space: 2,
  video: 3
};

export function calculateQuadrants(
  ups: UpRecord[],
  dynamics: DynamicRecord[],
  viewLogs: ViewLogRecord[],
  now = Date.now()
): QuadrantSnapshot {
  const since = now - RECENT_WINDOW_MS;
  const updateCounts = countByMid(dynamics.filter((dynamic) => dynamic.pubTs >= since).map((dynamic) => [dynamic.mid, 1]));
  const viewScores = countByMid(
    viewLogs
      .filter((log) => log.ts >= since)
      .map((log) => [log.mid, VIEW_WEIGHTS[log.source] ?? 1])
  );
  const viewMedian = median(ups.map((up) => viewScores.get(up.mid) ?? up.viewCount30d ?? 0));
  const updateMedian = median(ups.map((up) => updateCounts.get(up.mid) ?? up.postCount30d ?? 0));

  return {
    id: "latest",
    createdAt: now,
    viewMedian,
    updateMedian,
    items: ups.map((up) => {
      const viewScore = viewScores.get(up.mid) ?? up.viewCount30d ?? 0;
      const updateScore = updateCounts.get(up.mid) ?? up.postCount30d ?? 0;
      return {
        mid: up.mid,
        name: up.name,
        face: up.face,
        viewScore,
        updateScore,
        updateCount24h: up.updateCount24h,
        quadrant: resolveQuadrant(viewScore, updateScore, viewMedian, updateMedian)
      };
    })
  };
}

function resolveQuadrant(viewScore: number, updateScore: number, viewMedian: number, updateMedian: number): QuadrantKey {
  // Strictly greater than the median: a score equal to the median is not "frequent".
  // This matters most in the common all-zero case (nobody posted/was viewed → median 0),
  // where >= would wrongly mark everyone as frequent.
  const frequentView = viewScore > viewMedian;
  const frequentUpdate = updateScore > updateMedian;
  if (frequentView && frequentUpdate) return "frequent-view-frequent-update";
  if (frequentView) return "frequent-view-quiet-update";
  if (frequentUpdate) return "quiet-view-frequent-update";
  return "quiet-view-quiet-update";
}

function countByMid(rows: Array<[number, number]>) {
  const counts = new Map<number, number>();
  for (const [mid, value] of rows) {
    counts.set(mid, (counts.get(mid) ?? 0) + value);
  }
  return counts;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
