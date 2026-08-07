const STORAGE_KEY = "ladokpp.courses";
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

async function render() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const courses = Object.values(stored[STORAGE_KEY] ?? {});

  document.getElementById("courseCount").textContent = courses.length;

  const lastSeenEl = document.getElementById("lastSeen");
  const emptyHintEl = document.getElementById("emptyHint");

  if (courses.length === 0) {
    lastSeenEl.classList.add("hidden");
    emptyHintEl.classList.remove("hidden");
    return;
  }

  emptyHintEl.classList.add("hidden");
  lastSeenEl.classList.remove("hidden");

  const latest = courses
    .map(c => c?.lastSeenAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  const when = latest ? formatLastSeen(latest) : null;
  lastSeenEl.textContent = when ? `Senast uppdaterad ${when}` : "";
}

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
