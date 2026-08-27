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

De frontend is platte HTML, CSS en JavaScript — geen framework, en sinds kort ook
geen bouwstap: de browser laadt `index.html`, `src/*.js` en `src/style.css`
rechtstreeks. Er is dus geen Node-toolchain nodig, niet lokaal en niet in de
container.

De UI is opgebouwd uit de web components van het NLDD Design System. Dat komt als
kant-en-klare bundel uit het npm-register (`dist/nldd.min.js` + de CSS en fonts)
en wordt opgehaald door `scripts/fetch_nldd.py`, dat alleen de
Python-standaardbibliotheek gebruikt. Het resultaat staat in `vendor/nldd/` en is
**niet** gecommit.

| Pad | Wat het is |
| --- | --- |
| `index.html` | de pagina; laadt de NLDD-bundel (klassiek, `defer`) en `src/app.js` (module) |
| `src/app.js` | de drie schermen, de gegenereerde markup en alle `/api`-aanroepen |
| `src/chart.js` | de SVG-grafiek; exporteert `KVChart`, geïmporteerd door `app.js` |
| `src/style.css` | eigen CSS bovenop de componenten |
| `scripts/fetch_nldd.py` | haalt het design system op naar `vendor/nldd/` (niet in git) |
| `vendor/nldd/` | de opgehaalde bundel, CSS en fonts die FastAPI serveert |

De volgorde in `<head>` is functioneel. Beide scripts zijn deferred — het
klassieke met `defer`, het module-script impliciet — dus ze draaien pas na het
parsen en in documentvolgorde: het design system registreert al zijn custom
elements vóór `app.js` de eerste markup opbouwt. Een `nldd-*`-element dat naar
zijn inhoud kijkt terwijl die er nog niet is trekt anders de verkeerde conclusie
— `nldd-menu-bar` zet zichzelf op `empty` en verdwijnt. Voeg dus geen script
zonder `defer` toe.

Ophalen (één keer na het clonen, en na elke versiewijziging):

```sh
python scripts/fetch_nldd.py            # → vendor/nldd/
```

Upgraden van het design system: pas `VERSION` in `scripts/fetch_nldd.py` aan,
haal de nieuwe hash op en zet die in `SHA512`:

```sh
python scripts/fetch_nldd.py --version 0.9.0 --print-hash
```

Die hash is het equivalent van de lockfile: het script weigert een tarball die er
niet mee overeenkomt, en de Docker-build gebruikt exact hetzelfde script.

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
`NOTICES.md` in het npm-pakket. Buiten dat kader vervang je in `index.html` de
stylesheet `vendor/nldd/css/global.css` door
`vendor/nldd/css/global-system-font.css` — dezelfde stijlen zonder de
`@font-face`-regels.

## Draaien met Docker

Eén stage, alleen Python: de build haalt het design system zelf op met
`scripts/fetch_nldd.py`. Je hebt netwerk naar het npm-register nodig, geen Node.

```sh
docker build -t kasvisie .
docker run --rm -p 8000:8000 kasvisie
```

Open daarna <http://localhost:8000>. Zonder eigen dataset start de app met
gegenereerde demo-data (30 maanden, incl. vorig jaar).

## Lokaal ontwikkelen

De app draait op **Python 3.11** — dezelfde versie als de container
(`python:3.11-slim`). `.python-version` zet die vast voor pyenv; alle pins in
`requirements.txt` zijn op 3.11 geresolved en getest.

Eén proces: uvicorn serveert zowel de API als de frontend, precies zoals de
container dat doet.

```sh
python3.11 -m venv .venv
source .venv/bin/activate               # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python scripts/fetch_nldd.py            # één keer na het clonen

uvicorn app.main:app --reload           # pagina + API op :8000
```

`--reload` herstart de server bij Python-wijzigingen; voor een wijziging in
`index.html`, `src/app.js` of `src/style.css` is een verversing van de pagina
genoeg (harde verversing als de browser de oude versie vasthoudt).

De backend weigert te starten zonder `vendor/nldd/`, met de melding welk commando
je moet draaien.

## Licentie

Zie [LICENSE](LICENSE).
