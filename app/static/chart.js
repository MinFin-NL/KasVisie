/* KVChart — minimale SVG-lijngrafiek voor de kasprognose.
   Geen externe libraries; tekent onzekerheidsband, weekend-/feestdagmarkering,
   vandaag-lijn, en ondersteunt verticaal slepen van prognosepunten. */

(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const W = 920, H = 430;
  const M = { l: 64, r: 14, t: 30, b: 40 };

  const COLORS = {
    actual: "#2f6cb3",
    pred: "#d52b1e",
    adj: "#8a1408",
    lastYear: "#3d8757",
    weekend: "rgba(96, 116, 130, 0.10)",
    holiday: "rgba(255, 182, 18, 0.18)",
    thisMonth: "rgba(47, 108, 179, 0.05)",
    nextMonth: "rgba(224, 121, 38, 0.06)",
    grid: "#e3e7e9",
    axis: "#5f5e5c",
  };

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
  const fmtNum = (v) =>
    v == null ? "–" : Math.round(v).toLocaleString("nl-NL");

  function linePath(pts) {
    return pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  }

  // days: [{date, actual, pred, lo, hi, adj, lastYearActual, weekend, holiday}]
  // opts: {today, thisMonth, tooltipEl, onAdjust(date, value)}
  window.KVChart = function render(svg, days, opts) {
    svg.innerHTML = "";
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const n = days.length;
    const x = (i) => M.l + (iw * (i + 0.5)) / n;

    let yMax = 0;
    for (const d of days) {
      for (const k of ["actual", "hi", "pred", "adj", "lastYearActual"]) {
        if (d[k] != null && d[k] > yMax) yMax = d[k];
      }
    }
    yMax = yMax || 1;
    const yTicks = niceTicks(yMax * 1.05, 5);
    const yTop = yTicks[yTicks.length - 1];
    const y = (v) => M.t + ih - (ih * v) / yTop;

    // Maandzones (deze vs volgende maand) + labels
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
        x: x(a) - iw / n / 2, y: M.t,
        width: x(b) - x(a) + iw / n,
        height: ih,
        fill: isThis ? COLORS.thisMonth : COLORS.nextMonth,
      }, svg);
      el("text", {
        x: (x(a) + x(b)) / 2, y: M.t - 10,
        "text-anchor": "middle", "font-size": 13, "font-weight": 700,
        fill: isThis ? COLORS.actual : "#c25e1e",
      }, svg).textContent = isThis ? "deze maand" : "volgende maand";
    });

    // Weekend- en feestdagmarkering (achtergrondbanden)
    days.forEach((d, i) => {
      if (!d.weekend && !d.holiday) return;
      el("rect", {
        x: x(i) - iw / n / 2, y: M.t,
        width: iw / n, height: ih,
        fill: d.holiday ? COLORS.holiday : COLORS.weekend,
      }, svg);
    });

    // Grid + y-as
    for (const v of yTicks) {
      el("line", { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), stroke: COLORS.grid }, svg);
      el("text", {
        x: M.l - 8, y: y(v) + 4, "text-anchor": "end", "font-size": 11, fill: COLORS.axis,
      }, svg).textContent = fmtNum(v);
    }
    el("text", {
      x: 14, y: M.t + ih / 2, "font-size": 11, fill: COLORS.axis,
      transform: `rotate(-90 14 ${M.t + ih / 2})`, "text-anchor": "middle",
    }, svg).textContent = "Ontvangsten / dag";

    // x-as: wekelijkse labels
    for (let i = 0; i < n; i += 7) {
      el("text", {
        x: x(i), y: H - 12, "text-anchor": "middle", "font-size": 11, fill: COLORS.axis,
      }, svg).textContent = fmtDay(days[i].date);
      el("line", { x1: x(i), x2: x(i), y1: M.t + ih, y2: M.t + ih + 5, stroke: COLORS.axis }, svg);
    }
    el("line", { x1: M.l, x2: W - M.r, y1: M.t + ih, y2: M.t + ih, stroke: COLORS.axis }, svg);

    // Vandaag-lijn
    const todayIdx = days.findIndex((d) => d.date === opts.today);
    if (todayIdx >= 0) {
      const tx = x(todayIdx) - iw / n / 2;
      el("line", {
        x1: tx, x2: tx, y1: M.t, y2: M.t + ih,
        stroke: COLORS.axis, "stroke-dasharray": "3 3",
      }, svg);
      el("text", {
        x: tx, y: M.t + 12, "font-size": 11, fill: COLORS.axis, "text-anchor": "middle",
      }, svg).textContent = "vandaag";
    }

    // Onzekerheidsband
    const bandPts = days.map((d, i) => [d, i]).filter(([d]) => d.lo != null && d.hi != null);
    if (bandPts.length > 1) {
      const upper = bandPts.map(([d, i]) => [x(i), y(d.hi)]);
      const lower = bandPts.slice().reverse().map(([d, i]) => [x(i), y(d.lo)]);
      el("path", {
        d: linePath(upper) + lower.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("") + "Z",
        fill: COLORS.pred, opacity: 0.14,
      }, svg);
    }

    const series = [
      { key: "lastYearActual", color: COLORS.lastYear, dash: "2 4", width: 2 },
      { key: "actual", color: COLORS.actual, dash: null, width: 2 },
      { key: "pred", color: COLORS.pred, dash: "6 4", width: 2 },
      { key: "adj", color: COLORS.adj, dash: null, width: 2.5 },
    ];
    for (const s of series) {
      const pts = days.map((d, i) => (d[s.key] != null ? [x(i), y(d[s.key])] : null)).filter(Boolean);
      if (pts.length < 2) continue;
      el("path", {
        d: linePath(pts), fill: "none", stroke: s.color,
        "stroke-width": s.width, ...(s.dash ? { "stroke-dasharray": s.dash } : {}),
        "stroke-linejoin": "round",
      }, svg);
    }

    // Sleepbare prognosepunten (op de aangepaste waarde als die er is)
    const dragKey = (d) => (d.adj != null ? "adj" : "pred");
    const handles = [];
    days.forEach((d, i) => {
      if (d.pred == null) return;
      const c = el("circle", {
        cx: x(i), cy: y(d[dragKey(d)]), r: 5,
        fill: d.adj != null ? COLORS.adj : COLORS.pred,
        stroke: "#fff", "stroke-width": 1.5, cursor: "ns-resize",
        "data-i": i,
      }, svg);
      handles.push(c);
    });

    // Interactie: tooltip + slepen
    const tip = opts.tooltipEl;
    const pt = svg.createSVGPoint();
    const toLocal = (evt) => {
      pt.x = evt.clientX; pt.y = evt.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    };

    let drag = null; // {i, circle}

    svg.addEventListener("pointerdown", (evt) => {
      const t = evt.target;
      if (t.tagName === "circle" && t.dataset.i != null) {
        drag = { i: +t.dataset.i, circle: t };
        svg.setPointerCapture(evt.pointerId);
        evt.preventDefault();
      }
    });

    svg.addEventListener("pointermove", (evt) => {
      const loc = toLocal(evt);
      if (drag) {
        const cy = Math.min(Math.max(loc.y, M.t), M.t + ih);
        drag.circle.setAttribute("cy", cy);
        const val = ((M.t + ih - cy) / ih) * yTop;
        showTip(drag.i, `Nieuwe waarde: <strong>${fmtNum(val)}</strong>`);
        return;
      }
      const i = Math.min(n - 1, Math.max(0, Math.round(((loc.x - M.l) / iw) * n - 0.5)));
      if (loc.x < M.l - 5 || loc.x > W - M.r + 5 || loc.y < M.t || loc.y > M.t + ih + 20) {
        tip.hidden = true;
        return;
      }
      showTip(i);
    });

    svg.addEventListener("pointerleave", () => { if (!drag) tip.hidden = true; });

    svg.addEventListener("pointerup", (evt) => {
      if (!drag) return;
      const loc = toLocal(evt);
      const cy = Math.min(Math.max(loc.y, M.t), M.t + ih);
      const val = ((M.t + ih - cy) / ih) * yTop;
      const day = days[drag.i];
      drag = null;
      tip.hidden = true;
      opts.onAdjust && opts.onAdjust(day.date, Math.max(0, val));
    });

    function showTip(i, extra) {
      const d = days[i];
      const rows = [
        `<strong>${fmtDay(d.date)}</strong>` +
          (d.holiday ? ` · ${d.holiday}` : d.weekend ? " · weekend" : ""),
        d.actual != null ? `Werkelijk: ${fmtNum(d.actual)}` : null,
        d.pred != null ? `Prognose: ${fmtNum(d.pred)} (${fmtNum(d.lo)}–${fmtNum(d.hi)})` : null,
        d.adj != null ? `Bijgesteld: ${fmtNum(d.adj)}` : null,
        d.lastYearActual != null ? `Vorig jaar: ${fmtNum(d.lastYearActual)}` : null,
        extra || null,
      ].filter(Boolean);
      tip.innerHTML = rows.join("<br>");
      tip.hidden = false;
      const wrap = svg.parentElement.getBoundingClientRect();
      const fx = (x(i) / W) * wrap.width;
      tip.style.left = Math.min(fx + 12, wrap.width - tip.offsetWidth - 4) + "px";
      tip.style.top = "18px";
    }
  };
})();
