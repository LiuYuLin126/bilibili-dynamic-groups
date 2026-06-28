export type DynamicType = "opus" | "video" | "article" | "forward" | "live" | "unknown";
export type ViewSource = "dynamic" | "space" | "video";
export type QuadrantKey = "frequent-view-frequent-update" | "frequent-view-quiet-update" | "quiet-view-frequent-update" | "quiet-view-quiet-update";

export interface UpRecord {
  mid: number;
  name: string;
  face: string;
  sign: string;
  tagIds: number[];
  tagNames: string[];
  lastUpdateTs: number;
  lastViewedTs: number;
  viewCount7d: number;
  viewCount30d: number;
  postCount30d: number;
  updateCount24h: number;
  followedAt?: number;
  lastSpaceFetchAt?: number;
  updatedAt: number;
}

export interface GroupRecord {
  tagid: number;
  name: string;
  count: number;
  manualOrder: number;
  updatedAt: number;
}

export interface DynamicRecord {
  dynamicId: string;
  mid: number;
  type: DynamicType;
  pubTs: number;
  summary: string;
  upName?: string;
  upFace?: string;
  title?: string;
  cover?: string;
  durationText?: string;
  url?: string;
  extra?: DynamicExtra;
  raw?: string;
}

export interface DynamicExtra {
  imageCount?: number;
  liveStatus?: number;
  liveViewers?: number;
  isPaid?: boolean;
  forwardOf?: {
    upName?: string;
    type: DynamicType;
    summary?: string;
    cover?: string;
  };
}

export interface ViewLogRecord {
  id?: number;
  mid: number;
  ts: number;
  source: ViewSource;
}

export interface QuadrantItem {
  mid: number;
  name: string;
  face: string;
  viewScore: number;
  updateScore: number;
  updateCount24h: number;
  quadrant: QuadrantKey;
}

export interface QuadrantSnapshot {
  id: "latest";
  createdAt: number;
  viewMedian: number;
  updateMedian: number;
  items: QuadrantItem[];
}

export interface SyncMetaRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}

export interface AiGroupSuggestion {
  suggestedTagid: number | null;
  confidence: number;
  reason: string;
}

export type LogLevel = "info" | "warn" | "error";

export interface RunLogRecord {
  id?: number;
  ts: number;
  level: LogLevel;
  event: string;
  message: string;
  detail?: string;
}
