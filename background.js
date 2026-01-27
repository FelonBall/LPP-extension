const STORAGE_KEY = "ladokpp.courses"; // object: { [kursUID]: miniCourse }
const TAB_THROTTLE_MS = 500; // Delay between opening tabs to avoid hammering the server
const TAB_WAIT_FOR_COMPLETE_MS = 12000; // Max wait for a tab to finish loading
const POST_COMPLETE_GRACE_MS = 900; // Give content scripts time to run before closing

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

  const completed = await waitForTabComplete(tabId, TAB_WAIT_FOR_COMPLETE_MS);
  if (completed) {
    await new Promise((r) => setTimeout(r, POST_COMPLETE_GRACE_MS));
  }

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

    // Optional: open a list of URLs to trigger data collection
    if (msg?.type === "LADOKPP_SCAN_URLS") {
      const urls = Array.isArray(msg.urls) ? msg.urls : [];
      let opened = 0;

      // throttle: open sequentially to avoid overwhelming the server
      for (const url of urls) {
        if (typeof url !== "string") continue;
        opened += 1;
        await openTabCollectAndClose(url);
        await new Promise((r) => setTimeout(r, TAB_THROTTLE_MS));
      }

      sendResponse({ ok: true, opened });
      return;
    }

    sendResponse({ ok: false, error: "unknown_message" });
  })();

  return true; // keep message channel open for async sendResponse
});
