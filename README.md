# KasVisie — Kasprognose-dashboard

Interactief dashboard voor dagelijkse kasstroomprognoses, gebouwd met
[NL Design System](https://nldesignsystem.nl/) (Rijkshuisstijl Community-tokens +
Utrecht-componenten) en een FastAPI-backend. Alles draait in één Docker-container.

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
   - toggles voor volgende maand, realisatie van vorig jaar, totale volumes en
     volledige schaal;
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

### Grenzen aan bijstellingen

Een bijstelling verandert een dag met een verhouding t.o.v. de modelprognose.
Die verhouding is begrensd op 0,2× – 5×, zowel per losse bijstelling als
cumulatief. Weekend- en feestdagen zijn niet bij te stellen: hun prognose is
structureel nul, waardoor een verhouding daar betekenisloos is.

## Draaien met Docker

```sh
docker build -t kasvisie .
docker run --rm -p 8000:8000 kasvisie
```

Open daarna <http://localhost:8000>. Zonder eigen dataset start de app met
gegenereerde demo-data (30 maanden, incl. vorig jaar).

## Lokaal ontwikkelen

```sh
uv sync
uv run uvicorn app.main:app --reload
```

## Licentie

Zie [LICENSE](LICENSE).
