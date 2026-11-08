const api = globalThis.browser ?? globalThis.chrome;
const D = globalThis.FF_DEFAULTS;
const $ = (id) => document.getElementById(id);

const FINN_URL = /^https:\/\/www\.finn\.no\//;
// Mens dyp sjekk henter annonser i bakgrunnen, oppdateres statusen jevnlig.
const PENDING_POLL_MS = 1000;
const FLASH_MS = 1500;

let saved = null; // innstillingene som faktisk er i bruk (lagret)

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function parseRules() {
  return $("rules").value.split("\n").map((l) => l.trim()).filter(Boolean);
}

const selectedMode = () => document.querySelector('input[name="mode"]:checked').value;

function readForm() {
  return {
    enabled: $("enabled").checked,
    mode: selectedMode(),
    deep: $("deep").checked,
    rules: parseRules(),
    profiles: CategoryForm.read()
  };
}

function validate(rules) {
  const bad = [];
  for (const line of rules) {
    const body = line.startsWith("!") ? line.slice(1).trim() : line;
    const m = body.match(/^\/(.+)\/([a-z]*)$/);
    if (!m) continue;
    try {
      new RegExp(m[1], m[2]);
    } catch (e) {
      bad.push(`Ugyldig regex: ${line} (${e.message})`);
    }
  }
  $("errors").textContent = bad.join("\n");
}

function showRuleCount(rules) {
  const active = rules.filter((l) => !l.startsWith("#"));
  const exceptions = active.filter((l) => l.startsWith("!")).length;
  const parts = [plural(active.length - exceptions, "regel", "regler")];
  if (exceptions) parts.push(plural(exceptions, "unntak", "unntak"));
  $("rule-count").textContent = parts.join(" · ");
}

const isDirty = () => JSON.stringify(readForm()) !== JSON.stringify(saved);

function updateDirty() {
  const dirty = isDirty();
  $("apply").classList.toggle("dirty", dirty);
  $("apply").title = dirty ? "Du har endringer som ikke er tatt i bruk ennå" : "Kjør filteret på nytt";
}

function onFormChange() {
  const rules = parseRules();
  validate(rules);
  showRuleCount(rules);
  document.body.classList.toggle("off", !$("enabled").checked);
  updateDirty();
}

let flashTimer;
function flash(msg) {
  $("flash").textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => ($("flash").textContent = ""), FLASH_MS);
}

// tone: "ok" | "warn" | "error" | "neutral"
function showStatus(tone, main, detail = "") {
  $("status-card").dataset.tone = tone;
  $("status-main").textContent = main;
  $("status-detail").textContent = detail;
}

async function apply() {
  const next = readForm();
  await api.storage.sync.set(next);
  saved = next;
  updateDirty();
  flash("Oppdatert ✓");
  await askTab("ff-rerun");
}

function showPageStatus(r) {
  if (!r.enabled) {
    showStatus("neutral", "Filteret er slått av");
    return;
  }
  if (r.detailPage) {
    showStatus("neutral", "Dette er en annonse", "Filteret virker på søkeresultater.");
    return;
  }
  if (r.cards === 0) {
    showStatus("warn", "Fant ingen annonser på siden", "Er dette en søkeside?");
    return;
  }
  const verb = r.mode === "hide" ? "skjult" : "markert";
  const details = [];
  if (r.profile) {
    details.push(`Profil: ${r.profile}${r.warned ? ` · ${plural(r.warned, "advarsel", "advarsler")}` : ""}`);
    details.push("De generelle reglene er av i dette søket.");
  } else {
    const selected = CategoryForm.selectedLabels(saved.profiles);
    if (selected.length) details.push(`Profilen (${selected.join(", ")}) gjelder ikke dette søket.`);
  }
  if (r.pending > 0) details.push(`Sjekker ${plural(r.pending, "annonsetekst", "annonsetekster")} i bakgrunnen …`);
  if (r.count === 0 && !r.deep) {
    details.push("Tips: slå på «Sjekk annonseteksten» – ord som «rep.objekt» står ofte bare i beskrivelsen.");
  }
  showStatus("ok", `${r.count} av ${plural(r.cards, "annonse", "annonser")} ${verb}`, details.join("\n"));
}

function setCollapsed(section, collapsed) {
  section.classList.toggle("collapsed", collapsed);
  section.querySelector(".collapse").setAttribute("aria-expanded", String(!collapsed));
}

// Tilpasser popupen til søket i fanen. Utvidet/sammenlagt settes bare én gang
// per åpning, så brukerens egne klikk ikke overstyres når statusen oppdateres.
let contextApplied = false;
function applyContext(r) {
  $("rules-section").hidden = Boolean(r.profile);
  if (contextApplied) return;
  contextApplied = true;
  if (r.category) CategoryForm.showCategory(r.category);
  setCollapsed($("cat-section"), !r.category);
  setCollapsed($("rules-section"), false);
}

let pollTimer;
async function askTab(type) {
  clearTimeout(pollTimer);
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  // Uten tilgang til siden skjuler nettleseren adressen for utvidelsen.
  if (!tab || !tab.url) {
    showStatus("error", "Ingen tilgang til denne fanen", "Gi Finn-filter tilgang til www.finn.no og last siden på nytt.");
    return;
  }
  if (!FINN_URL.test(tab.url)) {
    showStatus("neutral", "Ikke på finn.no", "Åpne et søk på finn.no for å se filteret i aksjon.");
    return;
  }
  let r;
  try {
    r = await api.tabs.sendMessage(tab.id, { type });
  } catch (e) {
    showStatus(
      "error",
      "Filteret kjører ikke på denne siden",
      `Last siden på nytt. Hjelper ikke det: sjekk at Finn-filter har tilgang til www.finn.no. (${e.message})`
    );
    return;
  }
  if (!r) {
    showStatus("error", "Fikk ikke svar fra siden", "Last siden på nytt.");
    return;
  }
  applyContext(r);
  showPageStatus(r);
  if (r.pending > 0) pollTimer = setTimeout(() => askTab("ff-count"), PENDING_POLL_MS);
}

function fill(s) {
  $("enabled").checked = s.enabled;
  $(`mode-${s.mode}`).checked = true;
  $("deep").checked = s.deep;
  $("rules").value = s.rules.join("\n");
  CategoryForm.init(s.profiles, onFormChange);
}

async function init() {
  fill({ ...D, ...(await api.storage.sync.get(D)) });
  saved = readForm();
  onFormChange();
  requestAnimationFrame(() => document.body.classList.add("ready"));

  for (const el of document.querySelectorAll('#enabled, #deep, input[name="mode"]')) {
    el.addEventListener("change", onFormChange);
  }
  $("rules").addEventListener("input", onFormChange);
  for (const btn of document.querySelectorAll(".section-head .collapse")) {
    const section = btn.closest("section");
    btn.addEventListener("click", () => setCollapsed(section, !section.classList.contains("collapsed")));
  }
  $("apply").addEventListener("click", () =>
    apply().catch((e) => {
      showStatus("error", "Kunne ikke oppdatere", e.message);
      console.error(e);
    })
  );
  $("reset").addEventListener("click", () => {
    $("rules").value = D.rules.join("\n");
    onFormChange();
  });

  await askTab("ff-count");
}

init().catch((e) => {
  showStatus("error", "Feil i Finn-filter", e.message);
  console.error(e);
});
