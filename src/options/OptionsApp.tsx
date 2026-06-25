import { useEffect, useState } from "preact/hooks";
import { DEFAULT_SETTINGS, sendRuntimeMessage, type Settings } from "@/src/shared/messages";

export default function OptionsApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void sendRuntimeMessage<Settings>({ type: "settings:get" }).then(setSettings);
  }, []);

  async function patch(patch: Partial<Settings>) {
    const next = await sendRuntimeMessage<Settings>({ type: "settings:patch", patch });
    setSettings(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  }

  return (
    <main class="bdg-options">
      <h1>Bili Dynamic Groups</h1>
      <section>
        <label>
          <span>同步间隔</span>
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
      </section>
      {saved ? <p>已保存</p> : null}
    </main>
  );
}
