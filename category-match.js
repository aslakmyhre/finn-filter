// Finn-filter – matching for kategoriprofiler (se categories.js).
(() => {
  "use strict";

  const LETTER = "a-zæøåäöüé";
  // Tillatt skille mellom deler av en frase: "4060ti", "4060 ti", "4060-Ti".
  const SEP = "[\\s\\-_.]{0,3}";
  const RUN = new RegExp(`[0-9]+|[${LETTER}]+`, "g");

  const lc = (s) => (s || "").normalize("NFKC").toLowerCase();
  const charClassFor = (token) => (/^[0-9]/.test(token) ? "0-9" : LETTER);

  // Bygger et uttrykk av bokstav-/tallgruppene i frasen. Grensene sjekker bare
  // samme type tegn, så "rtx4060" treffer "4060", men "14060" gjør det ikke.
  // suffixes: varianter som ikke skal telle med mindre de er skrevet,
  // så "4060" ikke treffer "4060 Ti" og "4070ti" ikke treffer "4070 Ti Super".
  function tokenRegex(phrase, suffixes = []) {
    const tokens = lc(phrase).match(RUN);
    if (!tokens) return null;
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    const untyped = suffixes.filter((s) => !tokens.includes(s));
    const noSuffix = untyped.length
      ? `(?!${SEP}(?:${untyped.join("|")})(?![${LETTER}]))`
      : "";
    return new RegExp(
      `(?<![${charClassFor(first)}])${tokens.join(SEP)}(?![${charClassFor(last)}])${noSuffix}`
    );
  }

  const regexes = (phrases, suffixes) =>
    phrases.map((p) => tokenRegex(p, suffixes)).filter(Boolean);

  const splitModels = (s) => String(s || "").split(",").map((m) => m.trim()).filter(Boolean);

  function attrGroup(attr, value) {
    if (attr.type === "options") {
      const chosen = attr.options.filter((o) => (value || []).includes(o.id));
      if (!chosen.length) return null;
      return {
        label: chosen.map((o) => o.label).join("/"),
        res: chosen.flatMap((o) => regexes(o.words))
      };
    }
    if (attr.type === "models") {
      const models = splitModels(value);
      if (!models.length) return null;
      return { label: models.join("/"), res: regexes(models, attr.suffixes) };
    }
    throw new Error(`Ukjent attributtype: ${attr.type}`);
  }

  // sel = { attrs: { [attrId]: verdi }, words: { [ord]: "require" | "block" } }
  function compileSub(sub, sel) {
    const attrs = sel?.attrs ?? {};
    const words = sel?.words ?? sub.defaultWords ?? {};
    const groups = [];
    for (const attr of sub.attrs) {
      const g = attrGroup(attr, attrs[attr.id]);
      if (g?.res.length) groups.push({ ...g, decisive: !!attr.decisive });
    }
    const blocked = [];
    for (const [word, state] of Object.entries(words)) {
      const re = tokenRegex(word);
      if (!re) continue;
      if (state === "require") groups.push({ label: word, res: [re], decisive: false });
      else if (state === "block") blocked.push({ label: word, re });
    }
    return { label: sub.label, groups, blocked };
  }

  // Profilen som gjelder for siden, eller null.
  function activeProfile(categories, profiles, href) {
    const params = new URL(href).searchParams;
    for (const [id, cat] of Object.entries(categories)) {
      if (!params.getAll(cat.match.param).includes(cat.match.value)) continue;
      const sel = profiles?.[id];
      if (!sel?.sub) return null;
      const sub = cat.subs[sel.sub];
      if (!sub) {
        console.warn("[Finn-filter] ukjent underkategori i innstillingene:", id, sel.sub);
        return null;
      }
      return compileSub(sub, sel[sel.sub]);
    }
    return null;
  }

  // Blokkerte ord sjekkes bare mot kortet: beskrivelser nevner ofte "cpu" o.l.
  // uten at annonsen gjelder det. Kravene kan oppfylles av annonseteksten (extra).
  // Returnerer null (ingen mening), eller
  //   { state: "blocked", word, hit } – blokkert ord
  //   { state: "fail", missing }      – ingen krav, eller et avgjørende krav, oppfylt
  //   { state: "partial", missing }   – noen krav oppfylt
  //   { state: "ok" }                 – alle krav oppfylt
  function evaluate(profile, cardText, extraText = "") {
    const card = lc(cardText);
    for (const b of profile.blocked) {
      const m = b.re.exec(card);
      if (m) return { state: "blocked", word: b.label, hit: m[0] };
    }
    if (!profile.groups.length) return null;
    const text = extraText ? `${card} ${lc(extraText)}` : card;
    const unmet = profile.groups.filter((g) => !g.res.some((re) => re.test(text)));
    if (!unmet.length) return { state: "ok" };
    const missing = unmet.map((g) => g.label);
    const fail = unmet.length === profile.groups.length || unmet.some((g) => g.decisive);
    return { state: fail ? "fail" : "partial", missing };
  }

  globalThis.FF_MATCH = { tokenRegex, activeProfile, evaluate };
})();
