const STORAGE_KEY = "ladokpp.courses"; // object: { [kursUID]: miniCourse }
const PARTICIPATIONS_KEY = "ladokpp.participations"; // { [utbildningUID]: { courseCode, started, carriesResults } }
const SCAN_KEY = "ladokpp.scan"; // { running, stopping, total, done, tabIds } while a scan is in flight
const TAB_THROTTLE_MS = 500; // Delay between opening tabs to avoid hammering the server
const TAB_WAIT_FOR_COMPLETE_MS = 12000; // Max wait for a tab to finish loading
const POST_COMPLETE_GRACE_MS = 900; // Give content scripts time to run before closing
const SCAN_CONCURRENCY = 3; // Number of tabs to scan in parallel

// Progress rides on storage.onChanged, which both consumers already listen to.
let scan = null; // { total, done, cancelled, tabIds:Set }

const closeTabs = (ids) =>
  Promise.all(ids.map(id => chrome.tabs.remove(id).catch(() => {})));

// A scan cannot outlive the worker; close any tabs the previous one left open.
(async () => {
  const stale = (await chrome.storage.local.get(SCAN_KEY))[SCAN_KEY];
  if (!stale || scan) return; // a scan started meanwhile owns the key now
  await closeTabs(stale.tabIds ?? []);
  if (!scan) await chrome.storage.local.remove(SCAN_KEY);
})();

// Serialized so a late progress write cannot land after the final remove.
let publishQueue = Promise.resolve();
function publishScan(s) {
  publishQueue = publishQueue.then(async () => {
    if (!s) return chrome.storage.local.remove(SCAN_KEY);
    if (s !== scan) return;
    return chrome.storage.local.set({
      [SCAN_KEY]: {
        running: true,
        // Stays set while workers finish the tab they are on.
        stopping: s.cancelled,
        total: s.total,
        done: s.done,
        tabIds: [...s.tabIds]
      }
    });
  }).catch(() => {});
  return publishQueue;
}

async function stopScan() {
  if (!scan) return;
  scan.cancelled = true;
  await publishScan(scan);

  const ids = [...scan.tabIds];
  scan.tabIds.clear();
  await closeTabs(ids);
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

async function openTabCollectAndClose(url, s) {
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab?.id;
  if (!tabId) return false;

  // Tracked so a stop — or a service-worker restart — can close tabs still loading.
  s.tabIds.add(tabId);
  await publishScan(s);

  const completed = await waitForTabComplete(tabId, TAB_WAIT_FOR_COMPLETE_MS);
  if (completed && !s.cancelled) {
    await new Promise((r) => setTimeout(r, POST_COMPLETE_GRACE_MS));
  }

  s.tabIds.delete(tabId);
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

    // Full snapshot: replace, not merge. Skipped when identical to avoid a rebuild.
    if (msg?.type === "LADOKPP_SAVE_PARTICIPATIONS") {
      const p = msg.payload;
      if (p && typeof p === "object") {
        const prev = (await chrome.storage.local.get(PARTICIPATIONS_KEY))[PARTICIPATIONS_KEY];
        if (JSON.stringify(prev) !== JSON.stringify(p)) {
          await chrome.storage.local.set({ [PARTICIPATIONS_KEY]: p });
        }
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "LADOKPP_STOP_SCAN") {
      await stopScan();
      sendResponse({ ok: true });
      return;
    }

    // Optional: open a list of URLs to trigger data collection
    if (msg?.type === "LADOKPP_SCAN_URLS") {
      const queue = (Array.isArray(msg.urls) ? msg.urls : []).filter(u => typeof u === "string");

      if (scan) {
        sendResponse({ ok: false, error: "scan_already_running" });
        return;
      }

      // Local ref: the finally below nulls `scan` while surviving workers still run.
      const s = { total: queue.length, done: 0, cancelled: false, tabIds: new Set() };
      scan = s;
      await publishScan(s);

      const worker = async () => {
        while (queue.length > 0 && !s.cancelled) {
          const url = queue.shift();
          try {
            await openTabCollectAndClose(url, s);
          } catch (err) {
            // One tab failing to open must not abandon the rest of the queue.
            console.debug("Ladok++ scan: tab failed", err?.message ?? err);
          }
          s.done++;
          // Not awaited; nothing here depends on the write.
          publishScan(s);
          if (queue.length > 0 && !s.cancelled) {
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
        sendResponse({ ok: true, done: s.done, cancelled: s.cancelled });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      } finally {
        // Stop survivors so they cannot open tabs after the key is cleared.
        s.cancelled = true;
        await closeTabs([...s.tabIds]);
        if (scan === s) scan = null;
        await publishScan(null);
      }
      return;
    }

    sendResponse({ ok: false, error: "unknown_message" });
  })();

  return true; // keep message channel open for async sendResponse
});
