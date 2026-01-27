(() => {
  const RX = /\/student\/proxy\/resultat\/internal\/studentenskurser\/egenkursinformation\/student\/[0-9a-f-]{36}\/kursUID\/[0-9a-f-]{36}/i;

  function shouldCapture(url) {
    try {
      const u = new URL(url, location.origin);
      return RX.test(u.pathname);
    } catch {
      return false;
    }
  }

  function extractKursUID(url) {
    const u = new URL(url, location.origin);
    const parts = u.pathname.split("/");
    const i = parts.indexOf("kursUID");
    return i >= 0 ? parts[i + 1] : null;
  }

  const origFetch = window.fetch;
  window.fetch = async (...args) => {
    const res = await origFetch(...args);

    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      if (url && shouldCapture(url)) {
        const kursUID = extractKursUID(url);
        const clone = res.clone();
        const data = await clone.json();

        window.postMessage(
          {
            source: "ladokpp",  
            kind: "egenkursinformation",
            url,
            kursUID,
            data
          },
          "*"
        );
      }
    } catch (err) {
      // Log errors for debugging (network issues, API changes, etc.)
      if (err instanceof SyntaxError) {
        console.warn("Ladok++ API format may have changed (JSON parse error)");
      } else if (err.name !== "TypeError") {
        // Ignore expected TypeError from res.clone() on non-JSON responses
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
        if (!url || !shouldCapture(url)) return;
        const kursUID = extractKursUID(url);
        const data = JSON.parse(this.responseText);

        window.postMessage(
          {
            source: "ladokpp",
            kind: "egenkursinformation",
            url,
            kursUID,
            data
          },
          "*"
        );
      } catch (err) {
        if (err instanceof SyntaxError) {
          console.warn("Ladok++ API format may have changed (XHR parse error)");
        }
      }
    });

    return origSend.apply(this, args);
  };
})();
