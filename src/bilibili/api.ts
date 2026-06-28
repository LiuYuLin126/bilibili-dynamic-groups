import { z } from "zod";
import { BILI_API_BASE, SYNC_REQUEST_INTERVAL_MS } from "@/src/shared/constants";
import type { DynamicExtra, DynamicRecord, DynamicType, GroupRecord, UpRecord } from "@/src/types/domain";
import { extractWbiKey, signWbi, type WbiKeys } from "@/src/bilibili/wbi";

const ApiEnvelope = z.object({
  code: z.number(),
  message: z.string().optional(),
  data: z.unknown().optional()
});

const NavData = z.object({
  mid: z.number(),
  wbi_img: z.object({
    img_url: z.string(),
    sub_url: z.string()
  })
});

const TagsData = z.array(
  z.object({
    tagid: z.number(),
    name: z.string(),
    count: z.number().optional()
  })
);

const FollowingsData = z.object({
  list: z.array(
    z.object({
      mid: z.number(),
      uname: z.string(),
      face: z.string().optional(),
      sign: z.string().optional(),
      mtime: z.number().optional()
    })
  ),
  total: z.number().optional()
});

const TagMembersData = z.union([FollowingsData, FollowingsData.shape.list]);

export class BilibiliApiClient {
  #wbiKeys?: WbiKeys;
  #lastRequestAt = 0;

