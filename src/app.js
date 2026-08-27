/* KasVisie frontend: drie schermen (gegevens, prognose, modelkaart) op één
   pagina, opgebouwd uit de web components van het NLDD Design System. Alle
   markup die hier gegenereerd wordt gebruikt nldd-*-elementen; eigen markup
   blijft beperkt tot wat geen component is (de grafiek en de twee panelen die
   zich daaraan verankeren). */

import KVChart from "./chart.js";

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

  /* ── Bouwstenen ────────────────────────────────────────────
     Kleine helpers rond de componenten die hier het vaakst terugkomen, zodat
     de attribuutnamen op één plek staan. */

  // Paginabrede terugkoppeling. nldd-banner zet role en aria-live zelf op basis
  // van de variant; niet overschrijven.
  const banner = (variant, text, body) =>
    `<nldd-banner variant="${variant}" size="sm" text="${escapeHtml(text)}">${body || ""}</nldd-banner>`;

  const richText = (html, spacing) =>
    `<nldd-rich-text spacing="${spacing || "tight"}">${html}</nldd-rich-text>`;

  // Label-waardepaar. nldd-description-cell is precies dat; een <dl> zou het
  // met eigen CSS nabouwen.
  const defItem = (label, valueHtml) =>
    `<nldd-list-item size="sm">
       <nldd-description-cell>
         <span slot="title">${escapeHtml(label)}</span>
         <span slot="description">${valueHtml}</span>
       </nldd-description-cell>
     </nldd-list-item>`;

  const defList = (pairs, label) =>
    `<nldd-list variant="simple" dividers="never" accessible-label="${escapeHtml(label)}">
       ${pairs.map(([k, v]) => defItem(k, v)).join("")}
     </nldd-list>`;

  const card = (bodyHtml, gap) =>
    `<nldd-card><nldd-container padding="24" gap="${gap || 16}">${bodyHtml}</nldd-container></nldd-card>`;

  const heading = (level, size, text) =>
    `<nldd-title size="${size}"><h${level}>${escapeHtml(text)}</h${level}></nldd-title>`;

  const cell = (text, opts) => {
    const o = opts || {};
    return `<nldd-text-cell text="${escapeHtml(text)}"` +
      (o.align ? ` horizontal-alignment="${o.align}"` : "") +
      (o.color ? ` color="${o.color}"` : "") +
      (o.hideBelow ? ` hide-below="${o.hideBelow}"` : "") +
      (o.width ? ` width="${o.width}"` : "") +
      `></nldd-text-cell>`;
  };

  /* nldd-dropdown leest de zichtbare waarde uit het geslotte <select> bij
     slotchange en bij change. Nieuwe <option>-elementen in hetzélfde select
     vuren geen slotchange, dus het menu zou leeg blijven staan; het select
     wordt daarom als geheel vervangen. Dat is precies de weg die het component
     wél waarneemt, en het houdt de browser eigenaar van toetsenbord,
     formulierwaarde en toegankelijkheid. */
  function fillSelect(id, options, value, onChange) {
    const old = document.getElementById(id);
    const select = document.createElement("select");
    for (const a of old.attributes) select.setAttribute(a.name, a.value);
    select.innerHTML = options
      .map(([v, label]) => `<option value="${escapeHtml(v)}">${escapeHtml(label)}</option>`)
      .join("");
    if (value != null) select.value = value;
    select.addEventListener("change", onChange);
    old.replaceWith(select);
    return select;
  }

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
      // nldd-menu-bar-item zet zelf aria-current="page" op de link.
      $(s.tab).toggleAttribute("current", active);
    }
    SCREENS[current].show();
  }

  /* Melding over de actualiteit van de dataset. De app rekent vanaf de laatste
     meetdag; als die ver achterloopt moet dat expliciet zichtbaar zijn. */
  function freshnessBanner(info) {
    if (!info) return "";
    // De samenvatting noemt de laatste meetdag "end", de prognose
    // "lastObservation"; beide schermen gebruiken deze melding.
    const last = info.end || info.lastObservation;
    if (info.staleDays == null || !last) return "";
    if (info.staleDays <= 2) return "";
    const variant = info.staleDays > 31 ? "warning" : "accent";
    return banner(
      variant,
      `Data loopt t/m ${dateLabel(last)} — ${info.staleDays} dagen geleden.`,
      richText(`<p>De prognose start daarom op
        ${escapeHtml(dateLabel(info.forecastStart || last))}, niet vandaag.</p>`, "flat")
    );
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
      $("#dataset-summary").innerHTML = [
        ["Bron", escapeHtml(s.source)],
        ["Aantal dagen", String(s.rows)],
        ["Periode", `${escapeHtml(s.start)} t/m ${escapeHtml(s.end)}`],
        ["Status", s.ready ? "voldoende data voor prognose" : "te weinig data (min. 60 dagen)"],
      ].map(([k, v]) => defItem(k, v)).join("");
      $("#data-freshness").innerHTML = freshnessBanner(s);
    },

    renderMonthSelect() {
      const months = [...new Set(this.records.map((r) => r.date.slice(0, 7)))];
      fillSelect(
        "table-month",
        months.map((m) => [m, monthLabel(m)]),
        months[months.length - 1],
        () => this.renderTable()
      );
    },

    renderTable() {
      const month = $("#table-month").value;
      const days = ["ma", "di", "wo", "do", "vr", "za", "zo"];
      const table = $("#data-table");
      // De kopregel staat in de HTML en blijft staan; alleen de gegevensrijen
      // worden vervangen.
      for (const row of table.querySelectorAll("nldd-table-row:not([slot])")) row.remove();

      const rows = this.records
        .filter((r) => r.date.startsWith(month))
        .map((r) => {
          const dow = days[(new Date(r.date).getDay() + 6) % 7];
          const closed = r.weekend || r.holiday;
          const tag = r.holiday
            ? `<nldd-tag size="sm" color="warning" text="${escapeHtml(r.holiday)}"></nldd-tag>`
            : r.weekend ? `<nldd-tag size="sm" text="weekend"></nldd-tag>` : "";
          // Gesloten dagen krijgen secundaire tekstkleur én een tag: de kleur
          // alleen zou de enige drager van de informatie zijn (WCAG 1.4.1).
          const color = closed ? "secondary" : null;
          return `<nldd-table-row>
            ${cell(r.date, { color })}
            ${cell(dow, { color, hideBelow: "md" })}
            ${cell(EUR2.format(r.cashflow), { align: "right", color })}
            <nldd-cell hide-below="md" width="full">${tag}</nldd-cell>
          </nldd-table-row>`;
        })
        .join("");
      table.insertAdjacentHTML("beforeend", rows);
    },

    alert(msg, isError) {
      $("#upload-alert").innerHTML = banner(isError ? "critical" : "success", msg);
    },
  };

  /* nldd-file-field verpakt een verborgen native input en meldt de keuze via
     event.detail.files; de gekozen naam toont het component zelf. */
  let uploadFile = null;
  $("#upload-file").addEventListener("change", (evt) => {
    const files = (evt.detail && evt.detail.files) || [];
    uploadFile = files.length ? files[0] : null;
  });

  $("#upload-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    if (!uploadFile) {
      dataScreen.alert("Kies eerst een CSV-bestand.", true);
      return;
    }
    const fd = new FormData();
    fd.append("file", uploadFile);
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
        $("#model-static-wrapper").hidden = !single;
        if (single) {
          $("#model-static").textContent = this.models.length ? this.models[0].label : "–";
        } else {
          fillSelect(
            "model-select",
            this.models.map((m) => [m.key, m.label]),
            this.modelKey,
            (evt) => {
              this.modelKey = evt.target.value;
              this.renderModelDescription();
              this.render();
            }
          );
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
          card(`<nldd-activity-indicator size="24" timing="instant"
                                         text="Kengetallen laden"></nldd-activity-indicator>`)
        ).join("");
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
        $("#kpi-row").innerHTML = banner("critical", err.message);
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

      $("#graph-freshness").innerHTML = freshnessBanner(fc);
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

    /* ── Scenariotabs ─────────────────────────────────────────
       nldd-tab-bar regelt selectie, rollen en pijltjesnavigatie zelf; hier
       staat alleen welke tabs er zijn. */
    renderScenarioTabs(paths) {
      $("#scenario-tabs").innerHTML = this.scenarios.map((s) => {
        const count = paths ? paths.get(s.id).count : 0;
        const isActive = s.id === this.activeId;
        return `<nldd-tab-bar-item data-id="${escapeHtml(s.id)}"
                  text="${escapeHtml(s.name)} (${count})" ${isActive ? "selected" : ""}>
          <span slot="icon" class="kv-scenario-dot"
                style="background:${escapeHtml(s.color)}"></span>
        </nldd-tab-bar-item>`;
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
      // Leeg: nldd-list toont zijn eigen empty-state uit empty-text.
      $("#adjust-list").innerHTML = entries.map((e) => {
        const shown = clamp(e.value, RATIO_MIN * e.base, RATIO_MAX * e.base);
        const pct = e.base ? ((shown - e.base) / e.base) * 100 : 0;
        return `<nldd-list-item size="sm">
          ${cell(shortDate(e.date), { width: "5rem" })}
          <nldd-cell width="full">
            <span class="kv-adjust-values">
              <nldd-text size="sm" color="secondary" class="kv-adjust-base">${fmtMoney(e.base)}</nldd-text>
              <nldd-text size="sm" aria-hidden="true">→</nldd-text>
              <nldd-text size="sm" weight="bold">${fmtMoney(shown)}</nldd-text>
            </span>
          </nldd-cell>
          ${cell(fmtPct(pct), { align: "right", width: "5rem", color: pct >= 0 ? "success" : "critical" })}
          <nldd-cell>
            <span class="kv-adjust-actions">
            <nldd-button variant="neutral-transparent" size="xs" data-edit="${escapeHtml(e.date)}"
                         text="Wijzigen"
                         accessible-label="Bijstelling van ${escapeHtml(dateLabel(e.date))} wijzigen"></nldd-button>
            <nldd-button variant="critical-transparent" size="xs" data-remove="${escapeHtml(e.date)}"
                         text="Verwijderen"
                         accessible-label="Bijstelling van ${escapeHtml(dateLabel(e.date))} verwijderen"></nldd-button>
            </span>
          </nldd-cell>
        </nldd-list-item>`;
      }).join("");

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
      input.min = Math.round(RATIO_MIN * day.pred * 100) / 100;
      input.max = Math.round(RATIO_MAX * day.pred * 100) / 100;
      // Stap fijn genoeg om centen te kunnen zetten, ook bij grote bedragen.
      input.step = 0.01;
      input.value = Math.round(current * 100) / 100;
      $("#editor-remove").hidden = s.adjustments[date] == null;

      $("#point-editor").hidden = false;
      this.updateEditorDelta();
      this.positionEditor();
      this.focusEditorInput();
    },

    /* Ontsnappingsluik: de native input van nldd-number-field zit in de shadow
       DOM en er is geen focus()-API. Defensief zoeken, met een terugval als de
       interne structuur verandert. */
    focusEditorInput() {
      const field = $("#editor-value");
      const native =
        (field.shadowRoot && field.shadowRoot.querySelector("input")) ||
        field.querySelector("input");
      if (!native) { field.focus(); return; }
      native.focus();
      native.select();
    },

    editorValue() {
      const field = $("#editor-value");
      const native =
        (field.shadowRoot && field.shadowRoot.querySelector("input")) ||
        field.querySelector("input");
      // Tijdens het typen staat de tussenstand in de native input; het
      // component commit pas bij blur of Enter.
      const raw = native ? native.value : field.value;
      return parseFloat(raw);
    },

    updateEditorDelta() {
      const fc = this.lastForecast;
      const day = fc && fc.days.find((d) => d.date === this.editorDate);
      if (!day) return;
      const value = this.editorValue();
      const el = $("#editor-delta");
      if (!isFinite(value)) { el.textContent = ""; return; }
      const pct = day.pred ? ((value - day.pred) / day.pred) * 100 : 0;
      const outside = value < RATIO_MIN * day.pred - 1e-9 || value > RATIO_MAX * day.pred + 1e-9;
      el.textContent = outside
        ? `${fmtPct(pct)} — buiten bereik, wordt begrensd`
        : `${fmtPct(pct)} t.o.v. de modelprognose`;
      el.setAttribute("color", outside ? "warning" : "secondary");
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
      const value = this.editorValue();
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
      const state = Math.abs(off) <= 2 ? "success" : "warning";
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
      $("#kpi-row").innerHTML = kpis.map((k) => card(`
        <nldd-text size="sm" color="secondary">${escapeHtml(k.label)}</nldd-text>
        <nldd-text size="lg" weight="bold" class="kv-kpi__value">${escapeHtml(k.value)}</nldd-text>
        ${k.note
          ? `<nldd-text size="xs" color="${k.state || "secondary"}">${escapeHtml(k.note)}</nldd-text>`
          : ""}`, 4)).join("");
    },

    renderTotals(fc, show, t) {
      const panel = $("#totals-panel");
      panel.hidden = !show;
      if (!show) return;
      const pct = (now, then) => (then ? fmtPct(((now - then) / then) * 100) : "–");
      const row = (label, now, then) => `<nldd-table-row>
        ${cell(label)}
        ${cell(fmtMoney0(now), { align: "right" })}
        ${cell(fmtMoney0(then), { align: "right" })}
        ${cell(pct(now, then), { align: "right" })}
      </nldd-table-row>`;
      const lag = fc.lastYearLagDays || 364;
      panel.innerHTML = `<nldd-container padding="24" gap="16">
        ${heading(2, 3, "Totale volumes t.o.v. vorig jaar")}
        <nldd-table accessible-label="Totale volumes ten opzichte van vorig jaar"
                    columns="minmax(140px, 1fr) minmax(150px, 1fr) minmax(140px, 1fr) 110px">
          <nldd-table-row slot="header">
            ${cell("Periode")}
            ${cell("Verwacht/gerealiseerd", { align: "right" })}
            ${cell("Vorig jaar", { align: "right" })}
            ${cell("Verschil", { align: "right" })}
          </nldd-table-row>
          ${row(monthLabel(fc.thisMonth), t.totThis, t.lyThis)}
          ${row("volgende maand", t.totNext, t.lyNext)}
        </nldd-table>
        <nldd-text size="sm" color="secondary">
          "Vorig jaar" is de periode van ${lag} dagen (${Math.round(lag / 7)} weken) eerder, zodat
          de weekdagen gelijk lopen en beide periodes evenveel werk- en weekenddagen bevatten.
        </nldd-text>
      </nldd-container>`;
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
      $("#model-card").innerHTML = card(
        `<nldd-activity-indicator size="24" timing="instant"
                                  text="Modelkaart laden" show-text></nldd-activity-indicator>`);
      try {
        const modelcard = await api(`/api/modelcard?model=${key}`);
        this.loadedFor = key;
        this.render(modelcard);
      } catch (err) {
        $("#model-card").innerHTML = banner("critical", err.message);
      }
    },

    render(c) {
      $("#model-card").innerHTML = [
        this.header(c),
        `<nldd-container layout="grid" column-count="2" sm-column-count="1" gap="24">
           ${this.purpose(c)}${this.limits(c)}
         </nldd-container>`,
        this.howItWorks(c),
        this.trainingData(c),
        this.performance(c),
        this.changelog(c),
      ].join("");
    },

    header(c) {
      return card(`
        <nldd-title size="2">
          <h1>${escapeHtml(c.label)}</h1>
          <span slot="end" class="kv-modelcard__title">
            <nldd-tag color="accent" text="versie ${escapeHtml(c.version)}"></nldd-tag>
            <nldd-tag color="warning" text="${escapeHtml(c.status)}"></nldd-tag>
            ${c.available ? "" : `<nldd-tag text="niet actief"></nldd-tag>`}
          </span>
        </nldd-title>
        <nldd-text>${escapeHtml(c.description)}</nldd-text>
        ${defList([
          ["Eigenaar", escapeHtml(c.owner)],
          ["Contact", `<nldd-link size="sm" href="mailto:${escapeHtml(c.contact)}"
                                  text="${escapeHtml(c.contact)}"></nldd-link>`],
          ["Laatst gewijzigd", c.updated ? escapeHtml(dateLabel(c.updated)) : "–"],
          ["Kaart opgemaakt", escapeHtml(dateLabel(c.generatedOn))],
        ], "Herkomst van het model")}`);
    },

    purpose(c) {
      const p = c.purpose;
      return card(`
        ${heading(2, 3, "Doel en toepassing")}
        ${richText(`
          <dl>
            <dt>Waarvoor</dt><dd>${escapeHtml(p.goal)}</dd>
            <dt>Voor wie</dt><dd>${escapeHtml(p.users)}</dd>
            <dt>Rol in besluiten</dt><dd>${escapeHtml(p.decision)}</dd>
          </dl>
          <h3>Niet bedoeld voor</h3>
          <ul>${p.not_for.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`)}`);
    },

    limits(c) {
      return card(`
        ${heading(2, 3, "Beperkingen en risico's")}
        ${richText(`<ul>${c.limitations.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`)}`);
    },

    howItWorks(c) {
      const h = c.howItWorks;
      const band = Math.round((h.quantiles[1] - h.quantiles[0]) * 100);
      return card(`
        ${heading(2, 3, "Hoe het werkt")}
        ${richText(`<p>
          Het model leert uit de eigen historie hoe de ontvangsten samenhangen met de kalender.
          Er worden drie modellen getraind — voor het midden en voor de onder- en bovengrens —
          samen de ${band}%-onzekerheidsband.</p>`)}

        ${heading(3, 4, "Instellingen")}
        ${defList(h.hyperparameters.map((p) => [p.name, escapeHtml(p.value)]), "Instellingen van het model")}

        ${heading(3, 4, "Kenmerken die het model gebruikt")}
        <!-- nldd-table is zijn eigen scroll-container: onder de minimale
             kolombreedtes scrollt hij horizontaal in plaats van de
             kenmerknamen middenin af te breken ("is_weeke nd"). -->
        <nldd-table accessible-label="Kenmerken die het model gebruikt"
                    columns="minmax(180px, 1fr) minmax(200px, 1fr) minmax(260px, 2fr)">
          <nldd-table-row slot="header">
            ${cell("Kenmerk")}${cell("Betekenis")}${cell("Waarom")}
          </nldd-table-row>
          ${h.features.map((f) => `<nldd-table-row>
            <nldd-cell width="full"><code>${escapeHtml(f.name)}</code></nldd-cell>
            ${cell(f.label)}
            ${cell(f.why)}
          </nldd-table-row>`).join("")}
        </nldd-table>
        <nldd-text size="sm" color="secondary">
          Het model gebruikt geen gegevens over personen of organisaties — alleen de kalender
          en de eigen historische reeks.
        </nldd-text>

        ${heading(3, 4, "Nabewerking")}
        ${richText(`<ul>${h.postprocessing.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`)}

        ${heading(3, 4, "Vergelijking met vorig jaar")}
        <nldd-text>${escapeHtml(h.comparison || "")}</nldd-text>`);
    },

    trainingData(c) {
      const t = c.trainingData;
      if (!t.available) {
        return card(`${heading(2, 3, "Trainingsdata")}
          <nldd-text>Geen dataset geladen.</nldd-text>`);
      }
      // Nul op een gewone werkdag kan een aangevulde ontbrekende dag zijn.
      const suspect = t.zeroOnOpenDays > 0
        ? banner("accent",
            `${t.zeroOnOpenDays} werkdag${t.zeroOnOpenDays > 1 ? "en hebben" : " heeft"} een bedrag van € 0.`,
            richText(`<p>Dat kan een echte nuldag zijn, maar ook een dag die in het
              bronbestand ontbrak en met nul is aangevuld.</p>`, "flat"))
        : "";
      return card(`
        ${heading(2, 3, "Trainingsdata")}
        ${defList([
          ["Bron", escapeHtml(t.source)],
          ["Periode", `${escapeHtml(dateLabel(t.start))} t/m ${escapeHtml(dateLabel(t.end))}`],
          ["Aantal dagen", String(t.days)],
          ["Waarvan weekend", String(t.weekendDays)],
          ["Waarvan feestdag", String(t.holidayDays)],
          ["Dagen met € 0", String(t.zeroDays)],
          ["Gemiddelde per dag", fmtMoney(t.mean)],
          ["Mediaan per dag", fmtMoney(t.median)],
          ["Hoogste dag", fmtMoney(t.max)],
          ["Traint op", escapeHtml(t.trainedOn)],
          ["Datavingerafdruk", `<code class="kv-fingerprint">${escapeHtml(t.fingerprint)}</code>`],
        ], "Kenmerken van de trainingsdata")}
        ${suspect}
        <nldd-text size="sm" color="secondary">
          De vingerafdruk is een hash over alle datums en bedragen. Samen met de modelversie
          legt hij vast welke prognose uit welke gegevens is ontstaan; beide staan ook in de
          export.
        </nldd-text>`);
    },

    performance(c) {
      const m = c.performance;
      if (!m) {
        return card(`${heading(2, 3, "Prestaties")}
          <nldd-text>Nog geen backtest beschikbaar — er is te weinig data voor een
          prognose.</nldd-text>`);
      }
      const off = m.coverage_pct - m.coverage_target;
      const ok = Math.abs(off) <= 2;
      const note = ok ? "goed gekalibreerd"
        : off < 0 ? "band te smal — het model is overmoedig"
        : "band te breed — weinig informatief";
      const tile = (label, value, hint, state) => card(`
        <nldd-text size="sm" color="secondary">${escapeHtml(label)}</nldd-text>
        <nldd-text size="lg" weight="bold" class="kv-kpi__value">${escapeHtml(value)}</nldd-text>
        <nldd-text size="xs" color="${state || "secondary"}">${escapeHtml(hint)}</nldd-text>`, 4);
      return card(`
        ${heading(2, 3, "Prestaties")}
        <nldd-text>
          Gemeten met een backtest: het model wordt getraind zonder de laatste
          ${c.howItWorks.backtestDays} dagen en moet die vervolgens voorspellen.
        </nldd-text>
        <div class="kv-kpi-row">
          ${tile(`Binnen band (doel: ${m.coverage_target}%)`, `${m.coverage_pct}%`, note,
                 ok ? "success" : "warning")}
          ${tile("Pinball-loss", String(m.pinball),
                 "lager is beter; alleen vergelijkbaar binnen dezelfde dataset")}
        </div>
        <nldd-text size="sm" color="secondary">
          "Binnen band" is het aandeel dagen waarop de werkelijke ontvangst tussen de onder- en
          bovengrens viel. Bij een ${m.coverage_target}%-band hoort dat rond de
          ${m.coverage_target}% te liggen: lager betekent dat het model zichzelf te zeker
          inschat, hoger dat de band zo ruim is dat hij weinig zegt.
        </nldd-text>`);
    },

    changelog(c) {
      return card(`
        ${heading(2, 3, "Versiegeschiedenis")}
        <ol class="kv-changelog">
          ${c.changelog.map((e, i) => `<li class="kv-changelog__item">
            <div class="kv-changelog__head">
              <nldd-tag color="${i === 0 ? "accent" : "neutral"}"
                        text="${escapeHtml(e.version)}"></nldd-tag>
              <nldd-text size="sm" color="secondary">${escapeHtml(dateLabel(e.date))}</nldd-text>
              ${i === 0 ? `<nldd-text size="xs" color="accent" weight="medium">huidige versie</nldd-text>` : ""}
              ${e.commit ? `<code class="kv-fingerprint">${escapeHtml(e.commit)}</code>` : ""}
            </div>
            ${richText(`<ul>${e.changes.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`)}
          </li>`).join("")}
        </ol>
        <nldd-text size="sm" color="secondary">
          Elke wijziging die de uitkomst kan veranderen — kenmerken, instellingen of
          nabewerking — krijgt een nieuwe versie.
        </nldd-text>`);
    },
  };

  /* ── Bediening ─────────────────────────────────────────── */
  // Het modelkeuzemenu krijgt zijn listener in fillSelect: het <select> wordt
  // bij het vullen vervangen, dus een listener van tevoren zou meeverdwijnen.
  // nldd-switch-field meldt de nieuwe stand in event.detail.checked; de
  // eigenschap op het element is dan al bijgewerkt.
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

  // nldd-tab-bar regelt de selectie en de pijltjesnavigatie; hier alleen wat
  // er daarna moet gebeuren.
  $("#scenario-tabs").addEventListener("tabchange", (evt) => {
    const item = evt.detail && evt.detail.item;
    if (!item || !item.dataset.id) return;
    graphScreen.activeId = item.dataset.id;
    graphScreen.closeEditor();
    graphScreen.render();
  });

  $("#scenario-name").addEventListener("input", (evt) => {
    const s = graphScreen.active();
    if (!s) return;
    const value = (evt.detail && evt.detail.value) ?? evt.target.value;
    s.name = String(value).slice(0, 60);
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
  $("#editor-apply").addEventListener("click", () => graphScreen.applyEditor());
  $("#editor-cancel").addEventListener("click", () => graphScreen.closeEditor(true));
  $("#editor-remove").addEventListener("click", () => {
    const date = graphScreen.editorDate;
    graphScreen.closeEditor();
    graphScreen.removeAdjustment(date);
  });
  // keydown is composed, dus toetsen in het invoerveld bereiken het paneel ook
  // vanuit de shadow DOM van nldd-number-field.
  $("#point-editor").addEventListener("keydown", (evt) => {
    if (evt.key === "Enter") { evt.preventDefault(); graphScreen.applyEditor(); }
    if (evt.key === "Escape") { evt.preventDefault(); graphScreen.closeEditor(true); }
  });
  for (const btn of document.querySelectorAll(".kv-editor__quick nldd-button[data-pct]")) {
    btn.addEventListener("click", () => {
      const field = $("#editor-value");
      const pct = +btn.dataset.pct;
      const base = graphScreen.editorValue();
      if (!isFinite(base)) return;
      field.value = Math.round(base * (1 + pct / 100) * 100) / 100;
      graphScreen.updateEditorDelta();
      graphScreen.focusEditorInput();
    });
  }

  // Onthouden welk punt focus had, zodat toetsenbodiening na het hertekenen
  // niet terugspringt naar het eerste punt.
  $("#chart").addEventListener("focusin", (evt) => {
    if (evt.target.dataset && evt.target.dataset.date) {
      graphScreen.focusDate = evt.target.dataset.date;
    }
  });

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
