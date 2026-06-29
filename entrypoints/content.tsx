import { sendRuntimeMessage } from "@/src/shared/messages";
import "@/src/content/floating.css";

const POSITION_KEY = "fabPosition";
const DRAG_THRESHOLD = 5; // px of movement before a press counts as a drag, not a click

export default defineContentScript({
  // Only the dynamic feed page — injecting on the homepage / video pages just risked
  // covering their controls without adding value.
  matches: ["https://t.bilibili.com/*"],
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
  button.title = "打开分组面板（可拖动）";
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
  document.body.appendChild(button);

  makeDraggable(button);

  button.addEventListener("click", (event) => {
    // A drag ends with a click event too; swallow it so dragging never opens the panel.
    if (button.dataset.dragged === "1") {
      button.dataset.dragged = "";
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    void sendRuntimeMessage({ type: "dashboard:open" }).catch(() => undefined);
  });

  void restorePosition(button);
  window.addEventListener("resize", () => clampIntoView(button));
}

function makeDraggable(button: HTMLButtonElement) {
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    moved = false;
    button.dataset.dragged = ""; // reset so a stuck flag can't swallow a real click
    const rect = button.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  });

  button.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!moved && Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
    moved = true;
    setPosition(button, startLeft + dx, startTop + dy);
  });

  const end = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try {
      button.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    if (moved) {
      button.dataset.dragged = "1";
      void savePosition(button);
    }
  };
  button.addEventListener("pointerup", end);
  button.addEventListener("pointercancel", end);
}

// Switch from the CSS bottom/right anchor to explicit left/top, clamped to the viewport.
function setPosition(button: HTMLButtonElement, left: number, top: number) {
  const maxLeft = Math.max(0, window.innerWidth - button.offsetWidth);
  const maxTop = Math.max(0, window.innerHeight - button.offsetHeight);
  const x = Math.min(Math.max(0, left), maxLeft);
  const y = Math.min(Math.max(0, top), maxTop);
  button.style.left = `${x}px`;
  button.style.top = `${y}px`;
  button.style.right = "auto";
  button.style.bottom = "auto";
}

function clampIntoView(button: HTMLButtonElement) {
  if (!button.style.left) return; // still on the default anchor; nothing to clamp
  setPosition(button, Number.parseFloat(button.style.left), Number.parseFloat(button.style.top));
}

async function savePosition(button: HTMLButtonElement) {
  try {
    await chrome.storage.local.set({
      [POSITION_KEY]: { left: Number.parseFloat(button.style.left), top: Number.parseFloat(button.style.top) }
    });
  } catch {
    /* ignore */
  }
}

async function restorePosition(button: HTMLButtonElement) {
  try {
    const stored = await chrome.storage.local.get(POSITION_KEY);
    const pos = stored[POSITION_KEY] as { left?: number; top?: number } | undefined;
    if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
      setPosition(button, pos.left, pos.top);
    }
  } catch {
    /* ignore */
  }
}
