FROM node:22-alpine AS frontend

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv/kasvisie

COPY pyproject.toml README.md ./
COPY app ./app

RUN pip install .

COPY --from=frontend /build/dist /srv/kasvisie/dist
ENV KASVISIE_DIST=/srv/kasvisie/dist

# Optioneel: eigen dataset meebakken (anders start de app met demo-data)
COPY data/ ./data/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
