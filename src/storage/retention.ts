/**
 * Hybrid dynamics retention: keep everything newer than `cutoff`, and additionally keep
 * each UP's `keepPerUp` most-recent dynamics even when they're older than the cutoff.
 *
 * The second clause is what protects the extension's whole point — surfacing UPs who post
 * rarely. A pure time window would silently erase a quiet UP's only recent post once it
 * aged past the window. Returns the dynamicIds that are safe to delete.
 */
export function selectStaleDynamicIds<T extends { dynamicId: string; mid: number; pubTs: number }>(
  dynamics: T[],
  cutoff: number,
  keepPerUp: number
): string[] {
  const recentCount = new Map<number, number>();
  const staleByMid = new Map<number, T[]>();
  for (const dynamic of dynamics) {
    if (dynamic.pubTs >= cutoff) {
      recentCount.set(dynamic.mid, (recentCount.get(dynamic.mid) ?? 0) + 1);
    } else {
      const list = staleByMid.get(dynamic.mid) ?? [];
      list.push(dynamic);
      staleByMid.set(dynamic.mid, list);
    }
  }

  const toDelete: string[] = [];
  for (const [mid, records] of staleByMid) {
    // How many older records this UP is still allowed once the in-window ones are counted.
    const keep = Math.max(0, keepPerUp - (recentCount.get(mid) ?? 0));
    if (keep >= records.length) continue; // quiet UP — keep all of its (few) older posts
    records.sort((a, b) => b.pubTs - a.pubTs); // newest first
    for (const record of records.slice(keep)) toDelete.push(record.dynamicId);
  }
  return toDelete;
}
