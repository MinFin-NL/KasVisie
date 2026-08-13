/* KasVisie frontend: twee schermen (gegevens + prognose) op één pagina. */

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  /* ── Geldweergave ──────────────────────────────────────────
     Alles in deze tool is een bedrag. Een kaal getal is niet te
     interpreteren, dus elke waarde krijgt een valutateken. */
  const money = (digits) =>
    new Intl.NumberFormat("nl-NL", {
      style: "currency", currency: "EUR",
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    });
  const EUR0 = money(0), EUR2 = money(2);
  // minimumFractionDigits expliciet op 0: anders levert compacte notatie
  // aslabels als "€ 250,0" in plaats van "€ 250".
  const EUR_COMPACT = new Intl.NumberFormat("nl-NL", {
    style: "currency", currency: "EUR", notation: "compact",
    minimumFractionDigits: 0, maximumFractionDigits: 1,
  });

  // Centen alleen tonen waar ze betekenis hebben; boven de 10.000 zijn ze ruis.
  const fmtMoney = (v) =>
    v == null ? "–" : (Math.abs(v) >= 10000 ? EUR0 : EUR2).format(v);
  const fmtMoney0 = (v) => (v == null ? "–" : EUR0.format(v));
  const fmtAxis = (v) => EUR_COMPACT.format(v);
  const fmtPct = (v) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

  const MONTH_NAMES = ["januari", "februari", "maart", "april", "mei", "juni",
    "juli", "augustus", "september", "oktober", "november", "december"];
  const monthLabel = (ym) => `${MONTH_NAMES[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
  const dateLabel = (iso) =>
    `${+iso.slice(8, 10)} ${MONTH_NAMES[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
  const shortDate = (iso) => `${+iso.slice(8, 10)} ${MONTH_NAMES[+iso.slice(5, 7) - 1].slice(0, 3)}`;

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* Bijstellingen: een sleep of invoer verandert de prognose met een verhouding
     die uitdooft over latere dagen. De verhouding wordt begrensd, anders laat
     één actie op een dag met een prognose van bijna nul het totaal ontploffen. */
  const RATIO_MIN = 0.2, RATIO_MAX = 5, DECAY_DAYS = 7;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  // Nederlandse notatie: 0,2× in plaats van 0.2×.
  const fmtFactor = (v) => v.toLocaleString("nl-NL");

  /* Onderscheidbaar en CVD-veilig; wijkt af van de basisreeksen (blauw, rood,
     groen) zodat scenariolijnen niet met het model verward worden. */
  const SCENARIO_COLORS = ["#8a1408", "#5b3a9e", "#b3560a", "#00706b", "#7a1a5c"];

  async function api(path, opts) {
    const res = await fetch(path, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || `Fout ${res.status}`);
    return body;
  }

  /* ── Navigatie ─────────────────────────────────────────── */
  const SCREENS = {
    "#data": { section: "#screen-data", tab: "#tab-data", show: () => dataScreen.show() },
    "#grafiek": { section: "#screen-grafiek", tab: "#tab-grafiek", show: () => graphScreen.show() },
    "#model": { section: "#screen-model", tab: "#tab-model", show: () => modelScreen.show() },
  };

  function route() {
    const current = SCREENS[location.hash] ? location.hash : "#grafiek";
    for (const [hash, s] of Object.entries(SCREENS)) {
      const active = hash === current;
      $(s.section).hidden = !active;
      $(s.tab).setAttribute("aria-current", String(active));
    }
    SCREENS[current].show();
  }

  /* Melding over de actualiteit van de dataset. De app rekent vanaf de laatste
     meetdag; als die ver achterloopt moet dat expliciet zichtbaar zijn. */
  function freshnessHtml(info) {
    if (!info) return "";
    // De samenvatting noemt de laatste meetdag "end", de prognose
    // "lastObservation"; beide schermen gebruiken deze melding.
    const last = info.end || info.lastObservation;
    if (info.staleDays == null || !last) return "";
    if (info.staleDays <= 2) return "";
    const level = info.staleDays > 31 ? "warning" : "info";
    return `<div class="rvo-alert rvo-alert--${level} rvo-alert--padding-sm kv-alert">
      <div class="rvo-alert__container">
        Data loopt t/m <strong>${dateLabel(last)}</strong> — ${info.staleDays} dagen geleden.
        De prognose start daarom op ${dateLabel(info.forecastStart || last)}, niet vandaag.
      </div>
    </div>`;
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
        <dt>Bron</dt><dd>${escapeHtml(s.source)}</dd>
        <dt>Aantal dagen</dt><dd>${s.rows}</dd>
        <dt>Periode</dt><dd>${s.start} t/m ${s.end}</dd>
        <dt>Status</dt><dd>${s.ready ? "voldoende data voor prognose" : "te weinig data (min. 60 dagen)"}</dd>`;
      $("#data-freshness").innerHTML = freshnessHtml(s);
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
            ? `<span class="rvo-tag rvo-tag--pill rvo-tag--warning">${escapeHtml(r.holiday)}</span>`
            : r.weekend ? `<span class="rvo-tag rvo-tag--pill">weekend</span>` : "";
          return `<tr class="${r.weekend || r.holiday ? "kv-row--closed" : ""}">
            <td class="rvo-table-cell">${r.date}</td>
            <td class="rvo-table-cell">${dow}</td>
            <td class="rvo-table-cell rvo-table-cell--numeric kv-num">${EUR2.format(r.cashflow)}</td>
            <td class="rvo-table-cell">${badge}</td>
          </tr>`;
        })
        .join("");
    },

    alert(msg, isError) {
      $("#upload-alert").innerHTML =
        `<div class="rvo-alert rvo-alert--padding-sm ${isError ? "rvo-alert--error" : "rvo-alert--success"}">
          <div class="rvo-alert__container">${escapeHtml(msg)}</div>
        </div>`;
    },
  };

  $("#upload-file").addEventListener("change", () => {
    const file = $("#upload-file").files[0];
    $("#upload-file-name").textContent = file ? file.name : "Geen bestand gekozen";
  });

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
      // De modelkaart beschrijft de dataset; die is nu een andere.
      modelScreen.loadedFor = null;
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
    modelScreen.loadedFor = null;
    await dataScreen.reload();
  });

  /* ── Scherm 2: prognose ────────────────────────────────── */
  const graphScreen = {
    cache: {}, // model -> forecast-respons
    scenarios: [], // [{id, name, color, adjustments: {datum: waarde}}]
    activeId: null,
    modelsLoaded: false,
    seq: 0,
    clampedCount: 0,
    focusDate: null, // laatst gefocuste punt, om focus te herstellen na hertekenen
    editorDate: null,
    lastInfo: null,

    invalidate() {
      this.cache = {};
      this.scenarios = [];
      this.activeId = null;
      this.closeEditor();
    },

    /* ── Scenariobeheer ───────────────────────────────────── */
    ensureScenario() {
      if (!this.scenarios.length) this.addScenario();
      if (!this.scenarios.some((s) => s.id === this.activeId)) {
        this.activeId = this.scenarios[0].id;
      }
      return this.active();
    },

    active() {
      return this.scenarios.find((s) => s.id === this.activeId) || null;
    },

    addScenario(from) {
      const id = `sc${++this.seq}`;
      const used = new Set(this.scenarios.map((s) => s.color));
      const color = SCENARIO_COLORS.find((c) => !used.has(c)) ||
        SCENARIO_COLORS[this.scenarios.length % SCENARIO_COLORS.length];
      const scenario = {
        id,
        name: from ? `${from.name} (kopie)`.slice(0, 60) : `Scenario ${this.seq}`,
        color,
        adjustments: from ? { ...from.adjustments } : {},
      };
      this.scenarios.push(scenario);
      this.activeId = id;
      return scenario;
    },

    /* ── Bijstellingspad ──────────────────────────────────────
       Latere dagen bewegen mee met een exponentieel uitdovende factor
       (halfwaardetijd ± 5 dagen). De verhouding wordt begrensd en dagen met een
       prognose onder de vloer (weekend, feestdag) worden overgeslagen — daar is
       een verhouding betekenisloos. */
    computePath(days, adjustments, floor) {
      const base = days.map((d) => (d.pred != null ? d.pred : null));
      const adj = base.slice();
      let firstIdx = Infinity;
      let clamped = 0;

      const entries = Object.entries(adjustments)
        .map(([date, value]) => [days.findIndex((d) => d.date === date), value])
        .filter(([i]) => i >= 0 && base[i] != null && base[i] >= floor)
        .sort((a, b) => a[0] - b[0]);

      for (const [idx, value] of entries) {
        // Deler nooit onder de vloer: anders schiet de verhouding naar oneindig.
        const denom = Math.max(adj[idx], floor, 1e-6);
        const raw = value / denom;
        const ratio = clamp(raw, RATIO_MIN, RATIO_MAX);
        if (Math.abs(raw - ratio) > 1e-9) clamped++;
        firstIdx = Math.min(firstIdx, idx);
        for (let i = idx; i < adj.length; i++) {
          if (adj[i] == null) continue;
          const decay = Math.exp(-(i - idx) / DECAY_DAYS);
          adj[i] = Math.max(0, adj[i] * (1 + (ratio - 1) * decay));
          // Ook cumulatief begrenzen: losse bijstellingen zijn elk begrensd,
          // maar zonder deze grens stapelen ze multiplicatief door.
          adj[i] = clamp(adj[i], RATIO_MIN * base[i], RATIO_MAX * base[i]);
        }
      }

      return {
        // Alleen vanaf de eerste bijstelling een lijn; daarvoor is er niets
        // bijgesteld en zou hij de prognoselijn alleen maar overtekenen.
        values: days.map((d, i) =>
          i >= firstIdx && base[i] != null ? Math.round(adj[i] * 100) / 100 : null),
        clamped,
        count: entries.length,
      };
    },

    async show() {
      if (!this.modelsLoaded) {
        this.skeleton(true);
        const status = await api("/api/status");
        this.models = status.models || [];
        this.modelKey = this.models.length ? this.models[0].key : "gbr";

        // Eén model: geen keuzemenu, alleen de naam. Biedt de server er later
        // meer aan, dan verschijnt het menu zonder verdere aanpassing.
        const single = this.models.length <= 1;
        $("#model-select-wrapper").hidden = single;
        $("#model-static").hidden = !single;
        $("#model-label").setAttribute("for", single ? "model-static" : "model-select");
        if (single) {
          $("#model-static").textContent = this.models.length ? this.models[0].label : "–";
        } else {
          $("#model-select").innerHTML = this.models
            .map((m) => `<option value="${m.key}">${escapeHtml(m.label)}</option>`)
            .join("");
          $("#model-select").value = this.modelKey;
        }
        this.modelsLoaded = true;
        this.renderModelDescription();
      }
      this.ensureScenario();
      await this.render();
    },

    renderModelDescription() {
      const m = (this.models || []).find((x) => x.key === this.modelKey);
      $("#model-description").textContent = m ? m.description : "";
    },

    /* Placeholders in plaats van een leeg vlak: een prognose kost tot ~600 ms
       en zonder feedback lijkt de applicatie in die tijd stuk. */
    skeleton(on) {
      $("#chart-card").classList.toggle("is-busy", on);
      if (!on) return;
      if ($("#kpi-row").dataset.state !== "skeleton") {
        $("#kpi-row").dataset.state = "skeleton";
        $("#kpi-row").innerHTML = Array.from({ length: 3 }, () =>
          `<div class="kv-kpi kv-kpi--skeleton" aria-hidden="true">
            <p class="kv-kpi__label"><span class="kv-shimmer kv-shimmer--sm"></span></p>
            <p class="kv-kpi__value"><span class="kv-shimmer kv-shimmer--lg"></span></p>
          </div>`).join("");
      }
    },

    async forecast() {
      const model = this.modelKey;
      if (!this.cache[model]) {
        this.skeleton(true);
        $("#graph-status").textContent = "Prognose berekenen…";
        try {
          this.cache[model] = await api(`/api/forecast?model=${model}`);
        } finally {
          $("#graph-status").textContent = "";
        }
      }
      return this.cache[model];
    },

    async render() {
      let fc;
      try {
        fc = await this.forecast();
      } catch (err) {
        this.skeleton(false);
        $("#kpi-row").dataset.state = "error";
        $("#kpi-row").innerHTML =
          `<div class="rvo-alert rvo-alert--error rvo-alert--padding-sm">
            <div class="rvo-alert__container">${escapeHtml(err.message)}</div>
          </div>`;
        return;
      }
      this.skeleton(false);
      $("#kpi-row").dataset.state = "ready";
      this.ensureScenario();

      const showNext = $("#toggle-next-month").checked;
      const showLastYear = $("#toggle-last-year").checked;
      const showTotals = $("#toggle-totals").checked;
      const floor = fc.dragFloor || 0;

      // Paden over de volle horizon; daarna pas filteren voor de weergave.
      const paths = new Map();
      let clamped = 0;
      for (const s of this.scenarios) {
        const p = this.computePath(fc.days, s.adjustments, floor);
        paths.set(s.id, p);
        if (s.id === this.activeId) clamped = p.clamped;
      }
      this.clampedCount = clamped;

      const keep = fc.days.map((d) => showNext || d.date.slice(0, 7) === fc.thisMonth);
      let days = fc.days.filter((_, i) => keep[i]);
      if (!showLastYear) days = days.map((d) => ({ ...d, lastYearActual: null }));

      const chartScenarios = this.scenarios
        .filter((s) => paths.get(s.id).count > 0)
        .map((s) => ({
          id: s.id, name: s.name, color: s.color,
          active: s.id === this.activeId,
          values: paths.get(s.id).values.filter((_, i) => keep[i]),
        }));

      // Totalen: realisatie wint, daarna het actieve scenario, daarna de basis.
      const activePath = paths.get(this.activeId);
      const expected = (d, i) => d.actual ?? activePath.values[i] ?? d.pred;
      const totals = (pred) => fc.days.reduce(
        (acc, d, i) => acc + (pred(d, i) ? (expected(d, i) ?? 0) : 0), 0);
      const inThis = (d) => d.date.slice(0, 7) === fc.thisMonth;
      const totThis = totals((d) => inThis(d));
      const totNext = totals((d) => !inThis(d));

      $("#graph-freshness").innerHTML = freshnessHtml(fc);
      // De totalen volgen het actieve scenario; dat moet op de tegel staan,
      // anders verandert het bedrag zonder dat het label meebeweegt. Een
      // bijstelling werkt alleen vóóruit, dus alleen de maand van de eerste
      // bijstelling en de maanden daarna zijn geraakt.
      const s = this.active();
      const adjusted = Object.keys(s.adjustments)
        .filter((date) => {
          const d = fc.days.find((x) => x.date === date);
          return d && d.pred != null && d.pred >= floor;
        })
        .sort();
      const firstMonth = adjusted.length ? adjusted[0].slice(0, 7) : null;
      const note = (ym) =>
        firstMonth && ym >= firstMonth
          ? `incl. ${activePath.count} bijstelling${activePath.count > 1 ? "en" : ""} · ${s.name}`
          : null;
      const nextMonthYm = (fc.days.map((d) => d.date.slice(0, 7))
        .find((ym) => ym !== fc.thisMonth)) || fc.thisMonth;
      this.renderKpis(fc, totThis, totNext, showNext, note(fc.thisMonth), note(nextMonthYm));
      this.renderTotals(fc, showTotals, {
        totThis, totNext,
        lyThis: fc.totals.thisMonthLastYear,
        lyNext: fc.totals.nextMonthLastYear,
      });
      this.renderScenarioTabs(paths);

      const info = KVChart($("#chart"), days, {
        forecastStart: fc.forecastStart,
        thisMonth: fc.thisMonth,
        tooltipEl: $("#chart-tooltip"),
        dragFloor: floor,
        ratioMax: RATIO_MAX,
        scenarios: chartScenarios,
        focusDate: this.focusDate,
        fmtMoney,
        fmtAxis,
        onAdjust: (date, value) => this.setAdjustment(date, value),
        onRemove: (date) => this.removeAdjustment(date),
        onOpenEditor: (date) => this.openEditor(date, fc),
      });
      this.lastInfo = info;
      this.lastForecast = fc;
      this.renderLegend(info, days);
      this.renderAdjustPanel(fc, floor);
      if (this.editorDate) this.positionEditor();

      // Bij één model staat de naam al bovenaan de zijbalk; niet herhalen.
      const modelPart = (this.models || []).length > 1 ? `Model: ${fc.modelLabel} · ` : "";
      $("#graph-meta").textContent =
        `${modelPart}prognose vanaf ${dateLabel(fc.forecastStart)} · backtest: laatste 28 dagen`;
    },

    /* ── Bijstellingen muteren ────────────────────────────── */
    setAdjustment(date, value) {
      const s = this.ensureScenario();
      s.adjustments[date] = value;
      this.render();
    },

    removeAdjustment(date) {
      const s = this.active();
      if (!s) return;
      delete s.adjustments[date];
      if (this.editorDate === date) this.closeEditor();
      this.render();
    },

    /* ── Scenariotabs ─────────────────────────────────────── */
    renderScenarioTabs(paths) {
      $("#scenario-tabs").innerHTML = this.scenarios.map((s) => {
        const count = paths ? paths.get(s.id).count : 0;
        const isActive = s.id === this.activeId;
        return `<button type="button" role="tab" class="kv-scenario-tab" data-id="${s.id}"
                  aria-selected="${isActive}" tabindex="${isActive ? 0 : -1}">
          <span class="kv-scenario-tab__dot" style="background:${s.color}"></span>
          ${escapeHtml(s.name)}
          <span class="kv-scenario-tab__count">${count}</span>
        </button>`;
      }).join("");

      const nameInput = $("#scenario-name");
      // Alleen bijwerken als een ánder scenario actief werd; anders springt de
      // cursor weg terwijl de gebruiker de naam typt.
      if (this._nameFor !== this.activeId) {
        this._nameFor = this.activeId;
        const s = this.active();
        nameInput.value = s ? s.name : "";
      }
      $("#btn-del-scenario").disabled = this.scenarios.length <= 1;
    },

    /* ── Lijst met bijstellingen, elk apart te verwijderen ── */
    renderAdjustPanel(fc, floor) {
      const s = this.active();
      const panel = $("#adjust-panel");
      if (!s) { panel.hidden = true; return; }
      const entries = Object.entries(s.adjustments)
        .map(([date, value]) => {
          const day = fc.days.find((d) => d.date === date);
          return day && day.pred != null ? { date, value, base: day.pred } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.date.localeCompare(b.date));

      panel.hidden = false;
      $("#adjust-list").innerHTML = entries.length
        ? entries.map((e) => {
            const shown = clamp(e.value, RATIO_MIN * e.base, RATIO_MAX * e.base);
            const pct = e.base ? ((shown - e.base) / e.base) * 100 : 0;
            const dir = pct >= 0 ? "up" : "down";
            return `<li class="kv-adjust-item">
              <span class="kv-adjust-item__date">${shortDate(e.date)}</span>
              <span class="kv-adjust-item__values">
                <span class="kv-adjust-item__base">${fmtMoney(e.base)}</span>
                <span aria-hidden="true">→</span>
                <strong>${fmtMoney(shown)}</strong>
                <span class="kv-adjust-item__pct kv-adjust-item__pct--${dir}">${fmtPct(pct)}</span>
              </span>
              <span class="kv-adjust-item__actions">
                <button type="button" class="kv-linkbutton" data-edit="${e.date}">Wijzigen</button>
                <button type="button" class="kv-linkbutton kv-linkbutton--danger" data-remove="${e.date}"
                        aria-label="Bijstelling van ${dateLabel(e.date)} verwijderen">Verwijderen</button>
              </span>
            </li>`;
          }).join("")
        : `<li class="kv-adjust-empty">Nog geen bijstellingen in dit scenario.
             Klik een prognosepunt aan om er een toe te voegen.</li>`;

      const n = entries.length;
      const clampNote = this.clampedCount
        ? ` ${this.clampedCount} bijstelling${this.clampedCount > 1 ? "en zijn" : " is"} begrensd
           tot maximaal ${fmtFactor(RATIO_MAX)}× of minimaal ${fmtFactor(RATIO_MIN)}× de modelprognose.`
        : "";
      $("#adjust-info").innerHTML = n
        ? `<strong>${n} bijstelling${n > 1 ? "en" : ""}</strong> in dit scenario — latere dagen
           bewegen evenredig mee.${clampNote}`
        : "";
      $("#btn-reset-adjust").hidden = n === 0;
    },

    /* ── Exacte invoer voor één dag ───────────────────────── */
    openEditor(date, fc) {
      const forecast = fc || this.lastForecast;
      const day = forecast && forecast.days.find((d) => d.date === date);
      if (!day || day.pred == null) return;
      const s = this.ensureScenario();
      this.editorDate = date;

      const current = s.adjustments[date] != null ? s.adjustments[date] : day.pred;
      $("#editor-title").textContent = dateLabel(date);
      $("#editor-base").innerHTML =
        `Modelprognose: <strong>${fmtMoney(day.pred)}</strong><br>
         Toegestaan: ${fmtMoney(RATIO_MIN * day.pred)} – ${fmtMoney(RATIO_MAX * day.pred)}`;
      const input = $("#editor-value");
      input.min = (RATIO_MIN * day.pred).toFixed(2);
      input.max = (RATIO_MAX * day.pred).toFixed(2);
      // Stap fijn genoeg om centen te kunnen zetten, ook bij grote bedragen.
      input.step = "0.01";
      input.value = (Math.round(current * 100) / 100).toFixed(2);
      $("#editor-remove").hidden = s.adjustments[date] == null;

      $("#point-editor").hidden = false;
      this.updateEditorDelta();
      this.positionEditor();
      input.focus();
      input.select();
    },

    updateEditorDelta() {
      const fc = this.lastForecast;
      const day = fc && fc.days.find((d) => d.date === this.editorDate);
      if (!day) return;
      const value = parseFloat($("#editor-value").value);
      const el = $("#editor-delta");
      if (!isFinite(value)) { el.textContent = ""; return; }
      const pct = day.pred ? ((value - day.pred) / day.pred) * 100 : 0;
      const outside = value < RATIO_MIN * day.pred - 1e-9 || value > RATIO_MAX * day.pred + 1e-9;
      el.textContent = outside
        ? `${fmtPct(pct)} — buiten bereik, wordt begrensd`
        : `${fmtPct(pct)} t.o.v. de modelprognose`;
      el.classList.toggle("is-warning", outside);
    },

    positionEditor() {
      const box = $("#point-editor");
      if (box.hidden || !this.lastInfo || !this.lastInfo.pointRect) return;
      const rect = this.lastInfo.pointRect(this.editorDate);
      const wrap = $(".kv-chart-wrap");
      if (!rect) return;
      const wrapRect = wrap.getBoundingClientRect();
      const left = rect.left - wrapRect.left + wrap.scrollLeft + 14;
      const top = rect.top - wrapRect.top + 14;
      box.style.left =
        Math.max(8, Math.min(left, wrap.scrollLeft + wrap.clientWidth - box.offsetWidth - 8)) + "px";
      box.style.top =
        Math.max(8, Math.min(top, wrap.clientHeight - box.offsetHeight - 8)) + "px";
    },

    closeEditor(refocus) {
      const date = this.editorDate;
      $("#point-editor").hidden = true;
      this.editorDate = null;
      if (refocus && date && this.lastInfo && this.lastInfo.pointRect) {
        this.focusDate = date;
        const svg = $("#chart");
        const c = svg.querySelector(`circle[data-date="${date}"]`);
        if (c) c.focus({ preventScroll: true });
      }
    },

    applyEditor() {
      const value = parseFloat($("#editor-value").value);
      if (!isFinite(value) || value < 0) return;
      const date = this.editorDate;
      this.closeEditor();
      this.focusDate = date;
      this.setAdjustment(date, value);
    },

    /* ── Export ───────────────────────────────────────────── */
    async exportAs(fmt) {
      const status = $("#export-status");
      const fc = this.lastForecast || (await this.forecast());
      const floor = fc.dragFloor || 0;
      status.textContent = "Bestand maken…";
      try {
        const scenarios = this.scenarios
          .map((s) => {
            const { values, count } = this.computePath(fc.days, s.adjustments, floor);
            if (!count) return null;
            const path = {};
            fc.days.forEach((d, i) => { if (values[i] != null) path[d.date] = values[i]; });
            return { name: s.name, path };
          })
          .filter(Boolean);

        const res = await fetch("/api/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format: fmt, model: fc.model, scenarios }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Export mislukt (${res.status})`);
        }
        const blob = await res.blob();
        const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
        const name = match ? match[1] : `kasvisie-prognose.${fmt}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        status.textContent = `${name} gedownload${scenarios.length ? ` (${scenarios.length} scenario's)` : ""}.`;
      } catch (err) {
        status.textContent = err.message;
      }
    },

    renderKpis(fc, totThis, totNext, showNext, noteThis, noteNext) {
      const cov = fc.metrics.coverage_pct;
      const target = fc.metrics.coverage_target;
      // Een band van 80% hoort ~80% van de dagen te bevatten. Te laag betekent
      // overmoedig, te hoog betekent nutteloos breed. Beide zijn geen succes.
      const off = cov - target;
      const state = Math.abs(off) <= 2 ? "ok" : "warn";
      const covNote = Math.abs(off) <= 2
        ? "goed gekalibreerd"
        : off < 0 ? "band te smal — model is overmoedig" : "band te breed — weinig informatief";

      const kpis = [
        { label: `Verwacht — ${monthLabel(fc.thisMonth)}`, value: fmtMoney0(totThis), note: noteThis },
        ...(showNext
          ? [{ label: "Verwacht — volgende maand", value: fmtMoney0(totNext), note: noteNext }]
          : []),
        { label: `Binnen band (doel: ${target}%)`, value: `${cov}%`, note: covNote, state },
      ];
      $("#kpi-row").innerHTML = kpis
        .map(
          (k) => `<div class="kv-kpi ${k.state ? `kv-kpi--${k.state}` : ""}">
            <p class="kv-kpi__label">${k.label}</p>
            <p class="kv-kpi__value">${k.value}</p>
            ${k.note ? `<p class="kv-kpi__note">${escapeHtml(k.note)}</p>` : ""}
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
          <td>${fmtMoney0(now)}</td>
          <td>${fmtMoney0(then)}</td>
          <td>${pct(now, then)}</td></tr>`;
      const lag = fc.lastYearLagDays || 364;
      panel.innerHTML = `
        <h2 class="utrecht-heading-3">Totale volumes t.o.v. vorig jaar</h2>
        <table>
          <thead><tr><th>Periode</th><th>Verwacht/gerealiseerd</th>
            <th>Vorig jaar</th><th>Verschil</th></tr></thead>
          <tbody>
            ${row(monthLabel(fc.thisMonth), t.totThis, t.lyThis)}
            ${row("volgende maand", t.totNext, t.lyNext)}
          </tbody>
        </table>
        <p class="kv-hint">
          "Vorig jaar" is de periode van ${lag} dagen (${Math.round(lag / 7)} weken) eerder, zodat
          de weekdagen gelijk lopen en beide periodes evenveel werk- en weekenddagen bevatten.
        </p>`;
    },

    /* De legenda volgt wat er daadwerkelijk getekend is; anders staat er een
       regel voor een lijn die nergens in beeld is. */
    renderLegend(info, days) {
      const items = (info ? info.series : []).map(
        (s) => `<span><span class="swatch swatch--${s.swatch}" style="border-color:${s.color}"></span>${s.label}</span>`
      );
      for (const s of (info ? info.scenarios : [])) {
        items.push(`<span><span class="swatch swatch--solid" style="border-color:${s.color}"></span>${escapeHtml(s.name)}</span>`);
      }
      if (days.some((d) => d.lo != null && d.hi != null)) {
        items.push(`<span><span class="swatch swatch--band"></span>Onzekerheidsband (80%)</span>`);
      }
      if (days.some((d) => d.weekend || d.holiday)) {
        items.push(`<span><span class="swatch swatch--shade"></span>Weekend / feestdag</span>`);
      }
      $("#chart-legend").innerHTML = items.join("");
    },
  };

  /* ── Scherm 3: modelkaart ──────────────────────────────
     Uitleg, herkomst en versiebeheer van het model: waarvoor het bedoeld is,
     hoe het werkt, waarop het getraind is, hoe goed het presteert en waar de
     grenzen liggen. */
  const modelScreen = {
    loadedFor: null,

    async show() {
      const key = graphScreen.modelKey || "gbr";
      if (this.loadedFor === key) return;
      $("#model-card").innerHTML = `<div class="kv-card"><p class="kv-hint">Modelkaart laden…</p></div>`;
      try {
        const card = await api(`/api/modelcard?model=${key}`);
        this.loadedFor = key;
        this.render(card);
      } catch (err) {
        $("#model-card").innerHTML =
          `<div class="rvo-alert rvo-alert--error rvo-alert--padding-sm">
            <div class="rvo-alert__container">${escapeHtml(err.message)}</div>
          </div>`;
      }
    },

    render(c) {
      $("#model-card").innerHTML = [
        this.header(c),
        `<div class="kv-columns">${this.purpose(c)}${this.limits(c)}</div>`,
        this.howItWorks(c),
        this.trainingData(c),
        this.performance(c),
        this.changelog(c),
      ].join("");
    },

    header(c) {
      return `<div class="kv-card kv-modelcard__header">
        <div class="kv-modelcard__title">
          <h1 class="utrecht-heading-2">${escapeHtml(c.label)}</h1>
          <span class="rvo-tag rvo-tag--pill kv-version">versie ${escapeHtml(c.version)}</span>
          <span class="rvo-tag rvo-tag--pill rvo-tag--warning">${escapeHtml(c.status)}</span>
          ${c.available ? "" : `<span class="rvo-tag rvo-tag--pill">niet actief</span>`}
        </div>
        <p class="utrecht-paragraph">${escapeHtml(c.description)}</p>
        <dl class="kv-deflist">
          <dt>Eigenaar</dt><dd>${escapeHtml(c.owner)}</dd>
          <dt>Contact</dt><dd><a class="rvo-link" href="mailto:${escapeHtml(c.contact)}">${escapeHtml(c.contact)}</a></dd>
          <dt>Laatst gewijzigd</dt><dd>${c.updated ? dateLabel(c.updated) : "–"}</dd>
          <dt>Kaart opgemaakt</dt><dd>${dateLabel(c.generatedOn)}</dd>
        </dl>
      </div>`;
    },

    purpose(c) {
      const p = c.purpose;
      return `<div class="kv-card">
        <h2 class="utrecht-heading-3">Doel en toepassing</h2>
        <dl class="kv-deflist kv-deflist--stacked">
          <dt>Waarvoor</dt><dd>${escapeHtml(p.goal)}</dd>
          <dt>Voor wie</dt><dd>${escapeHtml(p.users)}</dd>
          <dt>Rol in besluiten</dt><dd>${escapeHtml(p.decision)}</dd>
        </dl>
        <h3 class="utrecht-heading-4">Niet bedoeld voor</h3>
        <ul class="kv-list">${p.not_for.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
      </div>`;
    },

    limits(c) {
      return `<div class="kv-card">
        <h2 class="utrecht-heading-3">Beperkingen en risico's</h2>
        <ul class="kv-list">${c.limitations.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
      </div>`;
    },

    howItWorks(c) {
      const h = c.howItWorks;
      const band = Math.round((h.quantiles[1] - h.quantiles[0]) * 100);
      return `<div class="kv-card">
        <h2 class="utrecht-heading-3">Hoe het werkt</h2>
        <p class="utrecht-paragraph">
          Het model leert uit de eigen historie hoe de ontvangsten samenhangen met de kalender.
          Er worden drie modellen getraind — voor het midden en voor de onder- en bovengrens —
          samen de ${band}%-onzekerheidsband.
        </p>

        <h3 class="utrecht-heading-4">Instellingen</h3>
        <dl class="kv-deflist">
          ${h.hyperparameters.map((p) =>
            `<dt>${escapeHtml(p.name)}</dt><dd>${escapeHtml(p.value)}</dd>`).join("")}
        </dl>

        <h3 class="utrecht-heading-4">Kenmerken die het model gebruikt</h3>
        <!-- tabindex: op smalle schermen scrollt deze tabel, en een scrollbare
             regio moet ook met het toetsenbord te bedienen zijn. -->
        <div class="kv-table-scroll" tabindex="0" role="region"
             aria-label="Kenmerken die het model gebruikt">
          <table class="rvo-table">
            <thead><tr class="rvo-table-row">
              <th scope="col" class="rvo-table-header">Kenmerk</th>
              <th scope="col" class="rvo-table-header">Betekenis</th>
              <th scope="col" class="rvo-table-header">Waarom</th>
            </tr></thead>
            <tbody>
              ${h.features.map((f) => `<tr class="rvo-table-row">
                <td class="rvo-table-cell"><code>${escapeHtml(f.name)}</code></td>
                <td class="rvo-table-cell">${escapeHtml(f.label)}</td>
                <td class="rvo-table-cell">${escapeHtml(f.why)}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <p class="kv-hint">
          Het model gebruikt geen gegevens over personen of organisaties — alleen de kalender
          en de eigen historische reeks.
        </p>

        <h3 class="utrecht-heading-4">Nabewerking</h3>
        <ul class="kv-list">${h.postprocessing.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>

        <h3 class="utrecht-heading-4">Vergelijking met vorig jaar</h3>
        <p class="utrecht-paragraph">${escapeHtml(h.comparison || "")}</p>
      </div>`;
    },

    trainingData(c) {
      const t = c.trainingData;
      if (!t.available) {
        return `<div class="kv-card"><h2 class="utrecht-heading-3">Trainingsdata</h2>
          <p class="utrecht-paragraph">Geen dataset geladen.</p></div>`;
      }
      // Nul op een gewone werkdag kan een aangevulde ontbrekende dag zijn.
      const suspect = t.zeroOnOpenDays > 0
        ? `<div class="rvo-alert rvo-alert--info rvo-alert--padding-sm kv-alert">
             <div class="rvo-alert__container">
               ${t.zeroOnOpenDays} werkdag${t.zeroOnOpenDays > 1 ? "en hebben" : " heeft"} een bedrag van
               € 0. Dat kan een echte nuldag zijn, maar ook een dag die in het bronbestand
               ontbrak en met nul is aangevuld.
             </div>
           </div>`
        : "";
      return `<div class="kv-card">
        <h2 class="utrecht-heading-3">Trainingsdata</h2>
        <dl class="kv-deflist">
          <dt>Bron</dt><dd>${escapeHtml(t.source)}</dd>
          <dt>Periode</dt><dd>${dateLabel(t.start)} t/m ${dateLabel(t.end)}</dd>
          <dt>Aantal dagen</dt><dd>${t.days}</dd>
          <dt>Waarvan weekend</dt><dd>${t.weekendDays}</dd>
          <dt>Waarvan feestdag</dt><dd>${t.holidayDays}</dd>
          <dt>Dagen met € 0</dt><dd>${t.zeroDays}</dd>
          <dt>Gemiddelde per dag</dt><dd>${fmtMoney(t.mean)}</dd>
          <dt>Mediaan per dag</dt><dd>${fmtMoney(t.median)}</dd>
          <dt>Hoogste dag</dt><dd>${fmtMoney(t.max)}</dd>
          <dt>Traint op</dt><dd>${escapeHtml(t.trainedOn)}</dd>
          <dt>Datavingerafdruk</dt><dd><code class="kv-fingerprint">${escapeHtml(t.fingerprint)}</code></dd>
        </dl>
        ${suspect}
        <p class="kv-hint">
          De vingerafdruk is een hash over alle datums en bedragen. Samen met de modelversie
          legt hij vast welke prognose uit welke gegevens is ontstaan; beide staan ook in de
          export.
        </p>
      </div>`;
    },

    performance(c) {
      const m = c.performance;
      if (!m) {
        return `<div class="kv-card"><h2 class="utrecht-heading-3">Prestaties</h2>
          <p class="utrecht-paragraph">Nog geen backtest beschikbaar — er is te weinig data
          voor een prognose.</p></div>`;
      }
      const off = m.coverage_pct - m.coverage_target;
      const ok = Math.abs(off) <= 2;
      const note = ok ? "goed gekalibreerd"
        : off < 0 ? "band te smal — het model is overmoedig"
        : "band te breed — weinig informatief";
      return `<div class="kv-card">
        <h2 class="utrecht-heading-3">Prestaties</h2>
        <p class="utrecht-paragraph">
          Gemeten met een backtest: het model wordt getraind zonder de laatste
          ${c.howItWorks.backtestDays} dagen en moet die vervolgens voorspellen.
        </p>
        <div class="kv-kpi-row">
          <div class="kv-kpi kv-kpi--${ok ? "ok" : "warn"}">
            <p class="kv-kpi__label">Binnen band (doel: ${m.coverage_target}%)</p>
            <p class="kv-kpi__value">${m.coverage_pct}%</p>
            <p class="kv-kpi__note">${note}</p>
          </div>
          <div class="kv-kpi">
            <p class="kv-kpi__label">Pinball-loss</p>
            <p class="kv-kpi__value">${m.pinball}</p>
            <p class="kv-kpi__note">lager is beter; alleen vergelijkbaar binnen dezelfde dataset</p>
          </div>
        </div>
        <p class="kv-hint">
          "Binnen band" is het aandeel dagen waarop de werkelijke ontvangst tussen de onder- en
          bovengrens viel. Bij een ${m.coverage_target}%-band hoort dat rond de
          ${m.coverage_target}% te liggen: lager betekent dat het model zichzelf te zeker
          inschat, hoger dat de band zo ruim is dat hij weinig zegt.
        </p>
      </div>`;
    },

    changelog(c) {
      return `<div class="kv-card">
        <h2 class="utrecht-heading-3">Versiegeschiedenis</h2>
        <ol class="kv-changelog">
          ${c.changelog.map((e, i) => `<li class="kv-changelog__item">
            <div class="kv-changelog__head">
              <span class="rvo-tag rvo-tag--pill ${i === 0 ? "kv-version" : ""}">${escapeHtml(e.version)}</span>
              <span class="kv-changelog__date">${dateLabel(e.date)}</span>
              ${i === 0 ? `<span class="kv-changelog__current">huidige versie</span>` : ""}
              ${e.commit ? `<code class="kv-fingerprint">${escapeHtml(e.commit)}</code>` : ""}
            </div>
            <ul class="kv-list">${e.changes.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
          </li>`).join("")}
        </ol>
        <p class="kv-hint">
          Elke wijziging die de uitkomst kan veranderen — kenmerken, instellingen of
          nabewerking — krijgt een nieuwe versie.
        </p>
      </div>`;
    },
  };

  /* ── Bediening ─────────────────────────────────────────── */
  $("#model-select").addEventListener("change", (evt) => {
    graphScreen.modelKey = evt.target.value;
    graphScreen.renderModelDescription();
    graphScreen.render();
  });
  for (const id of ["#toggle-next-month", "#toggle-last-year", "#toggle-totals"]) {
    $(id).addEventListener("change", () => graphScreen.render());
  }

  $("#btn-reset-adjust").addEventListener("click", () => {
    const s = graphScreen.active();
    if (!s) return;
    s.adjustments = {};
    graphScreen.closeEditor();
    graphScreen.render();
  });

  $("#btn-add-scenario").addEventListener("click", () => {
    graphScreen.addScenario();
    graphScreen.closeEditor();
    graphScreen.render();
  });

  $("#btn-dup-scenario").addEventListener("click", () => {
    graphScreen.addScenario(graphScreen.active());
    graphScreen.closeEditor();
    graphScreen.render();
  });

  $("#btn-del-scenario").addEventListener("click", () => {
    if (graphScreen.scenarios.length <= 1) return;
    graphScreen.scenarios = graphScreen.scenarios.filter((s) => s.id !== graphScreen.activeId);
    graphScreen.activeId = graphScreen.scenarios[0].id;
    graphScreen._nameFor = null;
    graphScreen.closeEditor();
    graphScreen.render();
  });

  $("#scenario-tabs").addEventListener("click", (evt) => {
    const btn = evt.target.closest("[data-id]");
    if (!btn) return;
    graphScreen.activeId = btn.dataset.id;
    graphScreen.closeEditor();
    graphScreen.render();
  });

  // Pijltjesnavigatie tussen scenariotabs, zoals een echte tablist.
  $("#scenario-tabs").addEventListener("keydown", (evt) => {
    if (evt.key !== "ArrowRight" && evt.key !== "ArrowLeft") return;
    const ids = graphScreen.scenarios.map((s) => s.id);
    const at = ids.indexOf(graphScreen.activeId);
    const next = ids[(at + (evt.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
    evt.preventDefault();
    graphScreen.activeId = next;
    graphScreen.render();
    const tab = $(`#scenario-tabs [data-id="${next}"]`);
    if (tab) tab.focus();
  });

  $("#scenario-name").addEventListener("input", (evt) => {
    const s = graphScreen.active();
    if (!s) return;
    s.name = evt.target.value.slice(0, 60);
    graphScreen.renderScenarioTabs(null);
  });
  // Tabtellers kloppen weer zodra het veld verlaten wordt.
  $("#scenario-name").addEventListener("change", () => graphScreen.render());

  $("#adjust-list").addEventListener("click", (evt) => {
    const remove = evt.target.closest("[data-remove]");
    if (remove) { graphScreen.removeAdjustment(remove.dataset.remove); return; }
    const edit = evt.target.closest("[data-edit]");
    if (edit) graphScreen.openEditor(edit.dataset.edit);
  });

  /* Exacte invoer */
  $("#editor-value").addEventListener("input", () => graphScreen.updateEditorDelta());
  $("#editor-value").addEventListener("keydown", (evt) => {
    if (evt.key === "Enter") { evt.preventDefault(); graphScreen.applyEditor(); }
    if (evt.key === "Escape") { evt.preventDefault(); graphScreen.closeEditor(true); }
  });
  $("#editor-apply").addEventListener("click", () => graphScreen.applyEditor());
  $("#editor-cancel").addEventListener("click", () => graphScreen.closeEditor(true));
  $("#editor-remove").addEventListener("click", () => {
    const date = graphScreen.editorDate;
    graphScreen.closeEditor();
    graphScreen.removeAdjustment(date);
  });
  $("#point-editor").addEventListener("keydown", (evt) => {
    if (evt.key === "Escape") { evt.preventDefault(); graphScreen.closeEditor(true); }
  });
  for (const btn of document.querySelectorAll(".kv-editor__quick button")) {
    btn.addEventListener("click", () => {
      const input = $("#editor-value");
      const pct = +btn.dataset.pct;
      const base = parseFloat(input.value);
      if (!isFinite(base)) return;
      input.value = (Math.round(base * (1 + pct / 100) * 100) / 100).toFixed(2);
      graphScreen.updateEditorDelta();
      input.focus();
    });
  }

  // Onthouden welk punt focus had, zodat toetsenbodiening na het hertekenen
  // niet terugspringt naar het eerste punt.
  $("#chart").addEventListener("focusin", (evt) => {
    if (evt.target.dataset && evt.target.dataset.date) {
      graphScreen.focusDate = evt.target.dataset.date;
    }
  });

  /* Toelichting bij "Realisatie vorig jaar". Voldoet aan WCAG 1.4.13: te sluiten
     met Escape, de muis kan er overheen zonder dat hij verdwijnt, en hij blijft
     staan tot je hem sluit. */
  (function initInfo() {
    const btn = $("#last-year-info"), help = $("#last-year-help");
    let pinned = false, hideTimer = null;

    const show = () => {
      clearTimeout(hideTimer);
      help.dataset.collapsed = "false";
      btn.setAttribute("aria-expanded", "true");
    };
    const hide = (force) => {
      if (pinned && !force) return;
      clearTimeout(hideTimer);
      // Korte vertraging zodat de muis van de knop naar de tekst kan bewegen.
      hideTimer = setTimeout(() => {
        help.dataset.collapsed = "true";
        btn.setAttribute("aria-expanded", "false");
      }, 150);
    };

    btn.addEventListener("pointerenter", show);
    btn.addEventListener("focus", show);
    btn.addEventListener("pointerleave", () => hide());
    btn.addEventListener("blur", () => hide());
    help.addEventListener("pointerenter", () => clearTimeout(hideTimer));
    help.addEventListener("pointerleave", () => hide());
    btn.addEventListener("click", () => {
      pinned = !pinned;
      if (pinned) show(); else hide(true);
    });
    document.addEventListener("keydown", (evt) => {
      if (evt.key !== "Escape" || help.dataset.collapsed === "true") return;
      pinned = false;
      hide(true);
      btn.focus();
    });
  })();

  $("#btn-export-csv").addEventListener("click", () => graphScreen.exportAs("csv"));
  $("#btn-export-xlsx").addEventListener("click", () => graphScreen.exportAs("xlsx"));

  // De grafiek rekent met de containerbreedte, dus opnieuw tekenen bij resize.
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!$("#screen-grafiek").hidden) graphScreen.render();
    }, 150);
  });

  window.addEventListener("hashchange", route);
  if (!location.hash) location.hash = "#grafiek";
  route();
})();
