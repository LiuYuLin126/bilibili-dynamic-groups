import { useState } from "preact/hooks";
import type { DynamicExtra, DynamicRecord, DynamicType } from "@/src/types/domain";

export interface TypeColor {
  bg: string;
  fg: string;
}

export const TYPE_COLOR: Record<DynamicType, TypeColor> = {
  video: { bg: "#e6f1fb", fg: "#0c447c" },
  live: { bg: "#fcebeb", fg: "#791f1f" },
  opus: { bg: "#e1f5ee", fg: "#085041" },
  article: { bg: "#faeeda", fg: "#633806" },
  forward: { bg: "#eeedfe", fg: "#3c3489" },
  unknown: { bg: "#f1efe8", fg: "#444441" }
};

export function DynamicCard({ dynamic }: { dynamic: DynamicRecord }) {
  const url = dynamic.url ?? `https://t.bilibili.com/${dynamic.dynamicId}`;
  const text = dynamic.title || dynamic.summary || placeholderForType(dynamic.type, dynamic.extra);
  const color = TYPE_COLOR[dynamic.type] ?? TYPE_COLOR.unknown;
  const hasCover = Boolean(dynamic.cover);

  return (
    <a class="bdg-card" href={url} target="_blank" rel="noopener noreferrer">
      <div class="bdg-card-header">
        <Avatar name={dynamic.upName ?? ""} face={dynamic.upFace} color={color} />
        <span class="bdg-card-up">{dynamic.upName ?? `mid ${dynamic.mid}`}</span>
        <span class="bdg-card-badge" style={`background:${color.bg};color:${color.fg}`}>
          {labelForType(dynamic.type, dynamic.extra)}
        </span>
        {dynamic.extra?.isPaid ? <span class="bdg-card-badge bdg-card-badge--paid">充电</span> : null}
        <span class="bdg-card-time">{formatRelTime(dynamic.pubTs)}</span>
        {dynamic.raw ? <DebugCopy raw={dynamic.raw} /> : null}
      </div>
      {hasCover ? (
        <div class="bdg-card-body">
          <div class="bdg-card-cover">
            <img src={dynamic.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
            {dynamic.durationText ? (
              <span class="bdg-card-cover-tag">{dynamic.durationText}</span>
            ) : null}
            {dynamic.extra?.liveStatus === 1 ? (
              <span class="bdg-card-cover-live">LIVE</span>
            ) : null}
            {dynamic.extra?.liveViewers ? (
              <span class="bdg-card-cover-tag bdg-card-cover-tag--right">
                {formatViewers(dynamic.extra.liveViewers)}
              </span>
            ) : null}
          </div>
          <div class="bdg-card-text">{text}</div>
        </div>
      ) : (
        <div class="bdg-card-text bdg-card-text--solo">{text}</div>
      )}
      {dynamic.extra?.forwardOf ? <ForwardQuote forward={dynamic.extra.forwardOf} /> : null}
    </a>
  );
}

function DebugCopy({ raw }: { raw: string }) {
  const [copied, setCopied] = useState(false);
  const handleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard.writeText(raw)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {
        /* clipboard denied — nothing actionable from this small button */
      });
  };
  return (
    <button
      type="button"
      class="bdg-card-debug"
      onClick={handleClick}
      title="复制本条动态原始数据"
    >
      {copied ? "已复制" : "复制原始"}
    </button>
  );
}

function Avatar({ name, face, color }: { name: string; face?: string | undefined; color: TypeColor }) {
  if (face) {
    return (
      <img class="bdg-card-avatar" src={face} alt="" loading="lazy" referrerPolicy="no-referrer" />
    );
  }
  const initial = name.slice(0, 1) || "·";
  return (
    <div
      class="bdg-card-avatar bdg-card-avatar--text"
      style={`background:${color.bg};color:${color.fg}`}
    >
      {initial}
    </div>
  );
}

function ForwardQuote({ forward }: { forward: NonNullable<DynamicExtra["forwardOf"]> }) {
  return (
    <div class="bdg-card-quote">
      {forward.cover ? (
        <img
          class="bdg-card-quote-cover"
          src={forward.cover}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <div class="bdg-card-quote-text">
        <span class="bdg-card-quote-meta">
          @{forward.upName ?? "原作者"} · {labelForType(forward.type)}
        </span>
        <span class="bdg-card-quote-summary">{forward.summary ?? ""}</span>
      </div>
    </div>
  );
}

export function labelForType(type: DynamicType, extra?: DynamicExtra): string {
  if (type === "live") return extra?.liveStatus === 1 ? "直播中" : "直播";
  if (type === "opus") return extra?.imageCount ? `图文 · ${extra.imageCount} 图` : "动态";
  if (type === "forward") return "转发";
  if (type === "video") return "视频";
  if (type === "article") return "专栏";
  return "动态";
}

export function placeholderForType(type: DynamicType, extra?: DynamicExtra): string {
  if (extra?.isPaid) return "[充电专属内容]";
  if (type === "live") return extra?.liveStatus === 1 ? "[正在直播]" : "[直播预告]";
  if (type === "opus" && extra?.imageCount) return `[图文 · ${extra.imageCount} 图]`;
  if (type === "forward") return "[转发]";
  if (type === "article") return "[专栏]";
  if (type === "video") return "[视频]";
  return "[动态]";
}

export function formatRelTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const date = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (diff < 2 * 86_400_000) return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatViewers(num: number): string {
  if (num >= 10_000) return `${(num / 10_000).toFixed(1)} 万人`;
  return `${num} 人`;
}
