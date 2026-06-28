import { useEffect, useRef, useState } from "preact/hooks";

/**
 * Runs `onRefresh` on a fixed interval and whenever the tab regains visibility/focus,
 * but only while the document is actually visible — a hidden dashboard never polls.
 * Returns timestamps so a countdown can be rendered separately (see RefreshStatus).
 *
 * Note: this is intentionally for *cheap* refreshes (local DB reads, a single live
 * lookup). Full sync stays on the background alarm so we never hammer Bilibili and
 * trip its risk control.
 */
export function useAutoRefresh(onRefresh: () => void, intervalMs: number, enabled = true) {
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;
  const lastRunRef = useRef(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setNextRefreshAt(null);
      return;
    }
    let timer = 0;
    let cancelled = false;

    const run = (force: boolean) => {
      const now = Date.now();
      // Coalesce the visibilitychange + focus pair that both fire on tab return.
      if (!force && now - lastRunRef.current < 1500) return;
      lastRunRef.current = now;
      cbRef.current();
      setLastRefreshedAt(now);
    };
    const schedule = () => {
      if (cancelled) return;
      setNextRefreshAt(Date.now() + intervalMs);
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") run(true);
        schedule();
      }, intervalMs);
    };
    const onActive = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      run(false);
      schedule();
    };

    schedule();
    document.addEventListener("visibilitychange", onActive);
    window.addEventListener("focus", onActive);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onActive);
      window.removeEventListener("focus", onActive);
    };
  }, [intervalMs, enabled]);

  const refreshNow = () => {
    lastRunRef.current = Date.now();
    cbRef.current();
    setLastRefreshedAt(Date.now());
    setNextRefreshAt(Date.now() + intervalMs);
  };

  return { lastRefreshedAt, nextRefreshAt, refreshNow };
}

/**
 * Compact "更新于 X · 下次 m:ss · 刷新" line. Owns its own 1s tick so only this small
 * node re-renders each second, never the surrounding card list.
 */
export function RefreshStatus({
  lastRefreshedAt,
  nextRefreshAt,
  onRefresh,
  busy
}: {
  lastRefreshedAt: number | null;
  nextRefreshAt: number | null;
  onRefresh: () => void;
  busy?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const sinceText = lastRefreshedAt ? relTime(now - lastRefreshedAt) : "未刷新";
  const countdown = nextRefreshAt ? Math.max(0, Math.round((nextRefreshAt - now) / 1000)) : null;

  return (
    <span class="bdg-refresh-status">
      <span>更新于 {sinceText}</span>
      {countdown !== null ? <span>· 下次 {formatCountdown(countdown)}</span> : null}
      <button type="button" class="bdg-feed-mini" onClick={onRefresh} disabled={busy}>
        {busy ? "刷新中…" : "刷新"}
      </button>
    </span>
  );
}

function relTime(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 5) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.round(minutes / 60)} 小时前`;
}

export function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}:${rest.toString().padStart(2, "0")}` : `${rest}s`;
}
