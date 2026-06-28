import { db } from "@/src/storage/db";
import { BilibiliApiClient } from "@/src/bilibili/api";
import { suggestGroupForUp } from "@/src/ai/suggestGroups";
import { calculateQuadrants } from "@/src/analytics/quadrants";
import {
  DEFAULT_SETTINGS,
  type RuntimeRequest,
  type RuntimeResponse,
  type Settings
} from "@/src/shared/messages";
import { runM1Sync } from "@/src/sync/sync";
import type { DynamicRecord } from "@/src/types/domain";

const api = new BilibiliApiClient();

export default defineBackground(() => {
  // Register alarms on every service-worker cold start, not only on install:
  // onInstalled fires once, but the worker can be torn down and reloaded (browser
  // restart, manual reload, update) without it firing again. ensureAlarms() only
  // creates missing alarms, so it won't reset the schedule of existing ones.
  void ensureAlarms();
  chrome.runtime.onInstalled.addListener(() => {
    void ensureAlarms();
  });
  chrome.runtime.onStartup.addListener(() => {
    void ensureAlarms();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "bili-groups-sync") {
      void runM1Sync(api);
    }
    if (alarm.name === "bili-groups-quadrants") {
      void refreshQuadrants();
    }
    if (alarm.name === "bili-groups-space-sweep") {
      void runSpaceSweepBatch();
    }
  });

  chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
    handleMessage(message)
      .then((response) => sendResponse(response))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown extension error";
        sendResponse({ ok: false, error: message } satisfies RuntimeResponse);
      });
    return true;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "group-feed") return;
    let cancelled = false;
    port.onDisconnect.addListener(() => {
      cancelled = true;
    });
    port.onMessage.addListener((msg: { type: string; mids?: number[] }) => {
      if (msg.type !== "start" || !msg.mids) return;
      void runGroupFetch(port, msg.mids, () => cancelled);
    });
  });
});

const SPACE_STALE_MS = 30 * 60 * 1000;
const GROUP_FETCH_MAX = 50;

async function runGroupFetch(
  port: chrome.runtime.Port,
  mids: number[],
  isCancelled: () => boolean
) {
  const { stale, freshCount } = await planGroupFetch(mids);
  const targets = stale.slice(0, GROUP_FETCH_MAX);
  const total = targets.length;
  const skippedAfterCap = Math.max(0, stale.length - GROUP_FETCH_MAX);

  if (total === 0) {
    tryPostMessage(port, { type: "done", total: 0, fresh: freshCount, skipped: skippedAfterCap });
    return;
  }

  let completed = 0;
  for (const mid of targets) {
    if (isCancelled()) return;
    try {
      const items = await api.getSpaceDynamics(mid);
      await persistSpaceDynamics(mid, items);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      tryPostMessage(port, { type: "warn", mid, error: message });
    }
    completed += 1;
    if (
      !tryPostMessage(port, {
        type: "progress",
        completed,
        total,
        mid,
        fresh: freshCount,
        skipped: skippedAfterCap
      })
    )
      return;
  }
  tryPostMessage(port, { type: "done", total, fresh: freshCount, skipped: skippedAfterCap });
}

async function planGroupFetch(mids: number[]) {
  if (mids.length === 0) return { stale: [] as number[], freshCount: 0 };
  const ups = await db.ups.where("mid").anyOf(mids).toArray();
  const now = Date.now();
  const upByMid = new Map(ups.map((up) => [up.mid, up]));
  const stale: number[] = [];
  let freshCount = 0;
  for (const mid of mids) {
    const up = upByMid.get(mid);
    const last = up?.lastSpaceFetchAt ?? 0;
    if (now - last < SPACE_STALE_MS) {
      freshCount += 1;
    } else {
      stale.push(mid);
    }
  }
  stale.sort((a, b) => (upByMid.get(b)?.lastUpdateTs ?? 0) - (upByMid.get(a)?.lastUpdateTs ?? 0));
  return { stale, freshCount };
}

async function recomputeUpdateCount24hForMid(mid: number) {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const count = await db.dynamics
    .where("mid")
    .equals(mid)
    .filter((d) => d.pubTs >= since)
    .count();
  await db.ups.update(mid, { updateCount24h: count });
}

// Persist a single UP's freshly-fetched space dynamics atomically. Wrapping the
// bulkPut + count recompute + cursor update in one transaction makes this serialize
// against runM1Sync's transaction (which also locks ups+dynamics), so the two writers
// can't interleave and clobber each other's updateCount24h.
async function persistSpaceDynamics(mid: number, items: DynamicRecord[]) {
  await db.transaction("rw", db.dynamics, db.ups, async () => {
    if (items.length) {
      await db.dynamics.bulkPut(items);
      await recomputeUpdateCount24hForMid(mid);
    }
    await db.ups.update(mid, { lastSpaceFetchAt: Date.now() });
  });
}

function tryPostMessage(port: chrome.runtime.Port, message: unknown): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

