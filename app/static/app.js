/* KasVisie frontend: twee schermen (gegevens + prognose) op één pagina. */

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const fmtNum = (v) => (v == null ? "–" : Math.round(v).toLocaleString("nl-NL"));
  const fmtPct = (v) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
  const MONTH_NAMES = ["januari", "februari", "maart", "april", "mei", "juni",
    "juli", "augustus", "september", "oktober", "november", "december"];
  const monthLabel = (ym) => `${MONTH_NAMES[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

  async function api(path, opts) {
    const res = await fetch(path, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || `Fout ${res.status}`);
    return body;
  }

  /* ── Navigatie ─────────────────────────────────────────── */
  function route() {
    const graph = location.hash !== "#data";
    $("#screen-data").hidden = graph;
    $("#screen-grafiek").hidden = !graph;
    $("#tab-data").setAttribute("aria-current", String(!graph));
    $("#tab-grafiek").setAttribute("aria-current", String(graph));
    if (graph) graphScreen.show();
    else dataScreen.show();
  }

  /* ── Scherm 1: gegevens ────────────────────────────────── */
  const dataScreen = {
    records: null,

    async show() {
      if (!this.records) await this.reload();
    },

    async reload() {
      try {
        const data = await api("/api/data");
        this.records = data.records;
        this.renderSummary(data);
        this.renderMonthSelect();
        this.renderTable();
      } catch (err) {
        this.alert(err.message, true);
      }
    },

    renderSummary(s) {
      $("#dataset-summary").innerHTML = `
        <dt>Bron</dt><dd>${s.source}</dd>
        <dt>Aantal dagen</dt><dd>${s.rows}</dd>
        <dt>Periode</dt><dd>${s.start} t/m ${s.end}</dd>
        <dt>Status</dt><dd>${s.ready ? "voldoende data voor prognose" : "te weinig data (min. 60 dagen)"}</dd>`;
    },

    renderMonthSelect() {
      const months = [...new Set(this.records.map((r) => r.date.slice(0, 7)))];
      const sel = $("#table-month");
      sel.innerHTML = months
        .map((m) => `<option value="${m}">${monthLabel(m)}</option>`)
        .join("");
      sel.value = months[months.length - 1];
      sel.onchange = () => this.renderTable();
    },

    renderTable() {
      const month = $("#table-month").value;
      const days = ["ma", "di", "wo", "do", "vr", "za", "zo"];
      $("#data-table-body").innerHTML = this.records
        .filter((r) => r.date.startsWith(month))
        .map((r) => {
          const dow = days[(new Date(r.date).getDay() + 6) % 7];
          const badge = r.holiday
            ? `<span class="rvo-tag rvo-tag--pill rvo-tag--warning">${r.holiday}</span>`
            : r.weekend ? `<span class="rvo-tag rvo-tag--pill">weekend</span>` : "";
          return `<tr class="${r.weekend || r.holiday ? "kv-row--closed" : ""}">
            <td class="rvo-table-cell">${r.date}</td>
            <td class="rvo-table-cell">${dow}</td>
            <td class="rvo-table-cell rvo-table-cell--numeric kv-num">${r.cashflow.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}</td>
            <td class="rvo-table-cell">${badge}</td>
          </tr>`;
        })
        .join("");
    },

    alert(msg, isError) {
      $("#upload-alert").innerHTML =
        `<div class="rvo-alert rvo-alert--padding-sm ${isError ? "rvo-alert--error" : "rvo-alert--success"}">
          <div class="rvo-alert__container">${msg}</div>
        </div>`;
    },
  };

  $("#upload-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const file = $("#upload-file").files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const s = await api("/api/upload", { method: "POST", body: fd });
      dataScreen.alert(`Geüpload: ${s.source} (${s.rows} dagen).`);
      dataScreen.records = null;
      graphScreen.invalidate();
      await dataScreen.reload();
    } catch (err) {
      dataScreen.alert(err.message, true);
    }
  });

  $("#btn-demo").addEventListener("click", async () => {
    const s = await api("/api/demo", { method: "POST" });
    dataScreen.alert(`Demo-data geladen (${s.rows} dagen).`);
    dataScreen.records = null;
    graphScreen.invalidate();
    await dataScreen.reload();
  });

  /* ── Scherm 2: prognose ────────────────────────────────── */
  const graphScreen = {
    cache: {}, // model -> forecast-respons
    adjustments: {}, // datum -> handmatige waarde
    modelsLoaded: false,

    invalidate() {
      this.cache = {};
      this.adjustments = {};
    },

    async show() {
      if (!this.modelsLoaded) {
        const status = await api("/api/status");
        $("#model-select").innerHTML = status.models
          .map((m) => `<option value="${m.key}">${m.label}</option>`)
          .join("");
        this.modelsLoaded = true;
      }
      await this.render();
    },

    async forecast() {
      const model = $("#model-select").value;
      if (!this.cache[model]) this.cache[model] = await api(`/api/forecast?model=${model}`);
      return this.cache[model];
    },

    /* Handmatige bijstelling: latere dagen bewegen mee met een
       exponentieel uitdovende factor (halfwaardetijd ± 5 dagen). */
    applyAdjustments(days) {
      const adj = days.map((d) => (d.pred != null ? d.pred : null));
      const entries = Object.entries(this.adjustments)
        .map(([date, value]) => [days.findIndex((d) => d.date === date), value])
        .filter(([i]) => i >= 0)
        .sort((a, b) => a[0] - b[0]);
      for (const [idx, value] of entries) {
        if (adj[idx] == null) continue;
        const ratio = value / Math.max(adj[idx], 1e-9);
        for (let i = idx; i < adj.length; i++) {
          if (adj[i] == null) continue;
          const decay = Math.exp(-(i - idx) / 7);
          adj[i] *= 1 + (ratio - 1) * decay;
        }
      }
      return days.map((d, i) => ({
        ...d,
        adj: entries.length && d.pred != null ? Math.round(adj[i] * 100) / 100 : null,
      }));
    },

    async render() {
      let fc;
      try {
        fc = await this.forecast();
      } catch (err) {
        $("#kpi-row").innerHTML =
          `<div class="rvo-alert rvo-alert--error rvo-alert--padding-sm">
            <div class="rvo-alert__container">${err.message}</div>
          </div>`;
        return;
      }
      const showNext = $("#toggle-next-month").checked;
      const showLastYear = $("#toggle-last-year").checked;
      const showTotals = $("#toggle-totals").checked;

      let days = this.applyAdjustments(fc.days);
      if (!showNext) days = days.filter((d) => d.date.slice(0, 7) === fc.thisMonth);
      if (!showLastYear) days = days.map((d) => ({ ...d, lastYearActual: null }));

      // Totalen (met bijstellingen meegenomen)
      const sum = (rows, pick) => rows.reduce((acc, d) => acc + (pick(d) ?? 0), 0);
      const expected = (d) => d.actual ?? d.adj ?? d.pred;
      const allDays = this.applyAdjustments(fc.days);
      const thisRows = allDays.filter((d) => d.date.slice(0, 7) === fc.thisMonth);
      const nextRows = allDays.filter((d) => d.date.slice(0, 7) !== fc.thisMonth);
      const totThis = sum(thisRows, expected);
      const totNext = sum(nextRows, expected);
      const lyThis = fc.totals.thisMonthLastYear;
      const lyNext = fc.totals.nextMonthLastYear;

      this.renderKpis(fc, totThis, totNext, showNext);
      this.renderTotals(fc, showTotals, { totThis, totNext, lyThis, lyNext });
      this.renderLegend(fc, showLastYear, days);

      KVChart($("#chart"), days, {
        today: fc.today,
        thisMonth: fc.thisMonth,
        tooltipEl: $("#chart-tooltip"),
        onAdjust: (date, value) => {
          this.adjustments[date] = value;
          this.render();
        },
      });

      const nAdj = Object.keys(this.adjustments).length;
      $("#adjust-bar").hidden = nAdj === 0;
      if (nAdj) {
        $("#adjust-info").textContent =
          `${nAdj} handmatige bijstelling${nAdj > 1 ? "en" : ""} actief - latere dagen zijn evenredig aangepast.`;
      }
      $("#graph-meta").textContent =
        `Model: ${fc.modelLabel} · vandaag: ${fc.today} · backtest: laatste 28 dagen`;
    },

    renderKpis(fc, totThis, totNext, showNext) {
      const kpis = [
        { label: `Verwacht — ${monthLabel(fc.thisMonth)}`, value: fmtNum(totThis) },
        ...(showNext ? [{ label: "Verwacht — volgende maand", value: fmtNum(totNext) }] : []),
        { label: "Binnen band (backtest)", value: `${fc.metrics.coverage_pct}%`, metric: true },
      ];
      $("#kpi-row").innerHTML = kpis
        .map(
          (k) => `<div class="kv-kpi ${k.metric ? "kv-kpi--metric" : ""}">
            <p class="kv-kpi__label">${k.label}</p>
            <p class="kv-kpi__value">${k.value}</p>
          </div>`
        )
        .join("");
    },

    renderTotals(fc, show, t) {
      const panel = $("#totals-panel");
      panel.hidden = !show;
      if (!show) return;
      const pct = (now, then) => (then ? fmtPct(((now - then) / then) * 100) : "–");
      const row = (label, now, then) => `
        <tr><td>${label}</td>
          <td>${fmtNum(now)}</td>
          <td>${fmtNum(then)}</td>
          <td>${pct(now, then)}</td></tr>`;
      panel.innerHTML = `
        <h2 class="utrecht-heading-3">Totale volumes t.o.v. vorig jaar</h2>
        <table>
          <thead><tr><th>Periode</th><th>Verwacht/gerealiseerd</th><th>Vorig jaar</th><th>Verschil</th></tr></thead>
          <tbody>
            ${row(monthLabel(fc.thisMonth), t.totThis, t.lyThis)}
            ${row("volgende maand", t.totNext, t.lyNext)}
          </tbody>
        </table>`;
    },

    renderLegend(fc, showLastYear, days) {
      const items = [
        `<span><span class="swatch" style="border-color:#2f6cb3"></span>Werkelijk</span>`,
        `<span><span class="swatch swatch--dashed" style="border-color:#d52b1e"></span>Prognose (${fc.modelLabel})</span>`,
        `<span><span class="swatch swatch--band"></span>Onzekerheidsband (80%)</span>`,
        ...(days.some((d) => d.adj != null)
          ? [`<span><span class="swatch" style="border-color:#8a1408"></span>Bijgestelde prognose</span>`]
          : []),
        ...(showLastYear
          ? [`<span><span class="swatch swatch--dotted" style="border-color:#3d8757"></span>Werkelijk vorig jaar</span>`]
          : []),
        `<span><span class="swatch swatch--shade"></span>Weekend / feestdag</span>`,
      ];
      $("#chart-legend").innerHTML = items.join("");
    },
  };

  $("#model-select").addEventListener("change", () => graphScreen.render());
  for (const id of ["#toggle-next-month", "#toggle-last-year", "#toggle-totals"]) {
    $(id).addEventListener("change", () => graphScreen.render());
  }
  $("#btn-reset-adjust").addEventListener("click", () => {
    graphScreen.adjustments = {};
    graphScreen.render();
  });

  window.addEventListener("hashchange", route);
  if (!location.hash) location.hash = "#grafiek";
  route();
})();
