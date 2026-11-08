// Kategori-delen av popupen: velg underkategori, krav og søkeord (se categories.js).
// Holder et utkast av `profiles` som popup.js leser via CategoryForm.read().
const CategoryForm = (() => {
  const CATS = globalThis.FF_CATEGORIES;
  const byId = (id) => document.getElementById(id);
  const WORD_STATES = [
    { value: "", label: "–" },
    { value: "require", label: "Krav" },
    { value: "block", label: "Blokker" }
  ];
  const NEW_WORD_STATE = "block";

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

  function wordRow(word, state, index) {
    const name = `word-${index}`;
    const radios = WORD_STATES.flatMap((s) => {
      const id = `${name}-${s.value || "none"}`;
      const input = el("input", { type: "radio", name, id, value: s.value, checked: s.value === (state || "") });
      input.dataset.word = word;
      return [input, el("label", { htmlFor: id, textContent: s.label })];
    });
    return el("div", { className: "row word-row" }, [
      el("div", { className: "row-text", textContent: word }),
      el("div", { className: "segmented", role: "radiogroup", ariaLabel: word }, radios)
    ]);
  }

  function vocabulary(sub, words) {
    const all = [...CATS[catId].words, ...Object.keys(sub.defaultWords || {}), ...Object.keys(words)];
    return [...new Set(all)];
  }

  function wordsBlock(sub, words) {
    const list = el("div", { id: "word-list" },
      vocabulary(sub, words).map((w, i) => wordRow(w, words[w], i)));
    const input = el("input", { type: "text", id: "new-word", placeholder: "Legg til ord …", spellcheck: false });
    const add = el("button", { type: "button", id: "add-word", textContent: "Legg til" });
    return el("details", { className: "words" }, [
      el("summary", { id: "words-summary" }),
      list,
      el("div", { className: "row" }, [input, add])
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
    box.append(wordsBlock(sub, entry.words));
    store();
  }

  // ---------- Lese skjemaet ----------

  function collect() {
    const sub = currentSub();
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
    const words = {};
    for (const r of document.querySelectorAll("#word-list input[data-word]:checked")) {
      if (r.value) words[r.dataset.word] = r.value;
    }
    return { attrs, words };
  }

  function updateSummary() {
    const states = Object.values(draft[catId][currentSubId()].words);
    const req = states.filter((s) => s === "require").length;
    const block = states.filter((s) => s === "block").length;
    byId("words-summary").textContent = `Søkeord · ${req} krav · ${block} blokkert`;
  }

  function store() {
    draft[catId][currentSubId()] = collect();
    updateSummary();
  }

  // ---------- Hendelser ----------

  function addWord() {
    const input = byId("new-word");
    const word = input.value.trim().toLowerCase();
    if (!word) return;
    input.value = "";
    const existing = document.querySelector(`#word-list input[data-word="${CSS.escape(word)}"][value="${NEW_WORD_STATE}"]`);
    if (existing) {
      existing.checked = true;
    } else {
      const list = byId("word-list");
      list.append(wordRow(word, NEW_WORD_STATE, list.children.length));
    }
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

  function bind() {
    byId("cat-select").addEventListener("change", (e) => {
      catId = e.target.value;
      renderSubSelect();
    });
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

  return { init, read: () => structuredClone(draft), selectedLabels };
})();
