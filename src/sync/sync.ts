import { db } from "@/src/storage/db";
import { SYNC_PAGE_SIZE } from "@/src/shared/constants";
import type { BilibiliApiClient } from "@/src/bilibili/api";
import type { DynamicRecord, GroupRecord, UpRecord } from "@/src/types/domain";

export async function runM1Sync(api: BilibiliApiClient) {
  const startedAt = Date.now();
  await putMeta("sync_status", "running");

  try {
    const mid = await api.getCurrentUserMid();
    const groups = await api.getGroups();
    const followings = await fetchAllFollowings(api, mid);
    const groupMembership = await fetchGroupMembership(api, groups);
    const dynamics = await fetchRecentDynamics(api);

    await db.transaction("rw", db.ups, db.groups, db.dynamics, db.syncMeta, async () => {
      await db.groups.bulkPut(groups);
      await mergeUps(followings, groupMembership, groups, dynamics);
      await mergeDynamics(dynamics);
      await recomputeUpdateCount24h();
      await putMeta("last_sync_at", startedAt);
      await putMeta("sync_status", "idle");
      await putMeta("last_sync_error", "");
      await putMeta("current_mid", mid);
    });
  } catch (error) {
    await putMeta("sync_status", "failed");
    await putMeta("last_sync_error", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function fetchAllFollowings(api: BilibiliApiClient, mid: number) {
  const firstPage = await api.getFollowings(mid, 1, SYNC_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(firstPage.total / SYNC_PAGE_SIZE));
  const all = [...firstPage.ups];
  for (let page = 2; page <= pages; page += 1) {
    const nextPage = await api.getFollowings(mid, page, SYNC_PAGE_SIZE);
    all.push(...nextPage.ups);
  }
  return all;
}

async function fetchGroupMembership(api: BilibiliApiClient, groups: GroupRecord[]) {
  const entries: Array<[number, number[]]> = [];
  for (const group of groups) {
    try {
      entries.push([group.tagid, await api.getTagMembers(group.tagid)]);
    } catch (error) {
      await putMeta(
        `group_sync_warning_${group.tagid}`,
        error instanceof Error ? error.message : String(error)
      );
      entries.push([group.tagid, []]);
    }
  }
  return new Map(entries);
}

async function fetchRecentDynamics(api: BilibiliApiClient) {
  const collected: DynamicRecord[] = [];
  let offset: string | undefined;
  for (let page = 0; page < 3; page += 1) {
    const feed = await api.getFeedAll(offset);
    collected.push(...feed.dynamics);
    if (!feed.hasMore || !feed.nextOffset) break;
    offset = feed.nextOffset;
  }
  return collected;
}

async function mergeUps(
  followings: UpRecord[],
  membership: Map<number, number[]>,
  groups: GroupRecord[],
  dynamics: DynamicRecord[]
) {
  const groupById = new Map(groups.map((group) => [group.tagid, group]));
  const dynamicStats = new Map<number, { lastUpdateTs: number; postCount30d: number }>();
  const windowStart = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const existingUps = new Map((await db.ups.toArray()).map((up) => [up.mid, up]));

  for (const dynamic of dynamics) {
    const stats = dynamicStats.get(dynamic.mid) ?? { lastUpdateTs: 0, postCount30d: 0 };
    stats.lastUpdateTs = Math.max(stats.lastUpdateTs, dynamic.pubTs);
    if (dynamic.pubTs >= windowStart) stats.postCount30d += 1;
    dynamicStats.set(dynamic.mid, stats);
  }

  const merged = followings.map((up) => {
    const existing = existingUps.get(up.mid);
    const tagIds = groups
      .filter((group) => membership.get(group.tagid)?.includes(up.mid))
      .map((group) => group.tagid);
    const tagNames = tagIds.map((tagid) => groupById.get(tagid)?.name).filter((name): name is string => Boolean(name));
    const stats = dynamicStats.get(up.mid);
    return {
      ...existing,
      ...up,
      tagIds,
      tagNames,
      lastViewedTs: existing?.lastViewedTs ?? 0,
      lastUpdateTs: Math.max(existing?.lastUpdateTs ?? 0, stats?.lastUpdateTs ?? 0),
      viewCount7d: existing?.viewCount7d ?? 0,
      viewCount30d: existing?.viewCount30d ?? 0,
      postCount30d: stats?.postCount30d ?? existing?.postCount30d ?? 0,
      updateCount24h: existing?.updateCount24h ?? 0,
      updatedAt: Date.now()
    } satisfies UpRecord;
  });

  if (merged.length) await db.ups.bulkPut(merged);
}

async function mergeDynamics(dynamics: DynamicRecord[]) {
  if (dynamics.length) await db.dynamics.bulkPut(dynamics);
}

async function recomputeUpdateCount24h() {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = await db.dynamics.where("pubTs").aboveOrEqual(since).toArray();
  const counts = new Map<number, number>();
  for (const dynamic of recent) {
    counts.set(dynamic.mid, (counts.get(dynamic.mid) ?? 0) + 1);
  }
  const ups = await db.ups.toArray();
  await db.ups.bulkPut(
    ups.map((up) => ({ ...up, updateCount24h: counts.get(up.mid) ?? 0 }))
  );
}

async function putMeta(key: string, value: unknown) {
  await db.syncMeta.put({ key, value, updatedAt: Date.now() });
}
