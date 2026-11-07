// Finn-filter – content script som kjører på www.finn.no
(() => {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;
  const DEFAULTS = globalThis.FF_DEFAULTS;

  let settings = { ...DEFAULTS };
  let compiled = { include: [], exclude: [] };
  let lastCount = 0;
  let lastCards = 0;

  // ---------- Regelmotor ----------

  // Gjør teksten "tilgivende": små bokstaver, og alt unntatt bokstaver/tall fjernes.
  // "Rep.objekt", "rep-objekt", "REP OBJEKT" og "repobjekt" blir alle "repobjekt".
  // "|" beholdes som skilletegn så unntak ikke limer sammen nye ord.
  // map[i] = posisjonen i originalteksten som tegn i kom fra, så vi kan vise
  // brukeren nøyaktig hvilke ord som utløste filteret.
  const KEEP_CHAR = /[a-z0-9æøåäöüé|]/;

  function normMapped(s) {
    let text = "";
    const map = [];
    for (let i = 0; i < s.length; i++) {
      for (const c of s[i].toLowerCase()) {
        if (KEEP_CHAR.test(c)) {
          text += c;
          map.push(i);
        }
      }
    }
    return { text, map };
  }

  const norm = (s) => normMapped((s || "").normalize("NFKC")).text;

  // Erstatter treff med "|" og holder posisjonskartet i takt.
  function cutMapped({ text, map }, re) {
    let out = "";
    const outMap = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      for (let i = last; i < m.index; i++) outMap.push(map[i]);
      outMap.push(map[m.index]);
      out += text.slice(last, m.index) + "|";
      last = m.index + m[0].length;
    }
    for (let i = last; i < text.length; i++) outMap.push(map[i]);
    return { text: out + text.slice(last), map: outMap };
  }

  const MAX_HIT_CHARS = 40;
  function tidy(hit) {
    const s = hit.replace(/\s+/g, " ").trim();
    return s.length > MAX_HIT_CHARS ? s.slice(0, MAX_HIT_CHARS - 1) + "…" : s;
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function compile(rules) {
    const include = [];
    const exclude = [];
    for (let line of rules || []) {
      line = String(line).trim();
      if (!line || line.startsWith("#")) continue;

      const isExclude = line.startsWith("!");
      const body = isExclude ? line.slice(1).trim() : line;
      const target = isExclude ? exclude : include;
      const g = isExclude ? "g" : "";

      // /regulært uttrykk/flagg – testes mot rå tekst (små bokstaver)
      const m = body.match(/^\/(.+)\/([a-z]*)$/);
      if (m) {
        try {
          const flags = [...new Set((m[2] + "i" + g).split(""))].join("");
          target.push({ label: body, raw: true, re: new RegExp(m[1], flags) });
        } catch {
          /* ugyldig regex – ignoreres (popupen viser feilen) */
        }
        continue;
      }

      // Vanlig frase. "*" betyr "inntil ~25 tegn imellom".
      const parts = body.split("*").map(norm).filter(Boolean);
      if (!parts.length) continue;
      target.push({
        label: body,
        raw: false,
        re: new RegExp(parts.map(escapeRe).join(".{0,25}"), g)
      });
    }
    return { include, exclude };
  }

  // Returnerer { rule, hit } – regelen som slo til og teksten den traff – eller null.
  function check(text) {
    if (!compiled.include.length) return null;
    let raw = (text || "").normalize("NFKC");
    for (const r of compiled.exclude) if (r.raw) raw = raw.replace(r.re, " | ");
    let n = normMapped(raw);
    for (const r of compiled.exclude) if (!r.raw) n = cutMapped(n, r.re);
    for (const r of compiled.include) {
      const m = r.re.exec(r.raw ? raw : n.text);
      if (!m) continue;
      const hit = r.raw
        ? m[0]
        : raw.slice(n.map[m.index], n.map[m.index + m[0].length - 1] + 1);
      return { rule: r.label, hit: tidy(hit) };
    }
    return null;
  }

  const describeHit = ({ rule, hit }, where) =>
    `«${hit}» (regel: ${rule}${where ? `, ${where}` : ""})`;

  // ---------- Finne annonsekort ----------

  const ITEM_LINK = 'a[href*="/item/"], a[href*="finnkode="]';

  const itemKey = (href) => {
    const m = String(href).match(/\/item\/(\d+)|finnkode=(\d+)/);
    return m ? m[1] || m[2] : null;
  };

  const isDetailPage = () =>
    /\/item\/\d/.test(location.pathname) || /ad\.html$/.test(location.pathname);

  // Finner annonsekort via lenkene til annonsene, i stedet for å stole på
  // klassenavn som Finn kan endre når som helst.
  function collectCards() {
    const cards = new Map(); // element -> annonse-URL
    for (const a of document.querySelectorAll(ITEM_LINK)) {
      const card = a.closest("article") || a.closest("li");
      if (!card || cards.has(card) || card.id === "ff-badge") continue;
      // Sikkerhetssjekk: et kort skal bare peke på én annonse,
      // ellers er det en container og vi rører det ikke.
      const keys = new Set(
        [...card.querySelectorAll(ITEM_LINK)].map((x) => itemKey(x.href)).filter(Boolean)
      );
      if (keys.size !== 1) continue;
      cards.set(card, a.href);
    }
    return cards;
  }

  // ---------- Dyp sjekk (selve annonseteksten) ----------

  const deepText = new Map(); // url -> tekst
  const inflight = new Set();
  const MAX_PARALLEL = 3;
  let active = 0;
  const waiting = [];

  function limit(fn) {
    return new Promise((resolve) => {
      const start = async () => {
        active++;
        try {
          resolve(await fn());
        } finally {
          active--;
          setTimeout(() => waiting.length && waiting.shift()(), 200);
        }
      };
      active < MAX_PARALLEL ? start() : waiting.push(start);
    });
  }

  async function fetchItemText(url) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        console.warn("[Finn-filter] kunne ikke hente annonse", url, res.status);
        return "";
      }
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => s.textContent)
        .join(" ");
      const main = doc.querySelector("main") || doc.body;
      main?.querySelectorAll("script, style, noscript, svg").forEach((n) => n.remove());
      return (main?.textContent || "") + " " + ld;
    } catch (e) {
      console.warn("[Finn-filter] kunne ikke hente annonse", url, e);
      return "";
    }
  }

  function requestDeep(url) {
    if (deepText.has(url) || inflight.has(url)) return;
    inflight.add(url);
    limit(() => fetchItemText(url)).then((text) => {
      if (deepText.size > 500) deepText.clear();
      deepText.set(url, text);
      inflight.delete(url);
      schedule();
    });
  }

  // ---------- Bruke filteret ----------

  function setState(card, state, reason) {
    if (state) {
      if (card.getAttribute("data-ff-state") !== state) card.setAttribute("data-ff-state", state);
      if (card.getAttribute("data-ff-reason") !== reason) card.setAttribute("data-ff-reason", reason);
    } else if (card.hasAttribute("data-ff-state")) {
      card.removeAttribute("data-ff-state");
      card.removeAttribute("data-ff-reason");
    }
  }

  function run() {
    const cards = settings.enabled && !isDetailPage() ? collectCards() : new Map();

    for (const el of document.querySelectorAll("[data-ff-state]")) {
      if (!cards.has(el)) setState(el, null);
    }

    let count = 0;
    for (const [card, url] of cards) {
      let hit = check(card.textContent);
      let where = "";
      if (!hit && settings.deep && url) {
        if (deepText.has(url)) {
          hit = check(deepText.get(url));
          where = "i annonseteksten";
        } else {
          requestDeep(url);
        }
      }
      const reason = hit ? describeHit(hit, where) : null;
      setState(card, reason ? settings.mode : null, reason);
      if (reason) count++;
    }
    lastCards = cards.size;
    updateBadge(count);
  }

  // ---------- Liten teller nederst til høyre ----------

  let badge = null;

  function updateBadge(n) {
    lastCount = n;
    if (!n && !badge) return;
    if (!badge) {
      badge = document.createElement("button");
      badge.id = "ff-badge";
      badge.type = "button";
      badge.addEventListener("click", () => {
        document.documentElement.classList.toggle("ff-reveal");
        updateBadge(lastCount);
      });
    }
    if (!badge.isConnected && document.body) document.body.appendChild(badge);

    const reveal = document.documentElement.classList.contains("ff-reveal");
    const txt =
      settings.mode === "hide"
        ? `Finn-filter: ${n} skjult · ${reveal ? "skjul igjen" : "vis"}`
        : `Finn-filter: ${n} markert`;
    if (badge.textContent !== txt) badge.textContent = txt;
    const display = n > 0 ? "" : "none";
    if (badge.style.display !== display) badge.style.display = display;
  }

  // ---------- Oppstart og lytting ----------

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 150);
  }

  async function load() {
    const stored = await api.storage.sync.get(DEFAULTS);
    settings = { ...DEFAULTS, ...stored };
    compiled = compile(settings.rules);
  }

  const reportError = (e) => console.error("[Finn-filter]", e);

  api.storage.onChanged.addListener((_changes, area) => {
    if (area === "sync") load().then(schedule, reportError);
  });

  const status = () => ({
    count: lastCount,
    cards: lastCards,
    pending: inflight.size,
    detailPage: isDetailPage(),
    mode: settings.mode,
    enabled: settings.enabled,
    deep: settings.deep
  });

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "ff-count") {
      sendResponse(status());
    } else if (msg.type === "ff-rerun") {
      // Leser innstillingene på nytt selv, så svaret ikke avhenger av at
      // storage.onChanged rakk å fyre først.
      load()
        .then(() => {
          clearTimeout(timer);
          run();
          sendResponse(status());
        })
        .catch((e) => {
          reportError(e);
          sendResponse(null);
        });
      return true; // svarer asynkront
    }
  });

  // Finn laster resultater dynamisk (filtre, paginering, "vis flere"),
  // så vi følger med på endringer i siden.
  new MutationObserver((mutations) => {
    if (badge && mutations.every((m) => badge.contains(m.target))) return;
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });

  load().then(schedule, reportError);
})();
