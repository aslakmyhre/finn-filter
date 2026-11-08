// Kategoriprofiler – finere underkategorier enn det Finn tilbyr.
// Ren data, delt mellom content script og popup. Nye kategorier = nye oppføringer her.
//
// match:   når profilen gjelder (URL-parameter på finn.no)
// words:   søkeord brukeren kan sette til krav / blokkert per underkategori
// attrs:   strukturerte krav. "options" = velg en eller flere verdier (ELLER),
//          "models" = fritekst, kommaseparert. decisive = ikke oppfylt ⇒ filtreres,
//          selv om andre krav er oppfylt (modellen avgjør hvilket kort det er).
(() => {
  const VRAM_SIZES = [2, 3, 4, 6, 8, 10, 11, 12, 16, 20, 24, 32];

  globalThis.FF_CATEGORIES = {
    datakomponenter: {
      label: "Datakomponenter",
      match: { param: "product_category", value: "2.93.3215.8368" },
      words: [
        "cpu", "prosessor", "ryzen", "intel core", "hovedkort", "motherboard",
        "ram", "ddr4", "ddr5", "kabinett", "strømforsyning", "psu", "kjøler",
        "vannkjøling", "ssd", "nvme", "laptop", "bærbar", "defekt", "bytter"
      ],
      subs: {
        gpu: {
          label: "Skjermkort",
          attrs: [
            {
              id: "producer", label: "Produsent", type: "options",
              options: [
                { id: "nvidia", label: "Nvidia", words: ["nvidia", "geforce", "rtx", "gtx"] },
                { id: "amd", label: "AMD", words: ["radeon", "amd", "rx"] },
                { id: "intel", label: "Intel", words: ["intel arc", "arc"] }
              ]
            },
            {
              id: "vram", label: "VRAM", type: "options",
              options: VRAM_SIZES.map((n) => ({
                id: String(n), label: `${n} GB`, words: [`${n}gb`, `${n}g`]
              }))
            },
            {
              id: "model", label: "Modell", type: "models", decisive: true,
              placeholder: "f.eks. 4060ti, 7800xt",
              suffixes: ["ti", "super", "xt", "xtx"]
            }
          ],
          defaultWords: {
            cpu: "block", prosessor: "block", ryzen: "block", "intel core": "block",
            hovedkort: "block", motherboard: "block", kabinett: "block", laptop: "block"
          }
        }
      }
    }
  };
})();
