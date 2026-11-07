# Finn-filter

Nettleserutvidelse som skjuler annonser på finn.no basert på dine egne regler
(f.eks. «rep objekt», «ikke godkjent EU-kontroll»). Samme kode fungerer i
Chrome (og Edge/Brave), Firefox og Safari.

## Installere

### Chrome / Edge / Brave
1. Gå til `chrome://extensions`
2. Slå på **Utviklermodus** (øverst til høyre)
3. **Last inn upakket** → velg mappen `finn-filter`

Blir liggende permanent. Etter endringer i koden: trykk på oppdater-pila på kortet.

### Firefox
- **Raskt (til Firefox startes på nytt):** `about:debugging#/runtime/this-firefox`
  → **Last inn midlertidig tillegg** → velg `manifest.json`.
- **Permanent:** Firefox krever signerte tillegg. Lag en gratis konto på
  addons.mozilla.org og signer som «unlisted» (bare for deg):
  ```
  npm i -g web-ext
  cd finn-filter
  web-ext sign --channel=unlisted --api-key=... --api-secret=...
  ```
  Installer `.xpi`-fila du får tilbake.
- Hvis ingenting skjer: `about:addons` → Finn-filter → **Tillatelser** → slå på
  tilgang til www.finn.no.

### Safari (krever Mac med Xcode)
Xcode-prosjektet ligger i `safari/` og peker direkte på filene i rotmappa – det
finnes ingen kopi. Endringer i koden når derfor ikke Safari før appen er bygd
og installert på nytt:

```
cd safari
xcodebuild -project Finn-filter.xcodeproj -scheme Finn-filter -configuration Release \
  -derivedDataPath build -allowProvisioningUpdates build
ditto build/Build/Products/Release/Finn-filter.app ~/Applications/Finn-filter.app
open ~/Applications/Finn-filter.app
# Ellers viser Safari Finn-filter to ganger (byggekopien registreres også):
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -u build/Build/Products/Release/Finn-filter.app
```

1. Prosjektet signeres med Apple Developer-teamet (`DEVELOPMENT_TEAM` i
   `safari/Finn-filter.xcodeproj/project.xcproj`). Bytt det ut med ditt eget team.
2. Avslutt Safari helt (⌘Q) og åpne igjen.
3. Safari → Innstillinger → Utvidelser → slå på Finn-filter og gi tilgang til
   www.finn.no (**Tillat alltid**). Uten dette kjører ikke filteret – popupen sier ifra.

Signert med et team trengs ikke «Tillat usignerte utvidelser», og utvidelsen
blir ikke slått av ved omstart av Safari.

Samme Xcode-prosjekt har også et iOS-mål hvis du vil ha det på iPhone (krever
signering med Apple-ID).

## Regler

| Skriv            | Betyr                                                                 |
|------------------|-----------------------------------------------------------------------|
| `rep objekt`     | Treffer «Rep.objekt», «rep-objekt», «REPOBJEKT» osv. (store/små bokstaver, mellomrom og tegnsetting ignoreres) |
| `ikke godkjent*eu` | `*` = inntil ca. 25 tegn imellom → treffer «ikke godkjent på EU-kontroll» |
| `!ikke rep objekt` | Unntak: fjernes fra teksten før sjekk, så «Ikke rep.objekt!» ikke skjules |
| `/\bdefekt/`     | Regulært uttrykk mot teksten (små bokstaver)                          |
| `# tekst`        | Kommentar                                                             |

## Popupen

Endringer i regler og valg tas ikke i bruk før du trykker **Oppdater filter**.
Knappen blir blå med ● når du har endringer som ikke er brukt ennå. Den kjører
også filteret på nytt på siden. Lukker du popupen uten å trykke, forsvinner
endringene. Nederst ser du hvor mange av annonsene på siden som er filtrert, og
hvorfor filteret eventuelt ikke kjører.

## Moduser

- **Skjul helt** – treff forsvinner. Telleren nede til høyre viser hvor mange, og
  «vis» der viser dem nedtonet midlertidig.
- **Vis nedtonet** – treff blir grå med en rød lapp som viser ordene i annonsen
  som slo til og hvilken regel det var, f.eks. `Filtrert: «REP. OBJEKT» (regel:
  rep objekt)`. Nyttig når du justerer regler.
- **Sjekk også teksten inne i annonsen** – mange skriver «ikke godkjent EU» bare i
  beskrivelsen, ikke i tittelen. Med dette på henter utvidelsen hver annonse i
  bakgrunnen (maks 3 samtidig) og sjekker hele teksten. Tregere, så annonser
  forsvinner litt etter at siden har lastet.

## Hvordan den finner annonsene

Den ser etter lenker til annonser (`/item/12345` eller `finnkode=12345`) og
bruker det nærmeste `<article>`/`<li>` rundt som «kortet». Det gjør den robust
mot at Finn endrer klassenavn. Annonsesider og containere med flere annonser
røres ikke.
