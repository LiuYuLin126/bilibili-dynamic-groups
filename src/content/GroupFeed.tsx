import { useEffect, useRef, useState } from "preact/hooks";
import { DynamicCard } from "@/src/content/cards";
import { sendRuntimeMessage } from "@/src/shared/messages";
import type { DynamicRecord } from "@/src/types/domain";

const FEED_PAGE_SIZE = 50;

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
  const itemCountRef = useRef(0);
  itemCountRef.current = items.length;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    if (mids.length === 0) {
      setItems([]);
      setLoading(false);
      setHasMore(false);
      setError("");
      setProgress(null);
      return;
    }
    setLoading(true);
    setError("");
    setHasMore(true);
    setProgress({ completed: 0, total: 0, fresh: 0, skipped: 0 });

    const baseRequest = (extras: { limit: number; before?: number }) => {
      const payload: { type: "feed:get"; mids: number[]; limit: number; before?: number; typeFilter?: TypeFilter } = {
        type: "feed:get",
        mids,
        limit: extras.limit
      };
      if (extras.before !== undefined) payload.before = extras.before;
      if (typeFilter) payload.typeFilter = typeFilter;
      return payload;
    };

    sendRuntimeMessage<DynamicRecord[]>(baseRequest({ limit: FEED_PAGE_SIZE }))
      .then((data) => {
        setItems(data);
        setHasMore(data.length === FEED_PAGE_SIZE);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));

    const port = chrome.runtime.connect({ name: "group-feed" });
    port.postMessage({ type: "start", mids });
    const refetch = () => {
      const limit = Math.max(FEED_PAGE_SIZE, itemCountRef.current);
      void sendRuntimeMessage<DynamicRecord[]>(baseRequest({ limit })).then((fresh) => {
        setItems(fresh);
        setHasMore(fresh.length === limit);
      });
    };
    port.onMessage.addListener(
      (msg: {
        type: string;
        completed?: number;
        total?: number;
        fresh?: number;
        skipped?: number;
        error?: string;
      }) => {
        if (msg.type === "progress" && typeof msg.completed === "number" && typeof msg.total === "number") {
          setProgress({
            completed: msg.completed,
            total: msg.total,
            fresh: msg.fresh ?? 0,
            skipped: msg.skipped ?? 0
          });
          refetch();
        } else if (msg.type === "done") {
          setProgress(null);
          refetch();
        } else if (msg.type === "warn" && msg.error) {
          setError(msg.error);
        }
      }
    );
    return () => {
      port.disconnect();
    };
  }, [tabKey, mids.length]);

  async function loadMore() {
    if (loadingMore || !hasMore || items.length === 0) return;
    const oldest = items[items.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const payload: { type: "feed:get"; mids: number[]; limit: number; before: number; typeFilter?: TypeFilter } = {
        type: "feed:get",
        mids,
        limit: FEED_PAGE_SIZE,
        before: oldest.pubTs
      };
      if (typeFilter) payload.typeFilter = typeFilter;
      const more = await sendRuntimeMessage<DynamicRecord[]>(payload);
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
  }, [tabKey]);

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
