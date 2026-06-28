import { useEffect, useRef, useState } from "preact/hooks";
import { DynamicCard } from "@/src/content/cards";
import { useAutoRefresh } from "@/src/content/autoRefresh";
import { sendRuntimeMessage } from "@/src/shared/messages";
import type { DynamicRecord } from "@/src/types/domain";

const FEED_PAGE_SIZE = 50;
const LOCAL_REFRESH_MS = 60_000; // cheap re-read of the local DB
const BACKFILL_REFRESH_MS = 5 * 60_000; // sparser, throttled network backfill of stale UPs

interface FetchProgress {
  completed: number;
  total: number;
  fresh: number;
  skipped: number;
}

type TypeFilter = "liveOnly" | "excludeLive";

export function GroupFeed({
  mids,
  tabKey,
  typeFilter
}: {
  mids: number[];
  tabKey: string;
  typeFilter?: TypeFilter;
}) {
  const [items, setItems] = useState<DynamicRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const itemsRef = useRef<DynamicRecord[]>([]);
  itemsRef.current = items;
  const itemCountRef = useRef(0);
  itemCountRef.current = items.length;
  const pendingRef = useRef<DynamicRecord[] | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const softRefreshRef = useRef<() => void>(() => {});

  const buildRequest = (extras: { limit: number; before?: number }) => {
    const payload: { type: "feed:get"; mids: number[]; limit: number; before?: number; typeFilter?: TypeFilter } = {
      type: "feed:get",
      mids,
      limit: extras.limit
    };
    if (extras.before !== undefined) payload.before = extras.before;
    if (typeFilter) payload.typeFilter = typeFilter;
    return payload;
  };

  // Apply a freshly-read page without yanking the reader: if new items appeared while
  // they're scrolled down, stash them and surface a pill instead of replacing the list
  // under them. Near the top (or first load) we just apply directly.
  const applyFresh = (fresh: DynamicRecord[], limit: number) => {
    const prev = itemsRef.current;
    const prevIds = new Set(prev.map((d) => d.dynamicId));
    const newOnes = fresh.filter((d) => !prevIds.has(d.dynamicId));
    const nearTop = window.scrollY < 200;
    if (prev.length === 0 || newOnes.length === 0 || nearTop) {
      setItems(fresh);
      setHasMore(fresh.length === limit);
      pendingRef.current = null;
      setPendingCount(0);
    } else {
      pendingRef.current = fresh;
      setPendingCount(newOnes.length);
    }
  };

  const softRefresh = () => {
    if (mids.length === 0) return;
    const limit = Math.max(FEED_PAGE_SIZE, itemCountRef.current);
    void sendRuntimeMessage<DynamicRecord[]>(buildRequest({ limit }))
      .then((fresh) => applyFresh(fresh, limit))
      .catch(() => {
        /* a failed soft refresh is non-fatal; keep showing the current list */
      });
  };
  softRefreshRef.current = softRefresh;

  const applyPending = () => {
    if (pendingRef.current) {
      setItems(pendingRef.current);
      pendingRef.current = null;
    }
    setPendingCount(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    if (mids.length === 0) {
      setItems([]);
      setLoading(false);
      setHasMore(false);
      setError("");
      setProgress(null);
      pendingRef.current = null;
      setPendingCount(0);
      return;
    }
    setLoading(true);
    setError("");
    setHasMore(true);
    setPendingCount(0);
    pendingRef.current = null;
    setProgress({ completed: 0, total: 0, fresh: 0, skipped: 0 });

    // Guard against out-of-order responses: switching tabs re-runs this effect and
    // cleanup flips `active` to false, so a slow in-flight response from the previous
    // tab can no longer overwrite the current tab's state.
    let active = true;

    sendRuntimeMessage<DynamicRecord[]>(buildRequest({ limit: FEED_PAGE_SIZE }))
      .then((data) => {
        if (!active) return;
        setItems(data);
        setHasMore(data.length === FEED_PAGE_SIZE);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const port = chrome.runtime.connect({ name: "group-feed" });
    portRef.current = port;
    port.postMessage({ type: "start", mids });
    const onPortMessage = (msg: {
      type: string;
      completed?: number;
      total?: number;
      fresh?: number;
      skipped?: number;
      error?: string;
    }) => {
      if (!active) return;
      if (msg.type === "progress" && typeof msg.completed === "number" && typeof msg.total === "number") {
        setProgress({
          completed: msg.completed,
          total: msg.total,
          fresh: msg.fresh ?? 0,
          skipped: msg.skipped ?? 0
        });
        softRefreshRef.current();
      } else if (msg.type === "done") {
        setProgress(null);
        softRefreshRef.current();
      } else if (msg.type === "warn" && msg.error) {
        setError(msg.error);
      }
    };
    port.onMessage.addListener(onPortMessage);
    return () => {
      active = false;
      port.onMessage.removeListener(onPortMessage);
      port.disconnect();
      portRef.current = null;
    };
  }, [tabKey, mids.length]);

  async function loadMore() {
    if (loadingMore || !hasMore || items.length === 0) return;
    const oldest = items[items.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const more = await sendRuntimeMessage<DynamicRecord[]>(
        buildRequest({ limit: FEED_PAGE_SIZE, before: oldest.pubTs })
      );
      setItems((prev) => [...prev, ...more]);
      setHasMore(more.length === FEED_PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }
  loadMoreRef.current = loadMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreRef.current();
        }
      },
      { rootMargin: "240px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [tabKey, mids.length]);

  // Tier 1 — cheap local re-read that silently surfaces whatever the background sweep has
  // added (new items appear via the pill below; there's no per-group countdown — syncing is
  // a global action shown in the toolbar).
  useAutoRefresh(softRefresh, LOCAL_REFRESH_MS, mids.length > 0);
  // Tier 2 — sparser, best-effort network backfill of stale UPs for this group, sent over
  // the live port. If the worker is asleep the local re-read above still keeps the view moving.
  useAutoRefresh(
    () => {
      try {
        portRef.current?.postMessage({ type: "start", mids });
      } catch {
        /* port closed; the next tab open will reconnect */
      }
    },
    BACKFILL_REFRESH_MS,
    mids.length > 0
  );

  if (mids.length === 0) {
    return <div class="bdg-feed-state">该分组暂无成员。</div>;
  }
  if (loading && items.length === 0) {
    return <div class="bdg-feed-state">加载中…</div>;
  }
  if (error && items.length === 0) {
    return <div class="bdg-feed-state bdg-feed-state--error">{error}</div>;
  }
  if (items.length === 0) {
    return (
      <div class="bdg-feed-state">
        分组内暂无缓存动态。同步任务会逐步补全，或切到「全部」浏览 B 站原流。
      </div>
    );
  }

  return (
    <div class="bdg-feed">
      {progress ? <ProgressBar progress={progress} /> : null}
      {pendingCount > 0 ? (
        <button type="button" class="bdg-newitems" onClick={applyPending}>
          {pendingCount} 条新动态 ↑
        </button>
      ) : null}
      {items.map((item) => (
        <DynamicCard key={item.dynamicId} dynamic={item} />
      ))}
      <div ref={sentinelRef} class="bdg-feed-sentinel" aria-hidden="true" />
      <div class="bdg-feed-foot">
        {hasMore ? (
          <button type="button" class="bdg-feed-more" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "加载中…" : "继续加载"}
          </button>
        ) : (
          <span>已到底</span>
        )}
        {error ? <span class="bdg-feed-state--error">{error}</span> : null}
      </div>
    </div>
  );
}

function ProgressBar({ progress }: { progress: FetchProgress }) {
  const planning = progress.total === 0 && progress.fresh === 0 && progress.skipped === 0;
  const pct = progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100);
  return (
    <div class="bdg-feed-progress">
      <span>
        {planning ? "正在分析待补 UP…" : null}
        {!planning && progress.fresh > 0 ? `已是最新 ${progress.fresh} 位 · ` : ""}
        {!planning && progress.total > 0 ? `正在补充 ${progress.completed} / ${progress.total}` : ""}
        {!planning && progress.total === 0 ? "组内全部最新" : ""}
        {!planning && progress.skipped > 0 ? ` · 还有 ${progress.skipped} 位待后台兜底` : ""}
      </span>
      <div class="bdg-feed-progress-bar">
        <div class="bdg-feed-progress-fill" style={`width:${pct}%`} />
      </div>
    </div>
  );
}
