import { useEffect, useState } from "preact/hooks";
import { DynamicCard } from "@/src/content/cards";
import { sendRuntimeMessage } from "@/src/shared/messages";
import type { DynamicRecord } from "@/src/types/domain";

export function LiveFeed() {
  const [items, setItems] = useState<DynamicRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await sendRuntimeMessage<DynamicRecord[]>({ type: "live:get" });
      const onlyLive = data.filter((d) => d.extra?.liveStatus === 1);
      onlyLive.sort((a, b) => b.pubTs - a.pubTs);
      setItems(onlyLive);
      setFetchedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (loading && items.length === 0) {
    return <div class="bdg-feed-state">正在拉取关注直播…</div>;
  }
  if (error && items.length === 0) {
    return (
      <div class="bdg-feed-state bdg-feed-state--error">
        {error}
        <button type="button" class="bdg-feed-more" onClick={load}>
          重试
        </button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div class="bdg-feed-state">
        当前没有正在直播的关注 UP。
        <button type="button" class="bdg-feed-more" onClick={load}>
          刷新
        </button>
      </div>
    );
  }

  return (
    <div class="bdg-feed">
      <div class="bdg-feed-meta">
        <span>{items.length} 位正在直播</span>
        {fetchedAt ? <span>更新于 {formatClock(fetchedAt)}</span> : null}
        <button type="button" class="bdg-feed-mini" onClick={load} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </button>
        {error ? <span class="bdg-feed-state--error">{error}</span> : null}
      </div>
      {items.map((item) => (
        <DynamicCard key={item.dynamicId} dynamic={item} />
      ))}
    </div>
  );
}

function formatClock(ts: number) {
  const date = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
