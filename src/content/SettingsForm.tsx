import { useEffect, useState } from "preact/hooks";
import { DEFAULT_SETTINGS, sendRuntimeMessage, type Settings } from "@/src/shared/messages";

/**
 * The settings fields, shared by the standalone options page and the in-dashboard
 * settings panel so the two never drift. Loads + persists via the settings messages;
 * `onChange` lets a host (e.g. the dashboard) react to changes such as the sync interval.
 */
export function SettingsForm({ onChange }: { onChange?: (settings: Settings) => void }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void sendRuntimeMessage<Settings>({ type: "settings:get" })
      .then((next) => {
        setSettings(next);
        onChange?.(next);
      })
      .catch(() => {});
  }, []);

  async function patch(part: Partial<Settings>) {
    try {
      const next = await sendRuntimeMessage<Settings>({ type: "settings:patch", patch: part });
      setSettings(next);
      onChange?.(next);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1200);
    } catch {
      /* best-effort; the standalone options page has no error surface either */
    }
  }

  return (
    <>
      <label>
        <span>同步间隔（分钟）</span>
        <input
          type="number"
          min="30"
          step="30"
          value={settings.syncIntervalMinutes}
          onChange={(event) => void patch({ syncIntervalMinutes: Number((event.currentTarget as HTMLInputElement).value) })}
        />
      </label>
      <label>
        <span>AI 分组建议</span>
        <input
          type="checkbox"
          checked={settings.enableAiSuggestions}
          onChange={(event) => void patch({ enableAiSuggestions: (event.currentTarget as HTMLInputElement).checked })}
        />
      </label>
      <label>
        <span>API Key</span>
        <input
          type="password"
          value={settings.aiApiKey}
          onInput={(event) => setSettings({ ...settings, aiApiKey: (event.currentTarget as HTMLInputElement).value })}
          onBlur={() => void patch({ aiApiKey: settings.aiApiKey })}
        />
      </label>
      <label>
        <span>模型</span>
        <input
          value={settings.aiModel}
          onInput={(event) => setSettings({ ...settings, aiModel: (event.currentTarget as HTMLInputElement).value })}
          onBlur={() => void patch({ aiModel: settings.aiModel })}
        />
      </label>
      <label>
        <span>置信阈值</span>
        <input
          type="number"
          min="0"
          max="1"
          step="0.05"
          value={settings.confidenceThreshold}
          onChange={(event) => void patch({ confidenceThreshold: Number((event.currentTarget as HTMLInputElement).value) })}
        />
      </label>
      {saved ? <p class="bdg-settings-saved">已保存</p> : null}
    </>
  );
}
