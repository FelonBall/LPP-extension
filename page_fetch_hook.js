(() => {
  // The numeric segment after /proxy/ is an API version, e.g. /proxy/10/. Each
  // endpoint keeps a loose fallback so minor restructuring does not silence us.
  const RX_COURSE = /\/student\/proxy\/(?:\d+\/)?resultat\/internal\/studentenskurser\/egenkursinformation\/student\/[0-9a-f-]{36}\/kursUID\/[0-9a-f-]{36}/i;
  const RX_COURSE_FALLBACK = /\/egenkursinformation\/.*\/kursUID\/[0-9a-f-]{36}/i;

  // Loaded once on the course list page; covers every participation at once.
  const RX_PARTICIPATIONS = /\/student\/proxy\/(?:\d+\/)?studiedeltagande\/internal\/tillfallesdeltagande\/kurstillfallesdeltagande\/student\/[0-9a-f-]{36}/i;
  const RX_PARTICIPATIONS_FALLBACK = /\/kurstillfallesdeltagande\/student\/[0-9a-f-]{36}/i;

  const TARGET_ORIGIN = window.location.origin;

  function classify(url) {
    let path;
    try {
      path = new URL(url, location.origin).pathname;
    } catch {
      return null;
    }

    if (RX_COURSE.test(path) || RX_COURSE_FALLBACK.test(path)) {
      const parts = path.split("/");
      const i = parts.indexOf("kursUID");
      return { kind: "egenkursinformation", kursUID: i >= 0 ? parts[i + 1] : null };
    }

    if (RX_PARTICIPATIONS.test(path) || RX_PARTICIPATIONS_FALLBACK.test(path)) {
      return { kind: "tillfallesdeltaganden", kursUID: null };
    }

    return null;
  }

  function publish(hit, url, data) {
    window.postMessage(
      { source: "ladokpp", kind: hit.kind, url, kursUID: hit.kursUID, data },
      TARGET_ORIGIN
    );
  }

  const origFetch = window.fetch;
  window.fetch = async (...args) => {
    const res = await origFetch(...args);

    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      const hit = url ? classify(url) : null;
      if (hit) {
        const clone = res.clone();
        publish(hit, url, await clone.json());
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.warn("Ladok++ API format may have changed (JSON parse error)");
      } else if (err.name !== "TypeError") {
        console.debug("Ladok++ fetch hook error:", err.message);
      }
    }

    return res;
  };

  // Hook XHR (site appears to use it in some flows)
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ladokppUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        const url = typeof this.__ladokppUrl === "string" ? this.__ladokppUrl : null;
        const hit = url ? classify(url) : null;
        if (!hit) return;
        publish(hit, url, JSON.parse(this.responseText));
      } catch (err) {
        if (err instanceof SyntaxError) {
          console.warn("Ladok++ API format may have changed (XHR parse error)");
        }
      }
    });

    return origSend.apply(this, args);
  };
})();
