// Standardinnstillinger – delt mellom content script og popup.
globalThis.FF_DEFAULTS = {
  enabled: true,
  mode: "hide", // "hide" = skjul helt, "dim" = vis nedtonet med begrunnelse
  deep: false,  // sjekk også teksten inne i selve annonsen (henter hver annonse)
  // Valgt underkategori per kategori i categories.js, f.eks.
  // { datakomponenter: { sub: "gpu", gpu: { attrs: { vram: ["16"] }, words: { cpu: "block" } } } }
  profiles: {},
  rules: [
    "# Én regel per linje. Linjer som starter med # er kommentarer.",
    "rep objekt",
    "reparasjonsobjekt",
    "delebil",
    "havar",
    "ikke godkjent*eu",
    "eu*ikke godkjent",
    "ikke eu godkjent",
    "uten eu",
    "mangler eu",
    "# Unntak (fjernes fra teksten før sjekk):",
    "!ikke rep objekt",
    "!ikke et rep objekt"
  ]
};
