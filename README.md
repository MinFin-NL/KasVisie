# KasVisie — Kasprognose-dashboard

Interactief dashboard voor dagelijkse kasstroomprognoses, gebouwd met
[NL Design System](https://nldesignsystem.nl/) (Rijkshuisstijl Community-tokens +
Utrecht-componenten) en een FastAPI-backend. Alles draait in één Docker-container.

## Schermen

1. **Gegevens** — CSV uploaden (kolommen `date`/`datum` en `cashflow`/`bedrag`/`amount`),
   demo-data laden en de dataset per maand inspecteren (weekend- en feestdagen gemarkeerd).
2. **Prognose** — dagvoorspellingen voor deze én volgende maand met:
   - onzekerheidsband (80%) en backtest-metrieken (pinball-loss, binnen%);
   - weekend- en feestdagmarkering in de grafiek;
   - handmatige bijstelling: sleep een prognosepunt en latere dagen bewegen mee;
   - toggles voor volgende maand, realisatie van vorig jaar en totale volumes
     (incl. %-verschil t.o.v. vorig jaar);
   - keuzemenu voor het voorspelmodel (Gradient Boosting, Random Forest,
     Ridge-regressie, seizoensgemiddelde).

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
