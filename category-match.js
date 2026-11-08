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

  // Ett krav per attributt med valg. Valgene innenfor er alternativer (ELLER).
  // others: ikke-valgte alternativer, brukt når attributtet er exclusive.
  function attrGroup(attr, value) {
    if (attr.type === "options") {
      const chosen = attr.options.filter((o) => (value || []).includes(o.id));
      if (!chosen.length) return null;
      const others = attr.exclusive
        ? attr.options.filter((o) => !chosen.includes(o))
        : [];
      return {
        res: chosen.flatMap((o) => regexes(o.words)),
        others: others.flatMap((o) => regexes(o.words))
      };
    }
    if (attr.type === "models") {
      const models = splitModels(value);
      if (!models.length) return null;
      return { res: regexes(models, attr.suffixes), others: [] };
    }
    throw new Error(`Ukjent attributtype: ${attr.type}`);
  }

  const DEFAULT_NEAR_MISS = "warn";
  const DEFAULT_MAX_MISSING = 1;

  // sel = { attrs: { [attrId]: verdi }, words: { [ord]: "require" | "block" },
  //         nearMiss: "warn" | "hide", maxMissing: tall }
  function compileSub(sub, sel) {
    const attrs = sel?.attrs ?? {};
    const words = sel?.words ?? sub.defaultWords ?? {};
    const groups = [];
    for (const attr of sub.attrs) {
      const g = attrGroup(attr, attrs[attr.id]);
      if (g?.res.length) groups.push({ ...g, label: attr.label, decisive: !!attr.decisive });
    }
    const blocked = [];
    for (const [word, state] of Object.entries(words)) {
      const re = tokenRegex(word);
      if (!re) continue;
      if (state === "require") groups.push({ label: word, res: [re], others: [], decisive: false });
      else if (state === "block") blocked.push({ label: word, re });
    }
    return {
      label: sub.label,
      groups,
      blocked,
      nearMiss: sel?.nearMiss ?? DEFAULT_NEAR_MISS,
      maxMissing: sel?.maxMissing ?? DEFAULT_MAX_MISSING
    };
  }

  // Id-en til kategorien siden er i (etter URL), eller null.
  function categoryFor(categories, href) {
    const params = new URL(href).searchParams;
    const hit = Object.entries(categories).find(([, cat]) =>
      params.getAll(cat.match.param).includes(cat.match.value)
    );
    return hit ? hit[0] : null;
  }

  // Profilen som gjelder for siden, eller null.
  function activeProfile(categories, profiles, href) {
    const id = categoryFor(categories, href);
    const sel = id && profiles?.[id];
    if (!sel?.sub) return null;
    const sub = categories[id].subs[sel.sub];
    if (!sub) {
      console.warn("[Finn-filter] ukjent underkategori i innstillingene:", id, sel.sub);
      return null;
    }
    return compileSub(sub, sel[sel.sub]);
  }

  // Tidligste treff blant uttrykkene, eller null.
  function firstMatch(res, text) {
    let best = null;
    for (const re of res) {
      const m = re.exec(text);
      if (m && (!best || m.index < best.index)) best = m;
    }
    return best;
  }

  // Blokkerte ord og konflikter sjekkes bare mot kortet: beskrivelser nevner ofte
  // "cpu" eller «bytte mot Nvidia» uten at annonsen gjelder det. Kravene kan
  // oppfylles av annonseteksten (extra).
  // Returnerer null (ingen mening), eller
  //   { state: "blocked", word, hit }   – blokkert ord
  //   { state: "conflict", attr, hit }  – kortet nevner et annet alternativ først
  //                                       («Radeon RX 7800 XT (ønsker Nvidia)»)
  //   { state: "fail", missing }        – for mange krav, eller et avgjørende krav, mangler
  //   { state: "partial", missing }     – nesten-treff som skal vises med advarsel
  //   { state: "ok" }                   – alle krav oppfylt
  function evaluate(profile, cardText, extraText = "") {
    const card = lc(cardText);
    for (const b of profile.blocked) {
      const m = b.re.exec(card);
      if (m) return { state: "blocked", word: b.label, hit: m[0] };
    }
    for (const g of profile.groups) {
      const other = firstMatch(g.others, card);
      if (!other) continue;
      const own = firstMatch(g.res, card);
      if (!own || other.index < own.index) {
        return { state: "conflict", attr: g.label, hit: other[0] };
      }
    }
    if (!profile.groups.length) return null;
    const text = extraText ? `${card} ${lc(extraText)}` : card;
    const unmet = profile.groups.filter((g) => !g.res.some((re) => re.test(text)));
    if (!unmet.length) return { state: "ok" };
    const missing = unmet.map((g) => g.label);
    const fail =
      unmet.length === profile.groups.length ||
      unmet.some((g) => g.decisive) ||
      profile.nearMiss === "hide" ||
      unmet.length > profile.maxMissing;
    return { state: fail ? "fail" : "partial", missing };
  }

  globalThis.FF_MATCH = { tokenRegex, categoryFor, activeProfile, evaluate };
})();
