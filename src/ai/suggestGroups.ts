import type { BilibiliApiClient } from "@/src/bilibili/api";
import { db } from "@/src/storage/db";
import type { AiGroupSuggestion } from "@/src/types/domain";
import type { Settings } from "@/src/shared/messages";

export async function suggestGroupForUp(
  mid: number,
  api: BilibiliApiClient,
  settings: Settings
): Promise<AiGroupSuggestion> {
  if (!settings.enableAiSuggestions || !settings.aiApiKey) {
    return { suggestedTagid: null, confidence: 0, reason: "AI suggestions are disabled." };
  }

  const [up, groups, profile, videos] = await Promise.all([
    db.ups.get(mid),
    db.groups.toArray(),
    api.getUpProfile(mid),
    api.getUpVideos(mid)
  ]);
  if (!up) return { suggestedTagid: null, confidence: 0, reason: "UP is not in local followings." };

  const prompt = buildPrompt(up.name, up.sign, groups, profile, videos);
  const response = await fetch(settings.aiEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.aiApiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: settings.aiModel,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    throw new Error(`AI provider ${response.status}: ${response.statusText}`);
  }
  const raw = await response.json();
  const text = extractText(raw);
  return parseSuggestion(text, settings.confidenceThreshold);
}

function buildPrompt(name: string, sign: string, groups: Array<{ tagid: number; name: string }>, profile: unknown, videos: unknown) {
  return [
    "Return strict JSON only: {\"suggested_tagid\": number|null, \"confidence\": number, \"reason\": string}.",
    "Pick one existing group only when confidence is high enough. Do not include cookies or user identifiers.",
    `UP name: ${name}`,
    `UP sign: ${sign}`,
    `Groups: ${JSON.stringify(groups)}`,
    `Profile: ${JSON.stringify(profile).slice(0, 3000)}`,
    `Recent videos: ${JSON.stringify(videos).slice(0, 3000)}`
  ].join("\n");
}

function extractText(raw: unknown) {
  const content = raw && typeof raw === "object" ? (raw as { content?: Array<{ text?: string }> }).content : undefined;
  return content?.map((part) => part.text ?? "").join("\n") ?? "";
}

function parseSuggestion(text: string, threshold: number): AiGroupSuggestion {
  const parsed = JSON.parse(text) as { suggested_tagid?: number | null; confidence?: number; reason?: string };
  const confidence = Number(parsed.confidence ?? 0);
  return {
    suggestedTagid: confidence >= threshold ? parsed.suggested_tagid ?? null : null,
    confidence,
    reason: parsed.reason ?? ""
  };
}
