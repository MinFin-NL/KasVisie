"""Modelkaart: uitleg, herkomst en versiebeheer van de voorspelmodellen.

Opzet volgt de gangbare 'model card'-indeling en de vragen die het
Algoritmeregister van de Nederlandse overheid stelt: waarvoor is het bedoeld,
hoe werkt het, waarop is het getraind, hoe goed is het, en wat zijn de grenzen.

Twee dingen bepalen samen welke uitkomst je krijgt en worden daarom apart
vastgelegd:

* de **modelversie** — de code en instellingen (handmatig bijgehouden in
  CHANGELOG hieronder, met de bijbehorende commit);
* de **datavingerafdruk** — een hash van de dataset waarop getraind is.

Met dat paar is een prognose achteraf te herleiden.
"""

from __future__ import annotations

import hashlib
from datetime import date

import pandas as pd

from . import models
from .data import NL_HOLIDAYS

STATUS = "bèta"
CONTACT = "innovatiemanagamentfinancien@minfin.nl"
OWNER = "Ministerie van Financiën — Innovatiemanagement"

# Versiegeschiedenis per model. Nieuwe regel bovenaan toevoegen bij elke
# wijziging die de uitkomst kan veranderen (features, hyperparameters,
# nabewerking). De commit maakt de wijziging terug te vinden.
CHANGELOG: dict[str, list[dict]] = {
    "gbr": [
        {
            "version": "1.1.0",
            "date": "2026-08-13",
            "commit": None,
            "changes": [
                "Alleen Gradient Boosting wordt nog aangeboden; de overige modellen "
                "zijn tijdelijk uit de selectie gehaald.",
                "Modelkaart en versieregistratie toegevoegd.",
            ],
        },
        {
            "version": "1.0.0",
            "date": "2026-07-13",
            "commit": "c7845e3",
            "changes": [
                "Eerste versie in het dashboard: quantile Gradient Boosting met "
                "kalenderkenmerken en een 80%-onzekerheidsband.",
                "Band wordt dichtgeknepen op weekend- en feestdagen.",
            ],
        },
    ],
}

PURPOSE = {
    "goal": "Een dagelijkse prognose van de kasontvangsten voor de lopende en de "
            "volgende maand, zodat de kaspositie vooruit te plannen is.",
    "users": "Medewerkers kasbeheer en treasury binnen het Ministerie van Financiën.",
    "decision": "Het model doet geen uitspraken over personen en neemt geen besluiten. "
                "De uitkomst is een hulpmiddel bij een menselijke inschatting; de "
                "gebruiker kan elke dag handmatig bijstellen.",
    "not_for": [
        "Besluitvorming over individuen of organisaties.",
        "Verantwoording achteraf — gebruik daarvoor de gerealiseerde cijfers.",
        "Prognoses verder vooruit dan het einde van de volgende maand.",
    ],
}

FEATURES = [
    ("dow", "Weekdag (0 = maandag)", "Ontvangsten verschillen sterk per weekdag."),
    ("dom", "Dag van de maand", "Vangt vaste betaalmomenten binnen de maand op."),
    ("month", "Maandnummer", "Seizoenseffecten over het jaar."),
    ("is_weekend", "Weekend (ja/nee)", "Op zaterdag en zondag is er nauwelijks verkeer."),
    ("is_holiday", "Nederlandse feestdag (ja/nee)", "Feestdagen gedragen zich als weekenddagen."),
    ("settlement_window", "Betaalvenster: 24e t/m 29e", "Rond het maandeinde piekt de afwikkeling."),
    ("days_to_eom", "Dagen tot einde maand", "Maakt de aanloop naar het maandeinde expliciet."),
    ("t", "Tijdstrend in jaren", "Vangt geleidelijke groei of krimp op."),
]

HYPERPARAMETERS = [
    ("Algoritme", "GradientBoostingRegressor (scikit-learn)"),
    ("Verliesfunctie", "quantile"),
    ("Kwantielen", "0,10 · 0,50 · 0,90 — drie afzonderlijk getrainde modellen"),
    ("Aantal bomen", "200"),
    ("Maximale diepte", "3"),
    ("random_state", "0 — vaste waarde, dus dezelfde data geeft dezelfde uitkomst"),
]

