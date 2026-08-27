# KasVisie — Kasprognose-dashboard

Interactief dashboard voor dagelijkse kasstroomprognoses, gebouwd met het
[NLDD Design System](https://minbzk.github.io/storybook/) (`@nldd/design-system`,
Nederlandse Digitale Dienst) en een FastAPI-backend. Alles draait in één
Docker-container.

## Schermen

1. **Gegevens** — CSV uploaden (kolommen `date`/`datum` en `cashflow`/`bedrag`/`amount`),
   demo-data laden en de dataset per maand inspecteren (weekend- en feestdagen gemarkeerd).
2. **Prognose** — dagvoorspellingen voor deze én volgende maand met:
   - onzekerheidsband (80%) en backtest-metrieken (pinball-loss, binnen% t.o.v.
     het doel van 80%);
   - weekend- en feestdagmarkering, en een melding als de dataset achterloopt;
   - handmatige bijstelling per dag: klik een punt voor een exacte waarde, sleep
     het voor een snelle schatting, of gebruik het toetsenbord (pijltjes = 1%,
     Shift = 10%, Enter = exacte invoer, Delete = wissen). Latere dagen bewegen
     evenredig mee met een uitdovende factor;
   - **scenario's**: meerdere varianten naast elkaar, elk met eigen
     bijstellingen en een eigen toekomstpad, samen in de grafiek;
   - export naar CSV of Excel van de hele prognoseperiode, met een kolom per
     scenario (Excel bevat ook maandtotalen en een toelichtingsblad);
   - toggles voor volgende maand, realisatie van vorig jaar en totale volumes;
   - uitleg bij het gebruikte model. Zolang er één model aangeboden wordt staat
     de naam vast; biedt de server er meer aan, dan verschijnt het keuzemenu
     vanzelf.

3. **Model** — de modelkaart: doel en toepassing, hoe het model werkt
   (kenmerken, instellingen, nabewerking), op welke data het getraind is,
   prestaties uit de backtest, beperkingen en risico's, en de
   versiegeschiedenis.

### Modelversie en herkomst

Twee dingen bepalen samen een prognose en worden apart vastgelegd:

- de **modelversie** — code en instellingen, bijgehouden in `CHANGELOG` in
  `app/modelcard.py`, met de bijbehorende commit;
- de **datavingerafdruk** — een SHA-256-hash over alle datums en bedragen van de
  dataset.

Beide staan op de modelkaart én in het Toelichting-blad van de Excel-export, zodat
achteraf te herleiden is welk model op welke gegevens een bestand heeft
geproduceerd. Voeg bij elke wijziging die de uitkomst kan veranderen een regel
toe aan `CHANGELOG`.

### Modellen aan- en uitzetten

Alleen modellen in `models.MODELS` worden aangeboden; `models.FUTURE_MODELS`
bevat wél geïmplementeerde maar nog niet vrijgegeven modellen. Verplaats een
regel tussen die twee om een model beschikbaar te maken of terug te trekken — de
frontend past zich aan zonder wijziging.

### Vergelijking met vorig jaar

"Realisatie vorig jaar" loopt **52 weken (364 dagen)** terug, niet naar dezelfde
kalenderdatum. Een jaar is 52 weken plus één dag, dus dezelfde datum valt vorig
jaar op een andere weekdag — dan wordt een maandag tegen een zondag afgezet, wat
bij dagontvangsten het beeld volledig vertekent. Met deze correctie blijft de
weekdag gelijk en bevatten beide periodes evenveel werk- en weekenddagen, wat ook
de maandtotalen eerlijker vergelijkbaar maakt. De grafiek-tooltip en de export
tonen expliciet welke dag ertegenover staat.

### Grenzen aan bijstellingen

Een bijstelling verandert een dag met een verhouding t.o.v. de modelprognose.
Die verhouding is begrensd op 0,2× – 5×, zowel per losse bijstelling als
cumulatief. Weekend- en feestdagen zijn niet bij te stellen: hun prognose is
structureel nul, waardoor een verhouding daar betekenisloos is.

## Frontend en design system

