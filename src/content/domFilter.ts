import type { UpRecord } from "@/src/types/domain";

export type GroupTab = number | "all" | "ungrouped" | "quiet" | "live";

export function resolveGroupMids(tab: GroupTab, ups: UpRecord[]): number[] {
  if (tab === "all" || tab === "live") return ups.map((up) => up.mid);
  if (tab === "ungrouped") return ups.filter((up) => up.tagIds.length === 0).map((up) => up.mid);
  if (tab === "quiet") return ups.filter(isQuietFollow).map((up) => up.mid);
  return ups.filter((up) => up.tagIds.includes(tab)).map((up) => up.mid);
}

export function isQuietFollow(up: UpRecord) {
  return up.tagNames.some((name) => name.includes("悄悄关注")) || up.tagIds.includes(-10);
}
