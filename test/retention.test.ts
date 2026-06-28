import { describe, expect, it } from "vitest";
import { selectStaleDynamicIds } from "@/src/storage/retention";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const cutoff = NOW - 60 * DAY;
const KEEP = 10;

// pubTs expressed as "days ago" for readability.
const dyn = (id: string, mid: number, daysAgo: number) => ({
  dynamicId: id,
  mid,
  pubTs: NOW - daysAgo * DAY
});

describe("selectStaleDynamicIds", () => {
  it("deletes nothing when everything is within the window", () => {
    const items = [dyn("a", 1, 1), dyn("b", 1, 30), dyn("c", 2, 59)];
    expect(selectStaleDynamicIds(items, cutoff, KEEP)).toEqual([]);
  });

  it("keeps every older post for a quiet UP under the per-UP cap", () => {
    // 3 old posts, none within window, cap 10 → keep all.
    const items = [dyn("a", 1, 100), dyn("b", 1, 200), dyn("c", 1, 300)];
    expect(selectStaleDynamicIds(items, cutoff, KEEP)).toEqual([]);
  });

  it("keeps only the newest N older posts when a UP has more than the cap", () => {
    const items = Array.from({ length: 13 }, (_, i) => dyn(`d${i}`, 1, 70 + i)); // all older, ascending age
    const deleted = selectStaleDynamicIds(items, cutoff, KEEP).sort();
    // newest 10 (d0..d9) kept, oldest 3 (d10,d11,d12) deleted
    expect(deleted).toEqual(["d10", "d11", "d12"]);
  });

  it("counts in-window posts against the per-UP cap", () => {
    // 8 recent (within window) + 5 old. cap 10 → keep 2 newest old, delete 3.
    const recent = Array.from({ length: 8 }, (_, i) => dyn(`r${i}`, 1, i + 1));
    const old = [dyn("o0", 1, 70), dyn("o1", 1, 71), dyn("o2", 1, 72), dyn("o3", 1, 73), dyn("o4", 1, 74)];
    const deleted = selectStaleDynamicIds([...recent, ...old], cutoff, KEEP).sort();
    expect(deleted).toEqual(["o2", "o3", "o4"]); // o0,o1 are newest old → kept
  });

  it("deletes all older posts for an active UP already past the cap in-window", () => {
    const recent = Array.from({ length: 12 }, (_, i) => dyn(`r${i}`, 1, i + 1)); // 12 within window
    const old = [dyn("o0", 1, 90), dyn("o1", 1, 100)];
    const deleted = selectStaleDynamicIds([...recent, ...old], cutoff, KEEP).sort();
    expect(deleted).toEqual(["o0", "o1"]);
  });

  it("treats each UP independently", () => {
    const items = [
      dyn("a", 1, 100), // mid 1: lone old post → kept
      dyn("b", 2, 100),
      dyn("c", 2, 101) // mid 2: two old posts, cap... see below
    ];
    expect(selectStaleDynamicIds(items, cutoff, 1)).toEqual(["c"]); // mid1 keeps a; mid2 keeps newest(b), deletes c
  });
});
