import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { resolveGroupMids, type GroupTab } from "@/src/content/domFilter";
import { GroupFeed } from "@/src/content/GroupFeed";
import { LiveFeed } from "@/src/content/LiveFeed";
import { SettingsForm } from "@/src/content/SettingsForm";
import { sendRuntimeMessage, type Settings, type UiState } from "@/src/shared/messages";
import { formatCountdown } from "@/src/content/autoRefresh";
import { formatLogsForReport } from "@/src/storage/logFormat";
import type { GroupRecord, RunLogRecord, UpRecord } from "@/src/types/domain";

type SortKey = "manual" | "latest" | "stale" | "updates";

export default function App() {
  const [state, setState] = useState<UiState>({ ups: [], groups: [], meta: {} });
  const [activeTab, setActiveTab] = useState<GroupTab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("manual");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [logExported, setLogExported] = useState(false);
  const [autoSyncAttempted, setAutoSyncAttempted] = useState(false);
  const [syncIntervalMin, setSyncIntervalMin] = useState(60);
  const [showSettings, setShowSettings] = useState(false);
  const tabsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void refreshState();
  }, []);

  useEffect(() => {
    void sendRuntimeMessage<Settings>({ type: "settings:get" })
      .then((settings) => setSyncIntervalMin(settings.syncIntervalMinutes || 60))
      .catch(() => {});
  }, []);

  // Reflect background syncs when returning to the tab (refreshes last_sync_at, counts,
  // and the sync countdown below).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshState();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // Let a plain mouse wheel scroll the horizontally-overflowing tab strip. Without this
  // it's only reachable via a trackpad's horizontal swipe (no scrollbar is shown), so
  // mouse-only users (e.g. on Windows) can't reach tabs past the visible edge. Attached
  // with passive:false so preventDefault() actually suppresses the page from scrolling.
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return; // nothing to scroll
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return; // let real horizontal gestures pass through
      el.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (autoSyncAttempted || syncing || state.meta.last_sync_at || state.meta.sync_status === "running") return;
    setAutoSyncAttempted(true);
    void syncNow("首次同步");
  }, [autoSyncAttempted, state.meta.last_sync_at, state.meta.sync_status, syncing]);

  const groups = useMemo(() => sortGroups(state.groups, state.ups, sortKey), [state.groups, state.ups, sortKey]);
  const summary = useMemo(() => buildSummary(state.ups), [state.ups]);
  const groupMids = useMemo(() => resolveGroupMids(activeTab, state.ups), [activeTab, state.ups]);
  const savedError = typeof state.meta.last_sync_error === "string" ? state.meta.last_sync_error : "";
  const visibleError = error || savedError;
  const lastSyncAt = typeof state.meta.last_sync_at === "number" ? state.meta.last_sync_at : null;

  async function refreshState() {
    try {
      setState(await sendRuntimeMessage<UiState>({ type: "state:get" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function syncNow(label = "同步") {
    setSyncing(true);
    setError("");
    try {
      setState(await sendRuntimeMessage<UiState>({ type: "sync:m1" }));
    } catch (err) {
      setError(`${label}失败：${err instanceof Error ? err.message : String(err)}`);
      await refreshState();
    } finally {
      setSyncing(false);
    }
  }

  async function resetCache() {
    const ok = window.confirm(
      "确定清空所有动态缓存？\n\n下次进各个分组时会重新拉取（可能会等一两分钟）。本地的关注关系、分组、设置都不会动。"
    );
    if (!ok) return;
    try {
      setState(await sendRuntimeMessage<UiState>({ type: "cache:reset" }));
    } catch (err) {
      setError(`重置失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function copyDiagnostics() {
    const diagnostics = {
      time: new Date().toISOString(),
      extensionVersion: chrome.runtime.getManifest().version,
      page: location.href,
      userAgent: navigator.userAgent,
      error: visibleError || null,
      meta: state.meta,
      counts: {
        ups: state.ups.length,
        groups: state.groups.length,
        update24h: summary.update24h,
        updatedUps: summary.updatedUps
      }
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      setError(clipboardError(err));
    }
  }

  async function exportLogs() {
    try {
      const logs = await sendRuntimeMessage<RunLogRecord[]>({ type: "logs:get", limit: 500 });
      const report = [
        "# Bili Dynamic Groups 运行日志",
        `导出时间：${new Date().toLocaleString("zh-CN")}`,
        `扩展版本：${chrome.runtime.getManifest().version}`,
        `UA：${navigator.userAgent}`,
        `统计：关注 ${state.ups.length} · 分组 ${state.groups.length} · 24h 更新 ${summary.update24h}`,
        `最近同步：${state.meta.last_sync_at ? formatTime(Number(state.meta.last_sync_at)) : "—"} · 状态 ${String(state.meta.sync_status ?? "—")} · 错误 ${savedError || "无"}`,
        "",
        `## 日志（最近 ${logs.length} 条）`,
        formatLogsForReport(logs) || "（暂无日志）"
      ].join("\n");
      await navigator.clipboard.writeText(report);
      setLogExported(true);
      window.setTimeout(() => setLogExported(false), 1400);
    } catch (err) {
      setError(clipboardError(err));
    }
  }

  return (
    <section class="bdg-panel" aria-label="Bili Dynamic Groups">
      <div class="bdg-toolbar">
        <div class="bdg-tabs" role="tablist" ref={tabsRef}>
          <Tab active={activeTab === "all"} label="全部" count={state.ups.length} recent={summary.update24h} onClick={() => setActiveTab("all")} />
          <Tab
            active={activeTab === "live"}
            label="直播"
            count={0}
            recent={0}
            hideCount
            onClick={() => setActiveTab("live")}
          />
          <Tab
            active={activeTab === "ungrouped"}
            label="未分组"
            count={state.ups.filter((up) => up.tagIds.length === 0).length}
            recent={state.ups.filter((up) => up.tagIds.length === 0).reduce((sum, up) => sum + up.updateCount24h, 0)}
            onClick={() => setActiveTab("ungrouped")}
          />
          {state.ups.some(isQuietFollow) ? (
            <Tab
              active={activeTab === "quiet"}
              label="悄悄关注"
              count={state.ups.filter(isQuietFollow).length}
              recent={state.ups.filter(isQuietFollow).reduce((sum, up) => sum + up.updateCount24h, 0)}
              onClick={() => setActiveTab("quiet")}
            />
          ) : null}
          {groups.map((group) => (
            <Tab
              key={group.tagid}
              active={activeTab === group.tagid}
              label={group.name}
              count={group.count}
              recent={state.ups.filter((up) => up.tagIds.includes(group.tagid)).reduce((sum, up) => sum + up.updateCount24h, 0)}
              onClick={() => setActiveTab(group.tagid)}
            />
          ))}
        </div>
        <div class="bdg-actions">
          <select value={sortKey} onChange={(event) => setSortKey((event.currentTarget as HTMLSelectElement).value as SortKey)}>
            <option value="manual">原分组顺序</option>
            <option value="latest">最新更新</option>
            <option value="stale">最久未看</option>
            <option value="updates">24h 更新数</option>
          </select>
          <button type="button" class="bdg-sync" onClick={() => void syncNow()} disabled={syncing}>
            <SyncIcon />
            <span>{syncing ? "同步中" : "同步"}</span>
          </button>
          <button type="button" onClick={() => setShowSettings((open) => !open)} aria-expanded={showSettings}>
            {showSettings ? "收起设置" : "设置"}
          </button>
        </div>
      </div>
      {showSettings ? (
        <div class="bdg-settings">
          <SettingsForm onChange={(next) => setSyncIntervalMin(next.syncIntervalMinutes || 60)} />
        </div>
      ) : null}
      <div class="bdg-meta">
        <span>{summary.updatedUps} 位有更新</span>
        <span>过去 24 小时 {summary.update24h} 条更新</span>
        <SyncStatus
          lastSyncAt={lastSyncAt}
          intervalMs={Math.max(1, syncIntervalMin) * 60_000}
          syncing={syncing}
          syncStatusRunning={state.meta.sync_status === "running"}
          onDue={() => void syncNow("定时")}
        />
        <button type="button" class="bdg-meta-btn" onClick={resetCache} title="清空动态缓存，下次进分组会重新拉取">
          重置缓存
        </button>
        <button type="button" class="bdg-meta-btn" onClick={exportLogs} title="复制最近的运行日志，反馈问题时连同文字描述一起发出">
          {logExported ? "已复制日志" : "导出日志"}
        </button>
        {visibleError ? (
          <span class="bdg-error">
            <strong>{compactError(visibleError)}</strong>
            <button type="button" onClick={copyDiagnostics}>
              {copied ? "已复制" : "复制诊断"}
            </button>
          </span>
        ) : null}
      </div>
      {activeTab === "live" ? (
        <LiveFeed />
      ) : (
        <GroupFeed mids={groupMids} tabKey={String(activeTab)} typeFilter="excludeLive" />
      )}
    </section>
  );
}

function Tab(props: { active: boolean; label: string; count: number; recent: number; hideCount?: boolean; onClick: () => void }) {
  return (
    <button type="button" class={props.active ? "bdg-tab is-active" : "bdg-tab"} onClick={props.onClick}>
      <span>{props.label}</span>
      {!props.hideCount ? <small>{props.count}</small> : null}
      {props.recent > 0 ? <b>{props.recent}</b> : null}
    </button>
  );
}

function SyncIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 0 0-15.5-6.3L3 8" />
      <path d="M3 4v4h4" />
      <path d="M3 12a9 9 0 0 0 15.5 6.3L21 16" />
      <path d="M21 20v-4h-4" />
    </svg>
  );
}

// Shows "上次同步 X · 距下次 mm:ss" and drives a real sync when the schedule elapses while
// the dashboard is open. Owns its own 1s tick so only this node re-renders each second.
function SyncStatus({
  lastSyncAt,
  intervalMs,
  syncing,
  syncStatusRunning,
  onDue
}: {
  lastSyncAt: number | null;
  intervalMs: number;
  syncing: boolean;
  syncStatusRunning: boolean;
  onDue: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const firedForRef = useRef<number | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const nextAt = lastSyncAt ? lastSyncAt + intervalMs : null;
  const remaining = nextAt ? Math.max(0, Math.round((nextAt - now) / 1000)) : null;

  useEffect(() => {
    if (!nextAt || syncing || syncStatusRunning) return;
    if (document.visibilityState !== "visible") return;
    // Fire once per scheduled time; a successful sync advances lastSyncAt → nextAt, which
    // re-arms this. A failed sync leaves lastSyncAt unchanged, so it won't spin-retry.
    if (now >= nextAt && firedForRef.current !== nextAt) {
      firedForRef.current = nextAt;
      onDue();
    }
  }, [now, nextAt, syncing, syncStatusRunning, onDue]);

  if (syncing) return <span class="bdg-sync-status">正在同步…</span>;
  return (
    <span class="bdg-sync-status">
      {lastSyncAt ? <span>上次同步 {formatTime(lastSyncAt)}</span> : <span>尚未同步</span>}
      {remaining !== null ? <span> · 距下次同步 {formatCountdown(remaining)}</span> : null}
    </span>
  );
}

function isQuietFollow(up: UpRecord) {
  return up.tagNames.some((name) => name.includes("悄悄关注")) || up.tagIds.includes(-10);
}

function sortGroups(groups: GroupRecord[], ups: UpRecord[], sortKey: SortKey) {
  const metric = (group: GroupRecord) => ups.filter((up) => up.tagIds.includes(group.tagid));
  return [...groups].sort((a, b) => {
    const ma = metric(a);
    const mb = metric(b);
    const emptyA = ma.length === 0;
    const emptyB = mb.length === 0;
    if (emptyA !== emptyB) return emptyA ? 1 : -1;
    if (sortKey === "latest") return max(mb, "lastUpdateTs") - max(ma, "lastUpdateTs");
    if (sortKey === "stale") return min(ma, "lastViewedTs") - min(mb, "lastViewedTs");
    if (sortKey === "updates") return sum(mb, "updateCount24h") - sum(ma, "updateCount24h");
    return a.manualOrder - b.manualOrder;
  });
}

function buildSummary(ups: UpRecord[]) {
  return {
    update24h: sum(ups, "updateCount24h"),
    updatedUps: ups.filter((up) => up.updateCount24h > 0).length
  };
}

function sum<T extends Record<K, number>, K extends keyof T>(rows: T[], key: K) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function max<T extends Record<K, number>, K extends keyof T>(rows: T[], key: K) {
  return rows.reduce((value, row) => Math.max(value, Number(row[key] ?? 0)), 0);
}

function min<T extends Record<K, number>, K extends keyof T>(rows: T[], key: K) {
  const values = rows.map((row) => Number(row[key] ?? 0)).filter(Boolean);
  return values.length ? Math.min(...values) : 0;
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}

function compactError(message: string) {
  return message.length > 96 ? `${message.slice(0, 96)}...` : message;
}

function clipboardError(err: unknown): string {
  if (err instanceof Error && err.name === "NotAllowedError") {
    return "复制失败：浏览器拒绝了剪贴板访问，请在页面获得焦点时重试";
  }
  return `操作失败：${err instanceof Error ? err.message : String(err)}`;
}
