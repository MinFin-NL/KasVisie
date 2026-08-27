# Eén stage, geen Node: de frontend heeft geen bouwstap. Het NLDD Design System
# komt als kant-en-klare bundel uit het npm-register, opgehaald met de
# standaardbibliotheek van Python (scripts/fetch_nldd.py, hash vastgepind).
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv/kasvisie

COPY pyproject.toml README.md ./
COPY app ./app

RUN pip install .

# De frontend: statische bestanden onder /srv/kasvisie/web, aangewezen met
# KASVISIE_WEB omdat de app zelf uit site-packages draait.
COPY index.html ./web/index.html
COPY src ./web/src
COPY scripts/fetch_nldd.py ./scripts/fetch_nldd.py
RUN python scripts/fetch_nldd.py --dest ./web/vendor/nldd
ENV KASVISIE_WEB=/srv/kasvisie/web

# Optioneel: eigen dataset meebakken (anders start de app met demo-data)
COPY data/ ./data/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
