import { sendRuntimeMessage } from "@/src/shared/messages";
import "@/src/content/floating.css";

export default defineContentScript({
  matches: ["https://t.bilibili.com/*", "https://www.bilibili.com/*", "https://space.bilibili.com/*"],
  runAt: "document_idle",
  main() {
    mountFloatingButton();
  }
});

function mountFloatingButton() {
  if (document.getElementById("bili-dynamic-groups-fab")) return;

  const button = document.createElement("button");
  button.id = "bili-dynamic-groups-fab";
  button.type = "button";
  button.title = "打开分组面板";
  button.setAttribute("aria-label", "打开分组面板");
  button.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
    <span>分组</span>
  `;
  button.addEventListener("click", () => {
    void sendRuntimeMessage({ type: "dashboard:open" }).catch(() => undefined);
  });
  document.body.appendChild(button);
}