De frontend is platte HTML, CSS en JavaScript — geen framework — gebundeld met
[Vite](https://vite.dev), net als de invulhulp. De UI is opgebouwd uit de web
components van het NLDD Design System, dat als gewone npm-afhankelijkheid in
`package.json` staat en door Vite wordt meegebundeld; er staat dus geen kopie in
de repo.

| Pad | Wat het is |
| --- | --- |
| `index.html` | de pagina; laadt alleen `/src/main.js` als module |
| `src/main.js` | entry: importeert het design system (componenten + globale stylesheet), `style.css` en `app.js` |
| `src/app.js` | de drie schermen, de gegenereerde markup en alle `/api`-aanroepen |
| `src/chart.js` | de SVG-grafiek; exporteert `KVChart`, geïmporteerd door `app.js` |
| `src/style.css` | eigen CSS bovenop de componenten |
| `dist/` | het bouwresultaat dat FastAPI serveert (niet in git) |

De importvolgorde in `main.js` is functioneel: ES-modules draaien in
importvolgorde, dus het design system registreert al zijn custom elements
vóór `app.js` de eerste markup opbouwt. Een `nldd-*`-element dat naar zijn
inhoud kijkt terwijl die er nog niet is trekt anders de verkeerde conclusie —
`nldd-menu-bar` zet zichzelf op `empty` en verdwijnt.

Bouwen:

```sh
npm ci
npm run build     # → dist/
```

Upgraden van het design system:

```sh
npm install @nldd/design-system@0.9.0   # past package.json én de lockfile aan
```

Commit daarna beide manifesten.

Lees vóór een upgrade elke `Breaking`-sectie tussen je huidige en de doelversie
in de [changelog](https://github.com/MinBZK/storybook/blob/main/skills/nldd/changelog.md):
semantic-release verhoogt ook bij een breaking change alleen het patch-nummer, dus
het versienummer alleen zegt niets.

Eigen CSS (`src/style.css`) blijft beperkt tot wat geen component is: de
twee paginarasters, de grafiek en de twee panelen die zich aan de grafiek
verankeren. Alle waarden komen uit de NLDD-variabelen, met één bewuste
uitzondering: het categorische grafiekpalet (`--kv-series-*`), dat CVD-veilig en
onderling onderscheidbaar moet zijn en daarom buiten de huisstijl valt. De
grafiek*chroom* (raster, assen) komt wél uit de semantics en beweegt dus mee met
het licht/donker-schema.

**Fonts.** RijksSans is auteursrechtelijk beschermd en uitsluitend bestemd voor
publicaties van de Rijksoverheid en partijen die in haar opdracht werken; zie
`node_modules/@nldd/design-system/NOTICES.md`. Buiten dat kader vervang je in
`src/main.js` de import `@nldd/design-system/styles` door
`@nldd/design-system/styles/system-font` — dezelfde stijlen zonder de
`@font-face`-regels.

## Draaien met Docker

De build draait Vite zelf in een `node`-stage; je hebt lokaal geen Node nodig,
wel netwerk naar het npm-register.

```sh
docker build -t kasvisie .
docker run --rm -p 8000:8000 kasvisie
```

Open daarna <http://localhost:8000>. Zonder eigen dataset start de app met
gegenereerde demo-data (30 maanden, incl. vorig jaar).

## Lokaal ontwikkelen

Twee processen: uvicorn voor de API, Vite voor de frontend. Vite proxyt alles
onder `/api` naar de backend, dus de frontend gebruikt dezelfde paden als in
productie.

```sh
uv sync && npm ci

uv run uvicorn app.main:app --reload    # terminal 1 — API op :8000
npm run dev                             # terminal 2 — pagina op :5173, met hot reload
```

Wil je in één keer zien wat de container serveert, bouw dan de bundel en laat
uvicorn hem serveren:

```sh
npm run build
uv run uvicorn app.main:app --reload    # serveert dist/ op :8000
```

De backend weigert te starten zonder `dist/`; met alleen `npm run dev` bouw je
die niet, dus draai `npm run build` één keer na het clonen.

## Licentie

Zie [LICENSE](LICENSE).