async function handleMessage(message: RuntimeRequest): Promise<RuntimeResponse> {
  switch (message.type) {
    case "state:get":
      return { ok: true, data: await getUiState() };
    case "sync:m1":
      await runM1Sync(api);
      return { ok: true, data: await getUiState() };
    case "tracking:view":
      await db.viewLogs.add({ mid: message.mid, ts: Date.now(), source: message.source });
      await db.ups.update(message.mid, { lastViewedTs: Date.now() });
      return { ok: true };
    case "quadrants:get":
      return { ok: true, data: await getQuadrantState() };
    case "settings:get":
      return { ok: true, data: await getSettings() };
    case "settings:patch":
      await chrome.storage.sync.set({ settings: { ...(await getSettings()), ...message.patch } });
      return { ok: true, data: await getSettings() };
    case "ai:suggest":
      return { ok: true, data: await suggestGroupForUp(message.mid, api, await getSettings()) };
    case "feed:get":
      return {
        ok: true,
        data: await getFeedFor(message.mids, message.limit ?? 50, message.before, message.typeFilter)
      };
    case "live:get":
      return { ok: true, data: await api.getLiveFollowing() };
    case "dashboard:open":
      await openDashboardTab();
      return { ok: true };
    case "cache:reset":
      await resetDynamicsCache();
      return { ok: true, data: await getUiState() };
    default:
      return { ok: false, error: "Unsupported message type" };
  }
}

const SPACE_SWEEP_BATCH = 5;

async function runSpaceSweepBatch() {
  const ups = await db.ups.orderBy("mid").toArray();
  if (ups.length === 0) return;
  const cursorMeta = await db.syncMeta.get("space_sweep_cursor");
  // Cursor is the last mid swept, not an array index. ups come back ascending by mid,
  // so advancing by mid keeps the round-robin stable even when follows are added or
  // removed between sweeps (an index cursor would skip or repeat UPs after reordering).
  const lastMid = typeof cursorMeta?.value === "number" ? cursorMeta.value : 0;
  let batch = ups.filter((up) => up.mid > lastMid).slice(0, SPACE_SWEEP_BATCH);
  if (batch.length === 0) batch = ups.slice(0, SPACE_SWEEP_BATCH);
  for (const up of batch) {
    try {
      const items = await api.getSpaceDynamics(up.mid);
      await persistSpaceDynamics(up.mid, items);
    } catch {
      // single UP failure shouldn't abort the sweep
    }
  }
  const lastInBatch = batch[batch.length - 1];
  const nextCursor = lastInBatch ? lastInBatch.mid : 0;
  const now = Date.now();
  await db.syncMeta.put({ key: "space_sweep_cursor", value: nextCursor, updatedAt: now });
  await db.syncMeta.put({ key: "space_sweep_last_run", value: now, updatedAt: now });
}

async function openDashboardTab() {
  await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
}

async function resetDynamicsCache() {
  await db.transaction("rw", db.dynamics, db.ups, db.syncMeta, async () => {
    await db.dynamics.clear();
    const ups = await db.ups.toArray();
    await db.ups.bulkPut(
      ups.map((up) => ({ ...up, lastSpaceFetchAt: 0, updateCount24h: 0 }))
    );
    await db.syncMeta.put({ key: "space_sweep_cursor", value: 0, updatedAt: Date.now() });
    await db.syncMeta.put({ key: "cache_reset_at", value: Date.now(), updatedAt: Date.now() });
  });
}

async function getFeedFor(
  mids: number[],
  limit: number,
  before?: number,
  typeFilter?: "liveOnly" | "excludeLive"
) {
  if (mids.length === 0) return [];
  const dynamics = await db.dynamics.where("mid").anyOf(mids).toArray();
  let filtered = before === undefined ? dynamics : dynamics.filter((d) => d.pubTs < before);
  if (typeFilter === "liveOnly") {
    filtered = filtered.filter((d) => d.type === "live");
  } else if (typeFilter === "excludeLive") {
    filtered = filtered.filter((d) => d.type !== "live");
  }
  filtered.sort((a, b) => liveScore(b) - liveScore(a) || b.pubTs - a.pubTs);
  return filtered.slice(0, limit);
}

function liveScore(d: { type: string; extra?: { liveStatus?: number } }) {
  if (d.type !== "live") return 0;
  return d.extra?.liveStatus === 1 ? 2 : 1;
}

async function getUiState() {
  const [ups, groups, metaRows] = await Promise.all([
    db.ups.orderBy("name").toArray(),
    db.groups.orderBy("manualOrder").toArray(),
    db.syncMeta.toArray()
  ]);
  const meta = Object.fromEntries(metaRows.map((row) => [row.key, row.value]));
  return { ups, groups, meta };
}

async function refreshQuadrants() {
  const [ups, dynamics, viewLogs] = await Promise.all([
    db.ups.toArray(),
    db.dynamics.toArray(),
    db.viewLogs.toArray()
  ]);
  const snapshot = calculateQuadrants(ups, dynamics, viewLogs);
  await db.quadrantSnapshots.put(snapshot);
}

async function getQuadrantState() {
  const existing = await db.quadrantSnapshots.orderBy("createdAt").last();
  if (existing) return existing;
  await refreshQuadrants();
  return db.quadrantSnapshots.orderBy("createdAt").last();
}

async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.sync.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

async function ensureAlarms() {
  const existing = await chrome.alarms.getAll();
  const names = new Set(existing.map((alarm) => alarm.name));
  if (!names.has("bili-groups-sync")) chrome.alarms.create("bili-groups-sync", { periodInMinutes: 60 });
  if (!names.has("bili-groups-quadrants")) chrome.alarms.create("bili-groups-quadrants", { periodInMinutes: 24 * 60 });
  if (!names.has("bili-groups-space-sweep")) chrome.alarms.create("bili-groups-space-sweep", { periodInMinutes: 10 });
}
