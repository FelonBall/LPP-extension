const DEFAULTS = {
  levelExponent: 1.2,
  hideLabel: true,
  showXpToNext: true,
  epicMode: false,
  showStats: true,
  termBoundaryMode: "week",
  academicYearStartWeek: 36,
  includeSummerWeeks: true,
  dateBasis: "exam",
};

const api = globalThis.chrome ?? globalThis.browser;

function $(id) { return document.getElementById(id); }

function readForm() {
  const levelExponent = Number($("levelExponent").value);
  const academicYearStartWeek = Number($("academicYearStartWeek").value);

  return {
    levelExponent: Number.isFinite(levelExponent) && levelExponent >= 1 ? levelExponent : DEFAULTS.levelExponent,
    hideLabel: $("hideLabel").checked,
    showXpToNext: $("showXpToNext").checked,
    epicMode: $("epicMode").checked,
    showStats: $("showStats").checked,
    termBoundaryMode: $("termBoundaryMode").value || DEFAULTS.termBoundaryMode,
    academicYearStartWeek: Number.isFinite(academicYearStartWeek) ? Math.min(53, Math.max(1, academicYearStartWeek)) : DEFAULTS.academicYearStartWeek,
    includeSummerWeeks: $("includeSummerWeeks").checked,
    dateBasis: $("dateBasis").value || DEFAULTS.dateBasis,
  };
}

function writeForm(cfg) {
  $("levelExponent").value = cfg.levelExponent ?? DEFAULTS.levelExponent;
  $("hideLabel").checked = !!cfg.hideLabel;
  $("showXpToNext").checked = !!cfg.showXpToNext;
  $("epicMode").checked = !!cfg.epicMode;
  $("showStats").checked = cfg.showStats ?? DEFAULTS.showStats;
  $("termBoundaryMode").value = cfg.termBoundaryMode ?? DEFAULTS.termBoundaryMode;
  $("academicYearStartWeek").value = cfg.academicYearStartWeek ?? DEFAULTS.academicYearStartWeek;
  $("includeSummerWeeks").checked = cfg.includeSummerWeeks ?? DEFAULTS.includeSummerWeeks;
  $("dateBasis").value = cfg.dateBasis ?? DEFAULTS.dateBasis;
}

function setStatus(msg) {
  $("status").textContent = msg;
  if (msg) setTimeout(() => ($("status").textContent = ""), 1500);
}

async function load() {
  await api.storage.sync.get(DEFAULTS, (cfg) => writeForm(cfg));
}

async function save() {
  const cfg = readForm();
  await api.storage.sync.set(cfg, () => setStatus("Sparat!"));
}

async function reset() {
  await api.storage.sync.set(DEFAULTS, () => {
    writeForm(DEFAULTS);
    setStatus("Återställt!");
  });
}

$("save").addEventListener("click", save);
$("reset").addEventListener("click", reset);

load();