  async getCurrentUserMid(): Promise<number> {
    const data = await this.request("/x/web-interface/nav", undefined, NavData);
    this.#wbiKeys = {
      imgKey: extractWbiKey(data.wbi_img.img_url),
      subKey: extractWbiKey(data.wbi_img.sub_url)
    };
    return data.mid;
  }

  async getGroups(): Promise<GroupRecord[]> {
    const data = await this.request("/x/relation/tags", undefined, TagsData);
    const now = Date.now();
    return data.map((group, index) => ({
      tagid: group.tagid,
      name: group.name,
      count: group.count ?? 0,
      manualOrder: index,
      updatedAt: now
    }));
  }

  async getFollowings(vmid: number, page = 1, pageSize = 50): Promise<{ ups: UpRecord[]; total: number }> {
    const query = await this.signedQuery({ vmid, pn: page, ps: pageSize, order: "desc", order_type: "attention" });
    const data = await this.request(`/x/relation/followings?${query}`, undefined, FollowingsData);
    const now = Date.now();
    return {
      total: data.total ?? data.list.length,
      ups: data.list.map((up) => ({
        mid: up.mid,
        name: up.uname,
        face: up.face ?? "",
        sign: up.sign ?? "",
        tagIds: [],
        tagNames: [],
        lastUpdateTs: 0,
        lastViewedTs: 0,
        viewCount7d: 0,
        viewCount30d: 0,
        postCount30d: 0,
        updateCount24h: 0,
        ...(up.mtime ? { followedAt: up.mtime * 1000 } : {}),
        updatedAt: now
      }))
    };
  }

  async getTagMembers(tagid: number): Promise<number[]> {
    const query = await this.signedQuery({ tagid, pn: 1, ps: 100 });
    const data = await this.request(`/x/relation/tag?${query}`, undefined, TagMembersData);
    const list = Array.isArray(data) ? data : data.list;
    return list.map((up) => up.mid);
  }

  async getFeedAll(offset?: string): Promise<{ dynamics: DynamicRecord[]; nextOffset?: string; hasMore: boolean }> {
    const query = new URLSearchParams({
      type: "all",
      timezone_offset: "-480",
      features: "itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote"
    });
    if (offset) query.set("offset", offset);
    const data = await this.requestUnknown(`/x/polymer/web-dynamic/v1/feed/all?${query.toString()}`);
    const items = readPath<unknown[]>(data, ["items"]) ?? [];
    const nextOffset = readPath<string>(data, ["offset"]);
    return {
      dynamics: items.map(parseDynamicItem).filter((item): item is DynamicRecord => Boolean(item)),
      ...(nextOffset ? { nextOffset } : {}),
      hasMore: Boolean(readPath<boolean>(data, ["has_more"]))
    };
  }

  async getSpaceDynamics(hostMid: number): Promise<DynamicRecord[]> {
    const query = new URLSearchParams({ host_mid: String(hostMid), timezone_offset: "-480" });
    const data = await this.requestUnknown(`/x/polymer/web-dynamic/v1/feed/space?${query.toString()}`);
    const items = readPath<unknown[]>(data, ["items"]) ?? [];
    return items.map(parseDynamicItem).filter((item): item is DynamicRecord => Boolean(item));
  }

  async getLiveFollowing(): Promise<DynamicRecord[]> {
    const all: DynamicRecord[] = [];
    const seen = new Set<number>();
    const pageSize = 24;
    for (let page = 1; page <= 20; page += 1) {
      const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) }).toString();
      const data = await this.requestUnknown(
        `https://api.live.bilibili.com/xlive/web-ucenter/user/following?${query}`
      );
      const list = (readPath<unknown[]>(data, ["list"]) ?? readPath<unknown[]>(data, ["items"]) ?? []) as unknown[];
      if (list.length === 0) break;
      for (const item of list) {
        const parsed = parseLiveItem(item);
        if (parsed && !seen.has(parsed.mid)) {
          seen.add(parsed.mid);
          all.push(parsed);
        }
      }
      const totalPage = optionalNumber(readPath(data, ["totalPage"]));
      if (totalPage !== undefined && page >= totalPage) break;
    }
    return all;
  }

  async getUpProfile(mid: number) {
    const query = await this.signedQuery({ mid });
    return this.requestUnknown(`/x/space/wbi/acc/info?${query}`);
  }

  async getUpVideos(mid: number, pageSize = 10) {
    const query = await this.signedQuery({ mid, pn: 1, ps: pageSize, order: "pubdate" });
    return this.requestUnknown(`/x/space/wbi/arc/search?${query}`);
  }

  private async signedQuery(params: Record<string, string | number | undefined>) {
    const keys = this.#wbiKeys ?? (await this.refreshWbiKeys());
    return signWbi(params, keys);
  }

  private async refreshWbiKeys() {
    await this.getCurrentUserMid();
    if (!this.#wbiKeys) throw new Error("Unable to resolve Bilibili WBI keys");
    return this.#wbiKeys;
  }

  private async request<T>(path: string, init: RequestInit | undefined, schema: z.ZodType<T>): Promise<T> {
    const data = await this.requestUnknown(path, init);
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`Bilibili API schema mismatch at ${stripQuery(path)}: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  private async requestUnknown(path: string, init?: RequestInit): Promise<unknown> {
    await this.limit();
    const url = path.startsWith("http") ? path : `${BILI_API_BASE}${path}`;
    const response = await fetch(url, {
      ...init,
      credentials: "include",
      headers: {
        accept: "application/json",
        ...(init?.headers ?? {})
      }
    });

    if (response.status === 412) {
      throw new Error(`Bilibili risk control returned 412 at ${stripQuery(path)}. Sync paused; retry later with a lower request rate.`);
    }
    if (!response.ok) {
      throw new Error(`Bilibili API ${response.status} at ${stripQuery(path)}: ${response.statusText}`);
    }

    const envelope = ApiEnvelope.parse(await response.json());
    if (envelope.code !== 0) {
      throw new Error(`Bilibili API code ${envelope.code} at ${stripQuery(path)}: ${envelope.message ?? "request failed"}`);
    }
    return envelope.data;
  }

  private async limit() {
    const elapsed = Date.now() - this.#lastRequestAt;
    if (elapsed < SYNC_REQUEST_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, SYNC_REQUEST_INTERVAL_MS - elapsed));
    }
    this.#lastRequestAt = Date.now();
  }
}

function stripQuery(path: string) {
  return path.split("?")[0] ?? path;
}

function parseDynamicItem(item: unknown): DynamicRecord | null {
  const obj = asRecord(item);
  const id = readPath<string | number>(obj, ["id_str"]) ?? readPath<string | number>(obj, ["id"]);
  const mid = readPath<number>(obj, ["modules", "module_author", "mid"]);
  const pubTs = readPath<number>(obj, ["modules", "module_author", "pub_ts"]);
  if (!id || !mid || !pubTs) return null;

  const type = parseDynamicType(readPath<string>(obj, ["type"]));
  const upName = optionalString(readPath(obj, ["modules", "module_author", "name"]));
  const upFace = normalizeUrl(optionalString(readPath(obj, ["modules", "module_author", "face"])));
  const meta = extractDynamicMeta(obj, type);
  const isPaid = detectPaid(obj);

  const record: DynamicRecord = {
    dynamicId: String(id),
    mid,
    type,
    pubTs: pubTs * 1000,
    summary: summarizeDynamic(obj)
  };
  if (upName) record.upName = upName;
  if (upFace) record.upFace = upFace;
  Object.assign(record, meta);
  if (isPaid) {
    record.extra = { ...(record.extra ?? {}), isPaid: true };
  }
  if (!record.summary && !record.title) {
    try {
      const rawPayload = {
        type: optionalString(obj.type),
        module_dynamic: readPath(obj, ["modules", "module_dynamic"]),
        basic: readPath(obj, ["basic"])
      };
      record.raw = JSON.stringify(rawPayload).slice(0, 6000);
    } catch {
      /* skip raw if not serializable */
    }
  }
  return record;
}

function detectPaid(item: Record<string, unknown>): boolean {
  const type = optionalString(readPath(item, ["type"])) ?? "";
  if (/PAY|CHARGE/i.test(type)) return true;
  if (readPath(item, ["basic", "is_only_fans"]) === true) return true;
  const iconBadgeText = optionalString(readPath(item, ["modules", "module_author", "icon_badge", "text"]));
  if (iconBadgeText && /充电专属|充电专享|充电限定/.test(iconBadgeText)) return true;
  const major = readPath(item, ["modules", "module_dynamic", "major"]);
  const additional = readPath(item, ["modules", "module_dynamic", "additional"]);
  for (const sub of [major, additional]) {
    if (!sub) continue;
    try {
      const str = JSON.stringify(sub);
      if (/充电专属|充电专享|充电限定|pay[_-]?(?:only|content)/i.test(str)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function parseDynamicType(type?: string): DynamicType {
  if (!type) return "unknown";
  if (type.includes("VIDEO") || type.includes("AV")) return "video";
  if (type.includes("ARTICLE")) return "article";
  if (type.includes("FORWARD")) return "forward";
  if (type.includes("LIVE")) return "live";
  if (type.includes("WORD") || type.includes("DRAW") || type.includes("OPUS")) return "opus";
  return "unknown";
}

function summarizeDynamic(item: Record<string, unknown>) {
  const moduleDynamic = readPath(item, ["modules", "module_dynamic"]);
  const desc = readPath(moduleDynamic, ["desc"]);
  const opus = readPath(moduleDynamic, ["major", "opus"]);
  const candidates: Array<string | undefined> = [
    optionalString(readPath(item, ["modules", "module_dynamic", "major", "archive", "title"])),
    optionalString(readPath(item, ["modules", "module_dynamic", "major", "article", "title"])),
    optionalString(readPath(item, ["modules", "module_dynamic", "major", "opus", "title"])),
    optionalString(readPath(item, ["modules", "module_dynamic", "desc", "text"])),
    extractRichText(readPath(desc, ["rich_text_nodes"])),
    optionalString(readPath(item, ["modules", "module_dynamic", "major", "opus", "summary", "text"])),
    extractRichText(readPath(opus, ["summary", "rich_text_nodes"])),
    optionalString(readPath(opus, ["text"])),
    deepFindText(opus, 6),
    deepFindText(desc, 6),
    deepFindText(moduleDynamic, 8),
    deepFindText(item, 10, new Set(), STRUCTURAL_SKIP_KEYS)
  ];
  for (const candidate of candidates) {
    if (candidate) return candidate.slice(0, 140);
  }
  return "";
}

function extractRichText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((node) => optionalString(readPath<string>(node, ["text"])) ?? optionalString(readPath<string>(node, ["orig_text"])))
    .filter((segment): segment is string => Boolean(segment))
    .join("");
  return text || undefined;
}

const TEXT_FIELD_KEYS = [
  "text",
  "orig_text",
  "title",
  "summary",
  "content",
  "desc",
  "description",
  "raw_text",
  "value",
  "label"
];

const STRUCTURAL_SKIP_KEYS = new Set([
  "module_author",
  "module_more",
  "module_dispute",
  "module_stat",
  "module_interaction",
  "module_tag",
  "vip",
  "decoration_card",
  "decorate_card",
  "pendant",
  "official",
  "official_verify",
  "nft_info",
  "avatar",
  "avatar_icon",
  "name_render",
  "icon_badge",
  "fan",
  "color_format",
  "vip_label",
  "label",
  "stat",
  "interaction",
  "basic",
  "like_icon"
]);

function deepFindText(
  node: unknown,
  maxDepth: number,
  visited: Set<unknown> = new Set(),
  skipKeys?: Set<string>
): string | undefined {
  if (maxDepth <= 0 || node === null || node === undefined) return undefined;
  if (typeof node === "string") {
    if (looksLikeUrl(node)) return undefined;
    return node.length ? node : undefined;
  }
  if (typeof node !== "object") return undefined;
  if (visited.has(node)) return undefined;
  visited.add(node);
  if (Array.isArray(node)) {
    const joined = node
      .map((child) => deepFindText(child, maxDepth - 1, visited, skipKeys))
      .filter((segment): segment is string => Boolean(segment))
      .join("");
    return joined || undefined;
  }
  const obj = node as Record<string, unknown>;
  for (const key of TEXT_FIELD_KEYS) {
    const value = obj[key];
    if (typeof value === "string" && value.length && !looksLikeUrl(value)) return value;
    if (Array.isArray(value)) {
      const found = deepFindText(value, maxDepth - 1, visited, skipKeys);
      if (found) return found;
    }
  }
  if (skipKeys) {
    for (const [key, value] of Object.entries(obj)) {
      if (TEXT_FIELD_KEYS.includes(key) || skipKeys.has(key)) continue;
      if (value && typeof value === "object") {
        const found = deepFindText(value, maxDepth - 1, visited, skipKeys);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//.test(value) || /^\/\//.test(value) || value.includes("hdslb.com");
}

function extractDynamicMeta(item: Record<string, unknown>, type: DynamicType): Partial<DynamicRecord> {
  const major = asRecord(readPath<unknown>(item, ["modules", "module_dynamic", "major"]));
  const result: Partial<DynamicRecord> = {};

  if (type === "video") {
    const archive = asRecord(major.archive);
    setIf(result, "title", optionalString(archive.title));
    setIf(result, "cover", normalizeUrl(optionalString(archive.cover)));
    setIf(result, "durationText", optionalString(archive.duration_text));
    setIf(result, "url", normalizeUrl(optionalString(archive.jump_url)));
    return result;
  }

  if (type === "article") {
    const article = asRecord(major.article);
    const opus = asRecord(major.opus);
    const covers = (article.covers as unknown[]) ?? [];
    setIf(result, "title", optionalString(article.title) ?? optionalString(opus.title));
    setIf(result, "cover", normalizeUrl(optionalString(covers[0]) ?? optionalString(opus.cover)));
    setIf(result, "url", normalizeUrl(optionalString(article.jump_url)));
    return result;
  }

  if (type === "live") {
    const liveRcmd = asRecord(major.live_rcmd);
    const liveCard = asRecord(major.live);
    const content = typeof liveRcmd.content === "string" ? safeJson(liveRcmd.content) : asRecord(liveRcmd.content);
    const liveInfo = asRecord(readPath(content, ["live_play_info"]) ?? liveCard);
    const extra: DynamicExtra = {};
    setIf(extra, "liveStatus", optionalNumber(liveInfo.live_status));
    setIf(extra, "liveViewers", optionalNumber(readPath(liveInfo, ["watched_show", "num"])));
    setIf(result, "title", optionalString(liveInfo.title));
    setIf(result, "cover", normalizeUrl(optionalString(liveInfo.cover)));
    setIf(result, "url", normalizeUrl(optionalString(liveInfo.link)));
    if (Object.keys(extra).length) result.extra = extra;
    return result;
  }

  if (type === "opus") {
    const opus = asRecord(major.opus);
    const pics = collectPics(major);
    const firstPic = picUrl(pics.find((pic) => pic != null));
    setIf(result, "title", optionalString(opus.title));
    setIf(result, "cover", normalizeUrl(firstPic));
    if (pics.length) result.extra = { imageCount: pics.length };
    return result;
  }

  if (type === "forward") {
    const orig = asRecord(item.orig);
    const origType = parseDynamicType(readPath<string>(orig, ["type"]));
    const origMeta = extractDynamicMeta(orig, origType);
    const forwardOf: NonNullable<DynamicExtra["forwardOf"]> = { type: origType };
    setIf(forwardOf, "upName", optionalString(readPath(orig, ["modules", "module_author", "name"])));
    setIf(forwardOf, "summary", origMeta.title ?? (summarizeDynamic(orig) || undefined));
    setIf(forwardOf, "cover", origMeta.cover);
    result.extra = { forwardOf };
    return result;
  }

  return result;
}

function setIf<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined) {
  if (value !== undefined) target[key] = value;
}

function collectPics(major: Record<string, unknown>): unknown[] {
  const sources: Array<unknown[] | undefined> = [
    readPath<unknown[]>(major, ["opus", "pics"]),
    readPath<unknown[]>(major, ["draw", "items"]),
    readPath<unknown[]>(major, ["opus", "draw", "items"]),
    readPath<unknown[]>(major, ["images"])
  ];
  // Pick the first source that actually has a usable item — an array that is non-empty
  // but holds only null/undefined would otherwise shadow a later source with real pics.
  for (const source of sources) {
    if (Array.isArray(source) && source.some((pic) => pic != null)) return source;
  }
  return [];
}

function picUrl(pic: unknown): string | undefined {
  if (typeof pic === "string" && pic.length) return pic;
  const obj = asRecord(pic);
  return (
    optionalString(obj.url) ??
    optionalString(obj.src) ??
    optionalString(obj.img_src) ??
    optionalString(obj.image_src) ??
    optionalString(obj.cover)
  );
}

function parseLiveItem(item: unknown): DynamicRecord | null {
  const obj = asRecord(item);
  const uid = optionalNumber(obj.uid) ?? optionalNumber(obj.mid);
  const roomId = optionalNumber(obj.roomid) ?? optionalNumber(obj.room_id);
  if (!uid || !roomId) return null;

  const liveTime = optionalNumber(obj.live_time);
  const pubTs = liveTime ? liveTime * 1000 : Date.now();
  const title = optionalString(obj.title);
  const cover = normalizeUrl(optionalString(obj.pic) ?? optionalString(obj.cover));
  const url = normalizeUrl(optionalString(obj.link)) ?? `https://live.bilibili.com/${roomId}`;
  const upName = optionalString(obj.uname) ?? optionalString(obj.name);
  const upFace = normalizeUrl(optionalString(obj.face));
  const liveStatus = optionalNumber(obj.live_status) ?? 1;
  const liveViewers = optionalNumber(obj.online) ?? optionalNumber(obj.viewer);

  const extra: DynamicExtra = { liveStatus };
  if (liveViewers !== undefined) extra.liveViewers = liveViewers;

  const record: DynamicRecord = {
    dynamicId: `live-${roomId}`,
    mid: uid,
    type: "live",
    pubTs,
    summary: title ?? "",
    extra
  };
  if (upName) record.upName = upName;
  if (upFace) record.upFace = upFace;
  if (title) record.title = title;
  if (cover) record.cover = cover;
  record.url = url;
  return record;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readPath<T>(value: unknown, path: string[]): T | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current as T | undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
