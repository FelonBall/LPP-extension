// 1) Inject page hook into the page context (use src to avoid CSP issues)
(function inject() {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("page_fetch_hook.js");
  s.async = false;
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();

// 2) Extractor (minidata)
function pickCourseVersion(payload) {
  const versions = payload?.Kursversioner ?? [];
  return versions.find(v => v.ArAktuellVersion) ?? versions[0] ?? null;
}

function parseCreditsValue(val) {
  if (val == null) return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  const m = String(val).match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function extractCreditsFromOmfattning(omf) {
  if (omf == null) return null;
  if (typeof omf === "number" || typeof omf === "string") return parseCreditsValue(omf);
  if (typeof omf !== "object") return null;

  // Tightened to fields seen in your real responses
  const directKeys = ["parsedValue", "Omfattning"];
  for (const k of directKeys) {
    if (k in omf) {
      const n = parseCreditsValue(omf[k]);
      if (n != null) return n;
    }
  }

  // Fallback: pick first numeric-like value from object
  for (const v of Object.values(omf)) {
    const n = parseCreditsValue(v);
    if (n != null) return n;
  }

  return null;
}

function mapResult(r) {
  if (!r) return null;
  return {
    grade: r.Betygsgradsobjekt?.Kod ?? null,
    examDate: r.Examinationsdatum ?? null,
    decisionDate: r.Beslutsdatum ?? null,
    examinedCredits: r.ExamineradOmfattning ?? null
  };
}

function extractMiniDataset(payload, kursUID) {
  const v = pickCourseVersion(payload);
  if (!v) return null;

  const course = v.VersionensKurs ?? {};
  const kt = payload.GallandeKurstillfalle ?? {};

  const courseResult = mapResult(course.ResultatPaUtbildning?.SenastAttesteradeResultat);

  const modules = (v.VersionensModuler ?? []).map(m => {
    const latest = mapResult(m.ResultatPaUtbildning?.SenastAttesteradeResultat);

    const attempts = [
      ...(m.ResultatPaUtbildning?.OvrigaResultat ?? []).map(mapResult),
      ...(latest ? [latest] : [])
    ]
      .filter(Boolean)
      .sort((a, b) => (a.examDate ?? "").localeCompare(b.examDate ?? ""));

    console.log("Ladok++ content script loaded");
    return {
      moduleCode: m.Kod ?? null,
      name: m.Utbildningsinstansbenamningar?.sv ?? m.Utbildningsinstansbenamningar?.en ?? "",
      credits: extractCreditsFromOmfattning(m.Omfattning),
      creditsAwarded: parseCreditsValue(latest?.examinedCredits),
      latest,
      attempts
    };
  });

  const courseCredits =
    extractCreditsFromOmfattning(course.Omfattning) ??
    extractCreditsFromOmfattning(kt.Omfattning);
  const courseCreditsAwarded = parseCreditsValue(courseResult?.examinedCredits);

  return {
    kursUID,
    kurstillfalleUID: kt.Uid ?? v.GallandeKurstillfalleUID ?? null,
    start: kt.Startdatum ?? null,
    end: kt.Slutdatum ?? null,
    courseCode: course.Kod ?? null,
    courseName: course.Utbildningsinstansbenamningar?.sv ?? course.Utbildningsinstansbenamningar?.en ?? "",
    courseCredits,
    courseCreditsAwarded,
    courseResult,
    modules,
    lastSeenAt: new Date().toISOString()
  };
}

// 3) Listen for page hook messages and forward to background
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== "ladokpp" || msg.kind !== "egenkursinformation") return;

  // Never use / store msg.data.StudentUID etc — extractor ignores it.
  const mini = extractMiniDataset(msg.data, msg.kursUID);
  console.log("Ladok++ content script loaded");

  if (!mini?.kursUID) return;

  chrome.runtime.sendMessage({
    type: "LADOKPP_SAVE_COURSE",
    payload: mini
  });
});
