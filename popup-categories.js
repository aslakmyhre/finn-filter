// Kategori-delen av popupen: velg underkategori, krav og søkeord (se categories.js).
// Holder et utkast av `profiles` som popup.js leser via CategoryForm.read().
const CategoryForm = (() => {
  const CATS = globalThis.FF_CATEGORIES;
  const byId = (id) => document.getElementById(id);
  // Klikk på et søkeord går rundt: – → krav → blokker → –
  const WORD_CYCLE = ["", "require", "block"];
  const WORD_STATE_LABEL = { "": "ikke brukt", require: "krav", block: "blokkert" };
  const NEW_WORD_STATE = "block";
  const DEFAULT_NEAR_MISS = "warn";
  const DEFAULT_MAX_MISSING = 1;

  let draft = {};
  let catId = Object.keys(CATS)[0];
  let notify = () => {};

  function el(tag, props = {}, children = []) {
    const e = document.createElement(tag);
    Object.assign(e, props);
    e.append(...children);
    return e;
  }

  const currentSubId = () => draft[catId]?.sub || "";
  const currentSub = () => CATS[catId].subs[currentSubId()];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // Labels for valgte underkategorier, f.eks. ["Datakomponenter › Skjermkort"].
  function selectedLabels(profiles) {
    return Object.entries(profiles || {})
      .filter(([id, sel]) => CATS[id]?.subs[sel?.sub])
      .map(([id, sel]) => `${CATS[id].label} › ${CATS[id].subs[sel.sub].label}`);
  }

  // ---------- Felter ----------

  function optionsRow(attr, chosen) {
    const chips = attr.options.map((o) => {
      const id = `attr-${attr.id}-${o.id}`;
      const input = el("input", { type: "checkbox", id, value: o.id, checked: chosen.includes(o.id) });
      input.dataset.attr = attr.id;
      return el("span", {}, [input, el("label", { htmlFor: id, textContent: o.label })]);
    });
    return el("div", { className: "row row-stack" }, [
      el("div", { className: "row-text", textContent: attr.label }),
      el("div", { className: "chips" }, chips)
    ]);
  }

  function modelsRow(attr, value) {
    const input = el("input", {
      type: "text", id: `attr-${attr.id}`, value: value || "",
      placeholder: attr.placeholder || "", spellcheck: false
    });
    input.dataset.attr = attr.id;
    return el("label", { className: "row", htmlFor: input.id }, [
      el("div", { className: "row-text", textContent: attr.label }),
      input
    ]);
  }

  function setWordState(chip, state) {
    chip.dataset.state = state;
    chip.setAttribute("aria-label", `${chip.dataset.word}: ${WORD_STATE_LABEL[state]}`);
  }

  function wordChip(word, state) {
    const chip = el("button", { type: "button", className: "word-chip", textContent: word });
    chip.dataset.word = word;
    setWordState(chip, state || "");
    return chip;
  }

  function vocabulary(sub, words) {
    const all = [...CATS[catId].words, ...Object.keys(sub.defaultWords || {}), ...Object.keys(words)];
    return [...new Set(all)];
  }

  function wordsRow(sub, words) {
    return el("div", { className: "row row-stack" }, [
      el("div", { className: "row-text" }, [
        "Søkeord",
        el("small", { textContent: "Klikk for å bytte: – → krav → blokkert" })
      ]),
      el("div", { className: "chips", id: "word-list" },
        vocabulary(sub, words).map((w) => wordChip(w, words[w]))),
      el("div", { className: "add-word" }, [
        el("input", { type: "text", id: "new-word", placeholder: "Legg til ord …", spellcheck: false }),
        el("button", { type: "button", id: "add-word", textContent: "Legg til" })
      ])
    ]);
  }

  function nearMissRow(entry) {
    const mode = entry.nearMiss ?? DEFAULT_NEAR_MISS;
    const radios = [["warn", "Advar"], ["hide", "Skjul"]].flatMap(([value, label]) => [
      el("input", { type: "radio", name: "near-miss", id: `near-miss-${value}`, value, checked: value === mode }),
      el("label", { htmlFor: `near-miss-${value}`, textContent: label })
    ]);
    return el("div", { className: "row row-stack" }, [
      el("div", { className: "row-head" }, [
        el("div", { className: "row-text" }, [
          "Nesten-treff",
          el("small", { textContent: "Annonser som oppfyller noen, men ikke alle krav." })
        ]),
        el("div", { className: "segmented", role: "radiogroup", ariaLabel: "Nesten-treff" }, radios)
      ]),
      el("div", { className: "slider", id: "near-miss-slider" }, [
        el("input", {
          type: "range", id: "max-missing", min: 1, step: 1,
          value: entry.maxMissing ?? DEFAULT_MAX_MISSING
        }),
        el("span", { id: "max-missing-label" })
      ])
    ]);
  }

  function renderFields() {
    const box = byId("sub-fields");
    box.replaceChildren();
    const sub = currentSub();
    if (!sub) return;
    const entry = draft[catId][currentSubId()] ?? { attrs: {}, words: { ...sub.defaultWords } };
    for (const attr of sub.attrs) {
      const value = entry.attrs[attr.id];
      if (attr.type === "options") box.append(optionsRow(attr, value || []));
      else if (attr.type === "models") box.append(modelsRow(attr, value));
      else throw new Error(`Ukjent attributtype: ${attr.type}`);
    }
    box.append(wordsRow(sub, entry.words), nearMissRow(entry));
    store();
  }

  // ---------- Lese skjemaet ----------

  function collectAttrs(sub) {
    const attrs = {};
    for (const attr of sub.attrs) {
      if (attr.type === "options") {
        const chosen = [...document.querySelectorAll(`input[data-attr="${attr.id}"]:checked`)].map((i) => i.value);
        if (chosen.length) attrs[attr.id] = chosen;
      } else {
        const v = byId(`attr-${attr.id}`).value.trim();
        if (v) attrs[attr.id] = v;
      }
    }
    return attrs;
  }

  function collectWords() {
    const words = {};
    for (const chip of byId("word-list").children) {
      if (chip.dataset.state) words[chip.dataset.word] = chip.dataset.state;
    }
    return words;
  }

  // Slideren kan bare gå til én under antall krav – mangler alle, skjules annonsen uansett.
  function syncSlider(requirementCount) {
    const slider = byId("max-missing");
    const max = Math.max(1, requirementCount - 1);
    const n = Math.min(Number(slider.value), max);
    slider.max = max;
    slider.value = n;
    slider.disabled = requirementCount < 3;
    byId("max-missing-label").textContent = `Tillat inntil ${plural(n, "mangel", "mangler")}`;
    byId("near-miss-slider").hidden = byId("near-miss-hide").checked;
    return n;
  }

  function store() {
    const sub = currentSub();
    const attrs = collectAttrs(sub);
    const words = collectWords();
    const required = Object.values(words).filter((s) => s === "require").length;
    const maxMissing = syncSlider(Object.keys(attrs).length + required);
    const nearMiss = document.querySelector('input[name="near-miss"]:checked').value;
    draft[catId][currentSubId()] = { attrs, words, nearMiss, maxMissing };
  }

  // ---------- Hendelser ----------

  function addWord() {
    const input = byId("new-word");
    const word = input.value.trim().toLowerCase();
    if (!word) return;
    input.value = "";
    const list = byId("word-list");
    const existing = [...list.children].find((c) => c.dataset.word === word);
    if (existing) setWordState(existing, NEW_WORD_STATE);
    else list.append(wordChip(word, NEW_WORD_STATE));
    store();
    notify();
  }

  function cycleWord(chip) {
    const next = WORD_CYCLE[(WORD_CYCLE.indexOf(chip.dataset.state) + 1) % WORD_CYCLE.length];
    setWordState(chip, next);
    store();
    notify();
  }

  function renderSubSelect() {
    const subs = Object.entries(CATS[catId].subs);
    byId("sub-select").replaceChildren(
      el("option", { value: "", textContent: "Ingen (av)" }),
      ...subs.map(([id, s]) => el("option", { value: id, textContent: s.label }))
    );
    byId("sub-select").value = currentSubId();
    renderFields();
  }

  function showCategory(id) {
    if (!CATS[id] || id === catId) return;
    catId = id;
    byId("cat-select").value = id;
    renderSubSelect();
  }

  function bind() {
    byId("cat-select").addEventListener("change", (e) => showCategory(e.target.value));
    byId("sub-select").addEventListener("change", (e) => {
      draft[catId] = { ...draft[catId], sub: e.target.value };
      renderFields();
      notify();
    });
    const box = byId("sub-fields");
    box.addEventListener("input", (e) => {
      if (e.target.id === "new-word") return;
      store();
      notify();
    });
    box.addEventListener("click", (e) => {
      if (e.target.id === "add-word") addWord();
      else if (e.target.classList.contains("word-chip")) cycleWord(e.target);
    });
    box.addEventListener("keydown", (e) => {
      if (e.target.id === "new-word" && e.key === "Enter") addWord();
    });
  }

  function init(profiles, onChange) {
    draft = structuredClone(profiles || {});
    notify = onChange;
    catId = Object.keys(CATS).find((id) => draft[id]?.sub) || catId;
    byId("cat-select").replaceChildren(
      ...Object.entries(CATS).map(([id, c]) => el("option", { value: id, textContent: c.label }))
    );
    byId("cat-select").value = catId;
    for (const id of Object.keys(CATS)) draft[id] ??= { sub: "" };
    renderSubSelect();
    bind();
  }

  return { init, read: () => structuredClone(draft), selectedLabels, showCategory };
})();
