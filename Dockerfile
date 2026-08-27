# ── Stage 1: frontend ──────────────────────────────────────────────────────
# Vite bundelt index.html, src/ en @nldd/design-system tot een statische
# bundel in dist/. `npm ci` gebruikt de versies uit package-lock.json en
# controleert de integriteitshashes.
FROM node:22-alpine AS frontend

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# ── Stage 2: applicatie ────────────────────────────────────────────────────
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv/kasvisie

COPY pyproject.toml README.md ./
COPY app ./app

RUN pip install .

# De app draait uit site-packages, waar geen dist/ naast ligt: de bundel komt
# hierheen en KASVISIE_DIST wijst hem aan.
COPY --from=frontend /build/dist /srv/kasvisie/dist
ENV KASVISIE_DIST=/srv/kasvisie/dist

# Optioneel: eigen dataset meebakken (anders start de app met demo-data)
COPY data/ ./data/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
