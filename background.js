const STORAGE_KEY = "ladokpp.courses"; // object: { [kursUID]: miniCourse }
const PARTICIPATIONS_KEY = "ladokpp.participations"; // { [utbildningUID]: { courseCode, started, registrations } }
const SCAN_KEY = "ladokpp.scan"; // { running, total, done } while a scan is in flight
const TAB_THROTTLE_MS = 500; // Delay between opening tabs to avoid hammering the server
const TAB_WAIT_FOR_COMPLETE_MS = 12000; // Max wait for a tab to finish loading
const POST_COMPLETE_GRACE_MS = 900; // Give content scripts time to run before closing
const SCAN_CONCURRENCY = 3; // Number of tabs to scan in parallel

// Progress is published to storage rather than messaged, so the widget and the
// popup both pick it up through the storage.onChanged listeners they already have.
let scan = null; // { total, done, cancelled, tabIds:Set }

// A scan cannot outlive the service worker, so any key found at startup is stale.
chrome.storage.local.remove(SCAN_KEY);

async function publishScan() {
  if (!scan) {
    await chrome.storage.local.remove(SCAN_KEY);
    return;
  }
  await chrome.storage.local.set({
    [SCAN_KEY]: { running: true, total: scan.total, done: scan.done }
  });
}

async function stopScan() {
  if (!scan) return;
  scan.cancelled = true;

  const ids = [...scan.tabIds];
  scan.tabIds.clear();
  await Promise.all(ids.map(id => chrome.tabs.remove(id).catch(() => {})));
}

async function getCourses() {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  return r[STORAGE_KEY] ?? {};
}

async function setCourses(courses) {
  // Basic validation: ensure courses is an object
  if (typeof courses !== "object" || courses === null) {
    console.warn("Ladok++ setCourses: Invalid courses object");
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: courses });
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(ok);
    };

    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") finish(true);
    };
    const onRemoved = (id) => {
      if (id === tabId) finish(false);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

async function openTabCollectAndClose(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab?.id;
  if (!tabId) return false;

  // Tracked so a stop can close tabs that are still loading.
  scan?.tabIds.add(tabId);

  const completed = await waitForTabComplete(tabId, TAB_WAIT_FOR_COMPLETE_MS);
  if (completed && !scan?.cancelled) {
    await new Promise((r) => setTimeout(r, POST_COMPLETE_GRACE_MS));
  }

  scan?.tabIds.delete(tabId);
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Ignore if already closed
  }

  return completed;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "LADOKPP_SAVE_COURSE") {
      const courses = await getCourses();
      const c = msg.payload;

      // Upsert (keep latest)
      courses[c.kursUID] = c;
      await setCourses(courses);

      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "LADOKPP_GET_COURSES") {
      const courses = await getCourses();
      sendResponse({ ok: true, courses });
      return;
    }

    // A full snapshot of every participation, so replace rather than merge —
    // a dropped course should disappear here too.
    if (msg?.type === "LADOKPP_SAVE_PARTICIPATIONS") {
      const p = msg.payload;
      if (p && typeof p === "object") {
        await chrome.storage.local.set({ [PARTICIPATIONS_KEY]: p });
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "LADOKPP_STOP_SCAN") {
      await stopScan();
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "LADOKPP_SCAN_STATUS") {
      sendResponse({
        ok: true,
        scan: scan ? { running: true, total: scan.total, done: scan.done } : null
      });
      return;
    }

    // Optional: open a list of URLs to trigger data collection
    if (msg?.type === "LADOKPP_SCAN_URLS") {
      const queue = (Array.isArray(msg.urls) ? msg.urls : []).filter(u => typeof u === "string");

      if (scan) {
        sendResponse({ ok: false, error: "scan_already_running" });
        return;
      }

      scan = { total: queue.length, done: 0, cancelled: false, tabIds: new Set() };
      await publishScan();

      let opened = 0;

      const worker = async () => {
        while (queue.length > 0 && !scan.cancelled) {
          const url = queue.shift();
          opened++;
          await openTabCollectAndClose(url);
          scan.done++;
          await publishScan();
          if (queue.length > 0 && !scan.cancelled) {
            await new Promise((r) => setTimeout(r, TAB_THROTTLE_MS));
          }
        }
      };

      // Stagger worker starts by TAB_THROTTLE_MS so the first tabs don't all open
      // simultaneously when queue.length <= SCAN_CONCURRENCY.
      const workerCount = Math.min(SCAN_CONCURRENCY, queue.length);
      const workers = Array.from({ length: workerCount }, (_, i) =>
        new Promise((r) => setTimeout(r, i * TAB_THROTTLE_MS)).then(worker)
      );
      try {
        await Promise.all(workers);
        sendResponse({ ok: true, opened, cancelled: scan.cancelled });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      } finally {
        scan = null;
        await publishScan();
      }
      return;
    }

    sendResponse({ ok: false, error: "unknown_message" });
  })();

  return true; // keep message channel open for async sendResponse
});
