// Finn-filter – fyller på med flere annonser fra neste sider når filteret har
// skjult så mange at siden blir tom. Kortene hentes fra Finns egne søkesider
// (page=2, 3, …) og legges i en egen liste rett under Finns liste, så de
// filtreres akkurat som resten.
(() => {
  "use strict";

  // Høflig mot Finn: maks antall sider per runde, og litt pause mellom hver.
  const MAX_PAGES_PER_ROUND = 5;
  const PAGE_DELAY_MS = 400;
  const BOX_ID = "ff-more";
  const BUTTON_ID = "ff-load-more";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // collectCards(root): Map kort -> annonse-URL. itemKey(url): finnkode.
  // requestRun(): ber content.js kjøre filteret på nytt.
  function create({ collectCards, itemKey, requestRun }) {
    let s = null;

    function newState(href, pageSize) {
      const page = Number(new URL(href).searchParams.get("page")) || 1;
      return {
        href,
        nextPage: page + 1,
        pageSize,
        target: pageSize, // så mange synlige annonser vil vi ha
        budget: MAX_PAGES_PER_ROUND,
        loaded: 0,
        loading: false,
        done: false,
        error: null
      };
    }

    function reset() {
      document.getElementById(BOX_ID)?.remove();
      document.getElementById(BUTTON_ID)?.remove();
      s = null;
    }

    function ensureBox(list) {
      let box = document.getElementById(BOX_ID);
      if (!box) {
        box = document.createElement("div");
        box.id = BOX_ID;
        // Samme klasser som Finns liste gir samme rutenett.
        box.className = list.className;
        list.after(box);
      }
      return box;
    }

    function renderButton() {
      let btn = document.getElementById(BUTTON_ID);
      const box = document.getElementById(BOX_ID);
      if (!box) {
        btn?.remove();
        return;
      }
      if (!btn) {
        btn = document.createElement("button");
        btn.id = BUTTON_ID;
        btn.type = "button";
        btn.addEventListener("click", () => {
          if (!s || s.loading || s.done) return;
          s.target += s.pageSize;
          s.budget = MAX_PAGES_PER_ROUND;
          requestRun();
        });
      }
      if (btn.previousElementSibling !== box) box.after(btn);
      const txt = s.error
        ? `Finn-filter: kunne ikke hente side ${s.nextPage} (${s.error})`
        : s.loading
          ? `Finn-filter: henter side ${s.nextPage} …`
          : s.done
            ? `Finn-filter: ingen flere sider (hentet ${s.loaded} ekstra)`
            : `Finn-filter: hent flere treff (side ${s.nextPage})`;
      if (btn.textContent !== txt) btn.textContent = txt;
      btn.disabled = s.loading || s.done;
    }

    async function fetchPage(page) {
      const url = new URL(s.href);
      url.searchParams.set("page", String(page));
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new DOMParser().parseFromString(await res.text(), "text/html");
    }

    async function loadNext(list) {
      const st = s;
      st.loading = true;
      st.budget--;
      renderButton();
      try {
        await sleep(PAGE_DELAY_MS);
        const doc = await fetchPage(st.nextPage);
        if (s !== st) return; // brukeren har byttet søk i mellomtiden
        const known = new Set([...collectCards(document).values()].map(itemKey));
        const fresh = [...collectCards(doc)].filter(([, url]) => !known.has(itemKey(url)));
        if (!fresh.length) {
          st.done = true;
          return;
        }
        const box = ensureBox(list);
        for (const [card] of fresh) {
          const copy = document.importNode(card, true);
          copy.dataset.ffPage = String(st.nextPage);
          box.append(copy);
        }
        st.nextPage++;
        st.loaded++;
      } catch (e) {
        console.warn("[Finn-filter] kunne ikke hente flere annonser", st.nextPage, e);
        st.error = e.message;
        st.done = true;
      } finally {
        st.loading = false;
        if (s === st) renderButton();
        requestRun();
      }
    }

    // Kalles etter hver filtrering. list = Finns resultatliste (forelder til kortene).
    function update({ active, visible, total, list }) {
      if (!active || !list) {
        if (s) reset();
        return;
      }
      if (s?.href !== location.href) {
        reset();
        s = newState(location.href, total);
      }
      renderButton();
      if (s.loading || s.done || s.budget <= 0 || visible >= s.target) return;
      loadNext(list);
    }

    const status = () => (s ? { pages: s.loaded, loading: s.loading, done: s.done, error: s.error } : null);

    return { update, status, isOwn: (el) => el.id === BOX_ID || el.id === BUTTON_ID };
  }

  globalThis.FF_AUTOFILL = { create };
})();
