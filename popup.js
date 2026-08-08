const STORAGE_KEY = "ladokpp.courses";
const PARTICIPATIONS_KEY = "ladokpp.participations";
const SCAN_KEY = "ladokpp.scan";
const LADOK_URL = "https://student.ladok.se/student/app/studentwebb/min-utbildning/alla";

function formatLastSeen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just nu";
  if (mins < 60) return `för ${mins} min sedan`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `för ${hours} ${hours === 1 ? "timme" : "timmar"} sedan`;
  const days = Math.round(hours / 24);
  if (days < 30) return `för ${days} ${days === 1 ? "dag" : "dagar"} sedan`;
  return d.toLocaleDateString("sv-SE");
}

const show = (id, visible) =>
  document.getElementById(id).classList.toggle("hidden", !visible);

function renderScan(scan) {
  const running = !!scan?.running;
  show("scanCard", running);
  if (!running) return;

  const { done = 0, total = 0, stopping = false } = scan;
  document.getElementById("scanCounter").textContent = `${done} / ${total}`;
  document.getElementById("scanFill").style.width =
    total > 0 ? `${Math.round((done / total) * 100)}%` : "0%";

  // From published state, since workers keep publishing after a stop.
  const stop = document.getElementById("stopScan");
  stop.disabled = stopping;
  stop.textContent = stopping ? "Stoppar…" : "Stoppa skanning";
}

async function render() {
  const stored = await chrome.storage.local.get([STORAGE_KEY, SCAN_KEY]);
  const courses = Object.values(stored[STORAGE_KEY] ?? {});
  const hasData = courses.length > 0;

  renderScan(stored[SCAN_KEY]);

  document.getElementById("courseCount").textContent = courses.length;
  document.getElementById("confirmCount").textContent =
    `${courses.length} ${courses.length === 1 ? "kurs" : "kurser"}`;

  show("emptyHint", !hasData);
  show("lastSeen", hasData);
  show("clearRow", hasData);
  show("confirmRow", false);

  if (!hasData) return;

  const latest = courses.reduce(
    (max, c) => (c?.lastSeenAt > max ? c.lastSeenAt : max),
    ""
  );

  const when = latest ? formatLastSeen(latest) : null;
  document.getElementById("lastSeen").textContent =
    when ? `Senast uppdaterad ${when}` : "";
}

document.getElementById("stopScan").addEventListener("click", function () {
  // Optimistic; the published `stopping` flag takes over from the next render.
  this.disabled = true;
  this.textContent = "Stoppar…";
  chrome.runtime.sendMessage({ type: "LADOKPP_STOP_SCAN" });
});

// The scan outlives this popup. Both keys change per course, so coalesce.
let renderQueued = false;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes[SCAN_KEY] && !changes[STORAGE_KEY] && !changes[PARTICIPATIONS_KEY]) return;
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    render();
  });
});

// Two-step confirm: the popup is one click from the toolbar.
document.getElementById("clearBtn").addEventListener("click", () => {
  show("clearRow", false);
  show("confirmRow", true);
  document.getElementById("cancelClear").focus();
});

document.getElementById("cancelClear").addEventListener("click", () => {
  show("confirmRow", false);
  show("clearRow", true);
});

document.getElementById("confirmClear").addEventListener("click", async () => {
  // Only the saved course data — settings live in storage.sync and stay.
  await chrome.storage.local.remove([STORAGE_KEY, PARTICIPATIONS_KEY]);
  await render();
});

document.getElementById("openOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// Focus an existing Ladok tab rather than stacking duplicates.
document.getElementById("openLadok").addEventListener("click", async () => {
  const [existing] = await chrome.tabs.query({
    url: "https://student.ladok.se/student/app/studentwebb/min-utbildning/*"
  });

  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: LADOK_URL });
  }
  window.close();
});

render();