POSTPROCESSING = [
    "Op weekend- en feestdagen wordt de voorspelling begrensd op het mediane niveau "
    "van gesloten dagen in de trainingsdata, en de band navenant dichtgeknepen.",
    "Negatieve voorspellingen worden op nul gezet.",
    "De ondergrens wordt nooit boven de puntvoorspelling gelegd, de bovengrens nooit eronder.",
]

LIMITATIONS = [
    "Het model kent alleen de kalender en de eigen historie. Beleidswijzigingen, "
    "incidentele grote posten of externe schokken zitten er niet in.",
    "De onzekerheidsband is gekalibreerd op het verleden. Bij een structuurbreuk "
    "klopt de band niet meer.",
    "Handmatige bijstellingen zijn aannames van de gebruiker, geen modeluitkomst. "
    "Ze worden in de export apart als scenariokolom bijgehouden.",
    "De backtest beslaat de laatste 28 dagen. Dat is een korte periode: "
    "één afwijkende maand beïnvloedt het cijfer sterk.",
    "Bij minder dan 60 dagen historie weigert de applicatie een prognose te maken.",
]


def data_fingerprint(df: pd.DataFrame) -> str:
    """Korte hash over datums en bedragen; identificeert de trainingsset."""
    if df is None or df.empty:
        return "—"
    payload = "\n".join(
        f"{d.date().isoformat()}:{float(v):.4f}" for d, v in zip(df["date"], df["cashflow"])
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:10]


def version(model_key: str) -> str:
    entries = CHANGELOG.get(model_key)
    return entries[0]["version"] if entries else "0.0.0"


def training_data(store) -> dict:
    """Feitelijke beschrijving van de dataset waarop nu getraind wordt."""
    df = store.df
    if df is None or df.empty:
        return {"available": False}

    dates = pd.DatetimeIndex(df["date"])
    values = df["cashflow"].to_numpy(dtype=float)
    weekend = (dates.dayofweek >= 5)
    holiday = pd.Series([d.date() in NL_HOLIDAYS for d in dates]).to_numpy()
    closed = weekend | holiday
    zero = values == 0.0

    return {
        "available": True,
        "source": store.source,
        "start": dates.min().date().isoformat(),
        "end": dates.max().date().isoformat(),
        "days": int(len(df)),
        "weekendDays": int(weekend.sum()),
        "holidayDays": int(holiday.sum()),
        "zeroDays": int(zero.sum()),
        # Nulwaarden op een gewone werkdag zijn verdacht: dat kan een echte
        # nuldag zijn, maar ook een ontbrekende dag die met 0 is aangevuld.
        "zeroOnOpenDays": int((zero & ~closed).sum()),
        "mean": round(float(values.mean()), 2),
        "median": round(float(pd.Series(values).median()), 2),
        "max": round(float(values.max()), 2),
        "fingerprint": data_fingerprint(df),
        "trainedOn": "Alle beschikbare dagen; de backtest houdt de laatste "
                     f"{models.BACKTEST_DAYS} dagen apart.",
    }


def build(model_key: str, store, metrics: dict | None) -> dict:
    """Stelt de volledige modelkaart samen."""
    entries = CHANGELOG.get(model_key, [])
    return {
        "key": model_key,
        "label": models.MODELS.get(model_key) or models.FUTURE_MODELS.get(model_key, model_key),
        "description": models.MODEL_DESCRIPTIONS.get(model_key, ""),
        "version": version(model_key),
        "status": STATUS,
        "updated": entries[0]["date"] if entries else None,
        "owner": OWNER,
        "contact": CONTACT,
        "available": model_key in models.MODELS,
        "generatedOn": date.today().isoformat(),
        "purpose": PURPOSE,
        "howItWorks": {
            "features": [{"name": n, "label": l, "why": w} for n, l, w in FEATURES],
            "hyperparameters": [{"name": n, "value": v} for n, v in HYPERPARAMETERS],
            "postprocessing": POSTPROCESSING,
            "backtestDays": models.BACKTEST_DAYS,
            "quantiles": [models.Q_LO, models.Q_HI],
        },
        "trainingData": training_data(store),
        "performance": metrics,
        "limitations": LIMITATIONS,
        "changelog": entries,
    }
