/* KVChart — minimale SVG-lijngrafiek voor de kasprognose.
   Geen externe libraries; tekent onzekerheidsband, weekend-/feestdagmarkering,
   prognosestartlijn en scenariolijnen. Prognosepunten zijn te bedienen met de
   muis (slepen = grof, klikken = exacte invoer) en met het toetsenbord. */

(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const BASE_W = 920, H = 460;
  const M = { l: 76, r: 16, t: 34, b: 44 };
  // Minimale breedte per dag; daaronder wordt de grafiek onleesbaar en gaat de
  // wrapper horizontaal scrollen in plaats van alles samen te persen.
  const MIN_DAY_PX = 13;
  // Verplaatsing waaronder een muisactie als klik geldt in plaats van als sleep.
  const CLICK_SLOP_PX = 4;

  const COLORS = {
    actual: "#2f6cb3",
    pred: "#d52b1e",
    lastYear: "#3d8757",
    weekend: "rgba(96, 116, 130, 0.10)",
    holiday: "rgba(255, 182, 18, 0.18)",
    thisMonth: "rgba(47, 108, 179, 0.05)",
    nextMonth: "rgba(224, 121, 38, 0.06)",
    grid: "#e3e7e9",
    axis: "#5f5e5c",
    focus: "#1b1b1b",
  };

  const SERIES = [
    { key: "lastYearActual", label: "Werkelijk vorig jaar", color: COLORS.lastYear, dash: "2 4", width: 2, swatch: "dotted" },
    { key: "actual", label: "Werkelijk", color: COLORS.actual, dash: null, width: 2, swatch: "solid" },
    { key: "pred", label: "Prognose (model)", color: COLORS.pred, dash: "6 4", width: 2, swatch: "dashed" },
  ];

  function el(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function niceTicks(max, count) {
    const raw = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const ticks = [0];
    while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  const fmtDay = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;

  function linePath(pts) {
    return pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  }

  // days: [{date, actual, pred, lo, hi, lastYearActual, weekend, holiday}]
  // opts: {forecastStart, thisMonth, tooltipEl, dragFloor, focusDate,
  //        scenarios: [{id, name, color, active, values: []}],
  //        fmtMoney, fmtAxis, onAdjust(date, value), onOpenEditor(date)}
  window.KVChart = function render(svg, days, opts) {
    svg.innerHTML = "";
    const n = days.length;
    if (!n) return { series: [], scenarios: [] };

    const scenarios = opts.scenarios || [];
    const active = scenarios.find((s) => s.active) || null;
    // Waarde waarop de sleeppunten liggen: het actieve scenario als dat een
    // bijstelling voor die dag heeft, anders de modelprognose.
    const handleValue = (d, i) =>
      (active && active.values[i] != null ? active.values[i] : d.pred);

    // ── Breedte: schaal mee met de container, maar nooit onder MIN_DAY_PX/dag ──
    const wrap = svg.parentElement;
    const avail = wrap.clientWidth || BASE_W;
    const W = Math.max(avail, M.l + M.r + n * MIN_DAY_PX, 480);
    const scrolls = W > avail + 1;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.width = scrolls ? `${W}px` : "100%";

    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const x = (i) => M.l + (iw * (i + 0.5)) / n;
    const band = iw / n;

    // ── Y-domein: altijd de volledige reeks, inclusief pieken ──
    let dataMax = 0;
    for (const d of days) {
      for (const k of ["actual", "hi", "pred", "lastYearActual"]) {
        if (d[k] != null && d[k] > dataMax) dataMax = d[k];
      }
    }
    for (const s of scenarios) {
      for (const v of s.values) if (v != null && v > dataMax) dataMax = v;
    }

    const yTicks = niceTicks((dataMax || 1) * 1.05, 5);
    const yTop = yTicks[yTicks.length - 1];
    const y = (v) => M.t + ih - (ih * Math.min(v, yTop)) / yTop;

    // Clip-pad zodat een dikke lijn op de bovenrand niet buiten het vlak steekt.
    const clipId = "kv-plot-clip";
    const defs = el("defs", {}, svg);
    el("rect", { x: M.l, y: M.t, width: iw, height: ih },
      el("clipPath", { id: clipId }, defs));

    // ── Maandzones (deze vs volgende maand) + labels ──
    const zones = [];
    let zoneStart = 0;
    for (let i = 1; i <= n; i++) {
      if (i === n || days[i].date.slice(0, 7) !== days[zoneStart].date.slice(0, 7)) {
        zones.push([zoneStart, i - 1]);
        zoneStart = i;
      }
    }
    zones.forEach(([a, b]) => {
      const isThis = days[a].date.slice(0, 7) === opts.thisMonth;
      el("rect", {
        x: x(a) - band / 2, y: M.t,
        width: x(b) - x(a) + band, height: ih,
        fill: isThis ? COLORS.thisMonth : COLORS.nextMonth,
      }, svg);
      el("text", {
        x: (x(a) + x(b)) / 2, y: M.t - 12,
        "text-anchor": "middle", "font-size": 13, "font-weight": 700,
        fill: isThis ? COLORS.actual : "#c25e1e",
      }, svg).textContent = isThis ? "deze maand" : "volgende maand";
    });

    // ── Weekend- en feestdagmarkering ──
    days.forEach((d, i) => {
      if (!d.weekend && !d.holiday) return;
      el("rect", {
        x: x(i) - band / 2, y: M.t, width: band, height: ih,
        fill: d.holiday ? COLORS.holiday : COLORS.weekend,
      }, svg);
    });

    // ── Grid + y-as ──
    for (const v of yTicks) {
      el("line", { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), stroke: COLORS.grid }, svg);
      el("text", {
        x: M.l - 10, y: y(v) + 4, "text-anchor": "end", "font-size": 11, fill: COLORS.axis,
      }, svg).textContent = opts.fmtAxis(v);
    }
    el("text", {
      x: 16, y: M.t + ih / 2, "font-size": 11, fill: COLORS.axis,
      transform: `rotate(-90 16 ${M.t + ih / 2})`, "text-anchor": "middle",
    }, svg).textContent = "Ontvangsten per dag";

    // ── x-as: wekelijkse labels ──
    for (let i = 0; i < n; i += 7) {
      el("text", {
        x: x(i), y: H - 14, "text-anchor": "middle", "font-size": 11, fill: COLORS.axis,
      }, svg).textContent = fmtDay(days[i].date);
      el("line", { x1: x(i), x2: x(i), y1: M.t + ih, y2: M.t + ih + 5, stroke: COLORS.axis }, svg);
    }
    el("line", { x1: M.l, x2: W - M.r, y1: M.t + ih, y2: M.t + ih, stroke: COLORS.axis }, svg);

    // ── Startlijn van de prognose ──
    const startIdx = days.findIndex((d) => d.date === opts.forecastStart);
    if (startIdx >= 0) {
      const tx = x(startIdx) - band / 2;
      el("line", {
        x1: tx, x2: tx, y1: M.t, y2: M.t + ih,
        stroke: COLORS.axis, "stroke-dasharray": "3 3",
      }, svg);
      el("text", {
        x: tx + 4, y: M.t + 12, "font-size": 11, fill: COLORS.axis, "text-anchor": "start",
      }, svg).textContent = "prognose vanaf";
    }

    // Datalaag pas hier aanmaken: SVG kent geen z-index, dus alles wat later in
    // het document staat tekent eroverheen. Stond deze groep vóór de
    // achtergrondvlakken, dan vingen die vlakken alle muisklikken op de
    // sleeppunten af.
    const plot = el("g", { "clip-path": `url(#${clipId})` }, svg);

    // ── Onzekerheidsband ──
    const bandPts = days.map((d, i) => [d, i]).filter(([d]) => d.lo != null && d.hi != null);
    if (bandPts.length > 1) {
      const upper = bandPts.map(([d, i]) => [x(i), y(d.hi)]);
      const lower = bandPts.slice().reverse().map(([d, i]) => [x(i), y(d.lo)]);
      el("path", {
        d: linePath(upper) + lower.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("") + "Z",
        fill: COLORS.pred, opacity: 0.14,
      }, plot);
    }

    // ── Basisreeksen; alleen die daadwerkelijk punten hebben ──
    const drawn = [];
    for (const s of SERIES) {
      const pts = days.map((d, i) => (d[s.key] != null ? [x(i), y(d[s.key])] : null)).filter(Boolean);
      if (pts.length < 2) continue;
      el("path", {
        d: linePath(pts), fill: "none", stroke: s.color,
        "stroke-width": s.width, ...(s.dash ? { "stroke-dasharray": s.dash } : {}),
        "stroke-linejoin": "round",
      }, plot);
      drawn.push(s);
    }

    // ── Scenariolijnen; niet-actieve scenario's dunner en lichter ──
    const drawnScenarios = [];
    for (const s of scenarios) {
      const pts = days.map((d, i) => (s.values[i] != null ? [x(i), y(s.values[i])] : null)).filter(Boolean);
      if (pts.length < 2) continue;
      el("path", {
        d: linePath(pts), fill: "none", stroke: s.color,
        "stroke-width": s.active ? 2.75 : 1.75,
        opacity: s.active ? 1 : 0.55,
        "stroke-linejoin": "round",
      }, plot);
      drawnScenarios.push(s);
    }

    // ── Bedienbare prognosepunten ──
    // Structureel gesloten dagen (weekend/feestdag, prognose ~0) doen niet mee:
    // hun basiswaarde is nul, dus een verhouding is daar betekenisloos.
    const floor = opts.dragFloor || 0;
    const activeColor = active ? active.color : COLORS.pred;
    const handles = new Map(); // date -> circle
    days.forEach((d, i) => {
      if (d.pred == null) return;
      const v = handleValue(d, i);
      const editable = d.pred >= floor && !d.weekend && !d.holiday;
      if (!editable) {
        el("circle", { cx: x(i), cy: y(v), r: 2.5, fill: COLORS.pred, opacity: 0.35 }, plot);
        return;
      }
      const adjusted = active && active.values[i] != null;
      const c = el("circle", {
        cx: x(i), cy: y(v), r: 5,
        fill: adjusted ? activeColor : COLORS.pred,
        stroke: "#fff", "stroke-width": 1.5, cursor: "ns-resize",
        "data-i": i, "data-date": d.date,
        tabindex: "0",
        role: "slider",
        "aria-valuemin": "0",
        "aria-valuemax": Math.round(d.pred * (opts.ratioMax || 5)),
        "aria-valuenow": Math.round(v),
        "aria-label": `${d.date}: prognose ${opts.fmtMoney(v)}. Pijltjestoetsen om bij te stellen, Enter voor exacte invoer.`,
      }, plot);
      handles.set(d.date, c);
    });

    // ── Interactie: tooltip, slepen, klikken en toetsenbord ──
    const tip = opts.tooltipEl;
    const pt = svg.createSVGPoint();
    const toLocal = (evt) => {
      pt.x = evt.clientX; pt.y = evt.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    };
    const valueAt = (cy) => ((M.t + ih - cy) / ih) * yTop;
    const clampY = (cy) => Math.min(Math.max(cy, M.t), M.t + ih);

    let drag = null;

    // Elke render hangt nieuwe listeners op hetzelfde svg-element. Zonder de
    // vorige op te ruimen stapelen ze op en vuurt onAdjust straks meermaals.
    if (svg._kvListeners) svg._kvListeners.abort();
    svg._kvListeners = new AbortController();
    const on = { signal: svg._kvListeners.signal };

    svg.addEventListener("pointerdown", (evt) => {
      const t = evt.target;
      if (t.tagName === "circle" && t.dataset.i != null) {
        drag = { i: +t.dataset.i, circle: t, startY: evt.clientY, moved: false };
        svg.setPointerCapture(evt.pointerId);
        evt.preventDefault();
      }
    }, on);

    svg.addEventListener("pointermove", (evt) => {
      const loc = toLocal(evt);
      if (drag) {
        if (Math.abs(evt.clientY - drag.startY) > CLICK_SLOP_PX) drag.moved = true;
        if (!drag.moved) return;
        const cy = clampY(loc.y);
        drag.circle.setAttribute("cy", cy);
        showTip(drag.i, `Nieuwe waarde: <strong>${opts.fmtMoney(valueAt(cy))}</strong>`);
        return;
      }
      const i = Math.min(n - 1, Math.max(0, Math.round(((loc.x - M.l) / iw) * n - 0.5)));
      if (loc.x < M.l - 5 || loc.x > W - M.r + 5 || loc.y < M.t || loc.y > M.t + ih + 20) {
        tip.hidden = true;
        return;
      }
      showTip(i);
    }, on);

    svg.addEventListener("pointerleave", () => { if (!drag) tip.hidden = true; }, on);

    svg.addEventListener("pointerup", (evt) => {
      if (!drag) return;
      const { i, moved } = drag;
      const loc = toLocal(evt);
      drag = null;
      tip.hidden = true;
      // Nauwelijks bewogen? Dan bedoelde de gebruiker een klik: open de exacte
      // invoer in plaats van de waarde te zetten op de plek van de muis.
      if (!moved) {
        opts.onOpenEditor && opts.onOpenEditor(days[i].date);
        return;
      }
      opts.onAdjust && opts.onAdjust(days[i].date, Math.max(0, valueAt(clampY(loc.y))));
    }, on);

    // Toetsenbodiening: pijltjes verschuiven met een percentage van de
    // modelprognose, zodat de stapgrootte klopt bij elk bedragniveau.
    svg.addEventListener("keydown", (evt) => {
      const t = evt.target;
      if (t.tagName !== "circle" || t.dataset.i == null) return;
      const i = +t.dataset.i;
      const d = days[i];
      const current = handleValue(d, i);
      const stepBig = evt.shiftKey;
      const step = d.pred * (stepBig ? 0.1 : 0.01);
      let next = null;

      if (evt.key === "ArrowUp" || evt.key === "ArrowRight") next = current + step;
      else if (evt.key === "ArrowDown" || evt.key === "ArrowLeft") next = current - step;
      else if (evt.key === "PageUp") next = current + d.pred * 0.1;
      else if (evt.key === "PageDown") next = current - d.pred * 0.1;
      else if (evt.key === "Home") next = d.pred; // terug naar de modelwaarde
      else if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        opts.onOpenEditor && opts.onOpenEditor(d.date);
        return;
      } else if (evt.key === "Delete" || evt.key === "Backspace") {
        evt.preventDefault();
        opts.onRemove && opts.onRemove(d.date);
        return;
      } else return;

      evt.preventDefault();
      opts.onAdjust && opts.onAdjust(d.date, Math.max(0, next));
    }, on);

    svg.addEventListener("focusin", (evt) => {
      const t = evt.target;
      if (t.tagName === "circle" && t.dataset.i != null) {
        t.setAttribute("stroke", COLORS.focus);
        t.setAttribute("stroke-width", "2.5");
        t.setAttribute("r", "6.5");
        showTip(+t.dataset.i);
      }
    }, on);

    svg.addEventListener("focusout", (evt) => {
      const t = evt.target;
      if (t.tagName === "circle" && t.dataset.i != null) {
        t.setAttribute("stroke", "#fff");
        t.setAttribute("stroke-width", "1.5");
        t.setAttribute("r", "5");
        tip.hidden = true;
      }
    }, on);

    function showTip(i, extra) {
      const d = days[i];
      const rows = [
        `<strong>${fmtDay(d.date)}</strong>` +
          (d.holiday ? ` · ${d.holiday}` : d.weekend ? " · weekend" : ""),
        d.actual != null ? `Werkelijk: ${opts.fmtMoney(d.actual)}` : null,
        d.pred != null
          ? `Prognose: ${opts.fmtMoney(d.pred)} (${opts.fmtMoney(d.lo)} – ${opts.fmtMoney(d.hi)})`
          : null,
      ];
      for (const s of scenarios) {
        if (s.values[i] == null) continue;
        rows.push(`<span style="color:${s.color}">■</span> ${s.name}: ${opts.fmtMoney(s.values[i])}`);
      }
      if (d.lastYearActual != null) {
        // Datum erbij: de vergelijking loopt 52 weken terug, niet naar dezelfde
        // kalenderdatum, en dat moet je kunnen zien.
        const when = d.lastYearDate ? ` (${fmtDay(d.lastYearDate)})` : "";
        rows.push(`Vorig jaar${when}: ${opts.fmtMoney(d.lastYearActual)}`);
      }
      if (extra) rows.push(extra);

      tip.innerHTML = rows.filter(Boolean).join("<br>");
      tip.hidden = false;
      // Positioneer t.o.v. de wrapper, met de horizontale scrollpositie erin
      // verrekend zodat de tooltip ook op smalle schermen bij het punt staat.
      const scale = svg.getBoundingClientRect().width / W;
      const fx = x(i) * scale - wrap.scrollLeft;
      tip.style.left = Math.max(4, Math.min(fx + 12, wrap.clientWidth - tip.offsetWidth - 4)) + "px";
      tip.style.top = "18px";
    }

    // Na een hertekening is de DOM vervangen; focus terugzetten zodat
    // toetsenbodiening niet na elke aanpassing naar het begin springt.
    if (opts.focusDate && handles.has(opts.focusDate)) {
      handles.get(opts.focusDate).focus({ preventScroll: true });
    }

    return {
      series: drawn,
      scenarios: drawnScenarios,
      dataMax,
      shownTop: yTop,
      scrolls,
      // Schermpositie van een punt, voor het plaatsen van de invoerpopover.
      pointRect: (iso) => {
        const c = handles.get(iso);
        return c ? c.getBoundingClientRect() : null;
      },
    };
  };
})();
