// 1) Inject page hook into the page context (use src to avoid CSP issues)
(function inject() {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("page_fetch_hook.js");
  s.async = false;
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();

// 2) Extractor (minidata). Payload notes live in PAYLOAD.md, which is untracked.

// Warn once per field per session, so drift surfaces instead of becoming a null.
const seenDrift = new Set();
function noteDrift(field, context) {
  if (seenDrift.has(field)) return;
  seenDrift.add(field);
  console.warn(`Ladok++: expected field "${field}" is missing — Ladok's payload may have changed`, context);
}

function pickCourseVersion(payload) {
  const versions = payload?.Kursversioner ?? [];
  return versions.find(v => v.ArAktuellVersion) ?? versions[0] ?? null;
}

// Tolerates object and string forms as well as the plain number seen today.
function parseCredits(val) {
  if (val == null) return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val === "object") {
    for (const v of Object.values(val)) {
      const n = parseCredits(v);
      if (n != null) return n;
    }
    return null;
  }
  const m = String(val).match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// A result carries no credit amount of its own; credits live on the module.
function mapResult(r) {
  if (!r) return null;
  const g = r.Betygsgradsobjekt ?? {};
  return {
    grade: g.Kod ?? null,
    passed: typeof g.GiltigSomSlutbetyg === "boolean" ? g.GiltigSomSlutbetyg : null,
    examDate: r.Examinationsdatum ?? null,
    decisionDate: r.Beslutsdatum ?? null,
    kurstillfalleUID: r.KurstillfalleUID ?? null
  };
}

// The grade-code list is only for course data stored before `passed` existed.
function isPassed(result) {
  if (!result) return false;
  if (typeof result.passed === "boolean") return result.passed;
  return ["G", "A", "B", "C", "D", "E"].includes(result.grade);
}

function extractMiniDataset(payload, kursUID) {
  const v = pickCourseVersion(payload);
  if (!v) return null;

  const course = v.VersionensKurs ?? {};
  const kt = payload.GallandeKurstillfalle ?? {};

  // Null for courses that are not yet finished.
  const courseResult = mapResult(course.ResultatPaUtbildning?.SenastAttesteradeResultat);

  // Known gaps: neither of these is extracted.
  if ((payload.ResultatUtanKopplingTillKursversion ?? []).length > 0) {
    console.warn("Ladok++: results outside the current course version are not captured", kursUID);
  }
  if ((course.Tillgodoraknanden ?? []).length > 0 || v.HarTillgodoraknandePaHelaKursen) {
    console.warn("Ladok++: credit transfers are not captured", kursUID);
  }

  const modules = (v.VersionensModuler ?? []).map(m => {
    const latest = mapResult(m.ResultatPaUtbildning?.SenastAttesteradeResultat);

    // OvrigaResultat holds the superseded attempts, newest-first.
    const attempts = [
      ...(m.ResultatPaUtbildning?.OvrigaResultat ?? []).map(mapResult),
      ...(latest ? [latest] : [])
    ]
      .filter(Boolean)
      .sort((a, b) => (a.examDate ?? "").localeCompare(b.examDate ?? ""));

    const credits = parseCredits(m.Omfattning);
    const gradeScale = m.Betygsskala?.Kod ?? null;

    if (credits == null && !m.GallerUtbildningUtanAngivenOmfattning) {
      noteDrift("VersionensModuler[].Omfattning", { kursUID, moduleCode: m.Kod });
    }
    if (gradeScale == null) noteDrift("VersionensModuler[].Betygsskala.Kod", { kursUID, moduleCode: m.Kod });
    if (latest && latest.passed == null) {
      noteDrift("Betygsgradsobjekt.GiltigSomSlutbetyg", { kursUID, moduleCode: m.Kod, grade: latest.grade });
    }

    return {
      moduleCode: m.Kod ?? null,
      name: m.Utbildningsinstansbenamningar?.sv ?? m.Utbildningsinstansbenamningar?.en ?? "",
      credits,
      gradeScale, // "AF" (graded) or "GU" (pass/fail)

      creditsAwarded: isPassed(latest) ? credits : 0,
      latest,
      attempts
    };
  });

  const courseCredits = parseCredits(course.Omfattning);
  if (courseCredits == null && !course.GallerUtbildningUtanAngivenOmfattning) {
    noteDrift("VersionensKurs.Omfattning", { kursUID, courseCode: course.Kod });
  }
  if (!kt.Startdatum || !kt.Slutdatum) {
    noteDrift("GallandeKurstillfalle.Start/Slutdatum", { kursUID, courseCode: course.Kod });
  }
  const moduleCreditsAwarded = modules.reduce((sum, m) => sum + (m.creditsAwarded ?? 0), 0);
  const courseCreditsAwarded = isPassed(courseResult)
    ? (courseCredits ?? moduleCreditsAwarded)
    : moduleCreditsAwarded;

  return {
    kursUID,
    kurstillfalleUID: kt.Uid ?? v.GallandeKurstillfalleUID ?? null,
    start: kt.Startdatum ?? null,
    end: kt.Slutdatum ?? null,
    courseCode: course.Kod ?? null,
    courseName: course.Utbildningsinstansbenamningar?.sv ?? course.Utbildningsinstansbenamningar?.en ?? "",
    courseCredits,
    courseCreditsAwarded,
    courseGradeScale: course.Betygsskala?.Kod ?? null,
    courseResult,
    modules,
    lastSeenAt: new Date().toISOString()
  };
}

function educationRule(u, name) {
  return (u?.Utbildningstyp?.RegelverkForUtbildningstyp?.Regelvarden ?? [])
    .find(r => r.Regelnamn === name)?.Varde;
}

// Not-started courses and result-less education types yield no payload, so the
// scan skips them. Flags are OR-ed per course and err towards scanning.
function extractParticipations(payload) {
  const rows = payload?.Tillfallesdeltaganden ?? [];
  const byCourse = new Map();

  // Fail open if Paborjad ever disappears, as carriesResults already does.
  const paborjadSeen = rows.some(d => typeof d.Paborjad === "boolean");
  if (rows.length > 0 && !paborjadSeen) {
    noteDrift("Tillfallesdeltaganden[].Paborjad", { rows: rows.length });
  }

  for (const d of rows) {
    const u = d.Utbildningsinformation ?? {};
    const uid = u.UtbildningUID;
    if (!uid) continue;

    const cur = byCourse.get(uid) ?? {
      courseCode: u.Utbildningskod ?? null,
      started: false,
      carriesResults: false
    };
    cur.started = cur.started || !paborjadSeen || !!d.Paborjad;
    // Absent for ordinary courses; only ever explicitly "false".
    cur.carriesResults =
      cur.carriesResults || educationRule(u, "commons.domain.regel.resultat") !== "false";
    byCourse.set(uid, cur);
  }

  return Object.fromEntries(byCourse);
}

// 3) Listen for page hook messages and forward to background.
// Same-origin only; a same-origin sender cannot be authenticated further.
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const msg = event.data;
  if (!msg || msg.source !== "ladokpp") return;

  if (msg.kind === "tillfallesdeltaganden") {
    const courses = extractParticipations(msg.data);
    if (Object.keys(courses).length === 0) return;
    chrome.runtime.sendMessage({ type: "LADOKPP_SAVE_PARTICIPATIONS", payload: courses });
    return;
  }

  if (msg.kind !== "egenkursinformation") return;

  // Never use / store msg.data.StudentUID etc — extractor ignores it.
  const mini = extractMiniDataset(msg.data, msg.kursUID);
  if (!mini?.kursUID) return;

  chrome.runtime.sendMessage({
    type: "LADOKPP_SAVE_COURSE",
    payload: mini
  });
});
