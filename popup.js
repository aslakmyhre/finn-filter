const api = globalThis.browser ?? globalThis.chrome;
const D = globalThis.FF_DEFAULTS;
const $ = (id) => document.getElementById(id);

const FINN_URL = /^https:\/\/www\.finn\.no\//;
// Mens dyp sjekk henter annonser i bakgrunnen, oppdateres telleren jevnlig.
const PENDING_POLL_MS = 1000;
const FLASH_MS = 1500;

let saved = null; // innstillingene som faktisk er i bruk (lagret)

function parseRules() {
  return $("rules").value.split("\n").map((l) => l.trim()).filter(Boolean);
}

function readForm() {
  return {
    enabled: $("enabled").checked,
    mode: $("mode").value,
    deep: $("deep").checked,
    rules: parseRules()
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

const isDirty = () => JSON.stringify(readForm()) !== JSON.stringify(saved);

function updateDirty() {
  const dirty = isDirty();
  $("apply").classList.toggle("dirty", dirty);
  $("apply").textContent = dirty ? "Oppdater filter ●" : "Oppdater filter";
  $("apply").title = dirty ? "Du har endringer som ikke er tatt i bruk ennå" : "Kjør filteret på nytt";
}

function onFormChange() {
  validate(parseRules());
  updateDirty();
}

let flashTimer;
function flash(msg) {
  $("status").textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => ($("status").textContent = ""), FLASH_MS);
}

async function apply() {
  const next = readForm();
  await api.storage.sync.set(next);
  saved = next;
  updateDirty();
  flash("Oppdatert ✓");
  await askTab("ff-rerun");
}

function describe(r) {
  if (!r.enabled) return "Filteret er slått av.";
  const lines = [];
  const verb = r.mode === "hide" ? "Skjuler" : "Markerer";
  lines.push(`${verb} ${r.count} av ${r.cards} annonse${r.cards === 1 ? "" : "r"} på denne siden.`);
  if (r.pending > 0) lines.push(`Sjekker ${r.pending} annonsetekst${r.pending === 1 ? "" : "er"} i bakgrunnen …`);
  if (r.cards === 0 && !r.detailPage) lines.push("Fant ingen annonsekort – er dette en søkeside?");
  if (r.count === 0 && r.cards > 0 && !r.deep) {
    lines.push("Tips: slå på «Sjekk også teksten inne i annonsen» – ord som «rep.objekt» står ofte bare i beskrivelsen.");
  }
  return lines.join("\n");
}

let pollTimer;
async function askTab(type) {
  clearTimeout(pollTimer);
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  // Uten tilgang til siden skjuler nettleseren adressen for utvidelsen.
  if (!tab || !tab.url) {
    $("count").textContent =
      "Utvidelsen har ikke tilgang til denne fanen.\nGi Finn-filter tilgang til www.finn.no og last siden på nytt.";
    return;
  }
  if (!FINN_URL.test(tab.url)) {
    $("count").textContent = "Åpne et søk på finn.no for å se filteret i aksjon.";
    return;
  }
  let r;
  try {
    r = await api.tabs.sendMessage(tab.id, { type });
  } catch (e) {
    $("count").textContent =
      `Filteret kjører ikke på denne siden (${e.message}).\n` +
      "Last siden på nytt. Hjelper ikke det: sjekk at Finn-filter har tilgang til www.finn.no.";
    return;
  }
  if (!r) {
    $("count").textContent = "Fikk ikke svar fra siden. Last siden på nytt.";
    return;
  }
  $("count").textContent = describe(r);
  if (r.pending > 0) pollTimer = setTimeout(() => askTab("ff-count"), PENDING_POLL_MS);
}

function fill(s) {
  $("enabled").checked = s.enabled;
  $("mode").value = s.mode;
  $("deep").checked = s.deep;
  $("rules").value = s.rules.join("\n");
}

async function init() {
  fill({ ...D, ...(await api.storage.sync.get(D)) });
  saved = readForm();
  validate(saved.rules);
  updateDirty();

  for (const id of ["enabled", "mode", "deep"]) $(id).addEventListener("change", onFormChange);
  $("rules").addEventListener("input", onFormChange);
  $("apply").addEventListener("click", () =>
    apply().catch((e) => {
      $("count").textContent = `Kunne ikke oppdatere: ${e.message}`;
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
  $("count").textContent = `Feil i Finn-filter: ${e.message}`;
  console.error(e);
});
