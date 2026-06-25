import type { DynamicRecord, GroupRecord, QuadrantSnapshot, UpRecord, ViewSource } from "@/src/types/domain";

export interface Settings {
  syncIntervalMinutes: number;
  enableAiSuggestions: boolean;
  aiProvider: "anthropic" | "custom";
  aiEndpoint: string;
  aiApiKey: string;
  aiModel: string;
  confidenceThreshold: number;
}

export const DEFAULT_SETTINGS: Settings = {
  syncIntervalMinutes: 60,
  enableAiSuggestions: false,
  aiProvider: "anthropic",
  aiEndpoint: "https://api.anthropic.com/v1/messages",
  aiApiKey: "",
  aiModel: "claude-haiku-4-5",
  confidenceThreshold: 0.68
};

export interface UiState {
  ups: UpRecord[];
  groups: GroupRecord[];
  meta: Record<string, unknown>;
}

export type RuntimeRequest =
  | { type: "state:get" }
  | { type: "sync:m1" }
  | { type: "tracking:view"; mid: number; source: ViewSource }
  | { type: "quadrants:get" }
  | { type: "settings:get" }
  | { type: "settings:patch"; patch: Partial<Settings> }
  | { type: "ai:suggest"; mid: number }
  | { type: "feed:get"; mids: number[]; limit?: number; before?: number; typeFilter?: "liveOnly" | "excludeLive" }
  | { type: "live:get" }
  | { type: "dashboard:open" }
  | { type: "cache:reset" };

export type RuntimeResponse =
  | { ok: true; data?: UiState | Settings | QuadrantSnapshot | DynamicRecord[] | unknown }
  | { ok: false; error: string };

export type ContentDynamic = Pick<DynamicRecord, "dynamicId" | "mid" | "pubTs" | "summary">;

export function sendRuntimeMessage<T>(message: RuntimeRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error ?? "Runtime message failed"));
        return;
      }
      resolve(response.data as T);
    });
  });
}
