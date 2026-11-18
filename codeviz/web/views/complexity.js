(function () {
  "use strict";

  // 复杂度视图：squarified treemap。group 分组、文件为块。
  // 面积可切「行数 / 分支」，颜色可切「分支总量 / 分支密度」。
  // 数据来自 data.files / data.symbols，只使用 Canvas + DOM。

  const STYLE = `
.cx-root { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; }
.cx-toolbar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 9px 14px; border-bottom: 1px solid var(--line);
  background: rgba(7, 11, 20, 0.55); z-index: 6;
}
.cx-label { font-size: 11px; color: var(--sub); white-space: nowrap; display: flex; align-items: center; gap: 6px; }
.cx-tabs { display: flex; gap: 2px; padding: 2px; background: rgba(148, 163, 184, 0.08); border-radius: 8px; }
.cx-tab {
  border: 0; background: transparent; color: var(--sub);
  padding: 4px 10px; border-radius: 6px; cursor: pointer;
  font-family: inherit; font-size: 11.5px; white-space: nowrap; transition: all .15s ease;
}
.cx-tab:hover { color: var(--ink); }
.cx-tab.active { background: rgba(56, 189, 248, 0.17); color: #7dd3fc; box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.3); }
.cx-spacer { flex: 1; }
.cx-search { position: relative; width: 236px; }
.cx-search input {
  width: 100%; padding: 7px 11px 7px 29px;
  border-radius: 8px; border: 1px solid var(--line);
  background: rgba(148, 163, 184, 0.06); color: var(--ink);
  font-family: inherit; font-size: 12px; outline: none;
}
.cx-search input:focus { border-color: rgba(56, 189, 248, 0.55); box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.1); }
.cx-search svg { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); opacity: .5; pointer-events: none; }
.cx-btn {
  border: 1px solid var(--line); background: rgba(148, 163, 184, 0.06);
  color: var(--ink); border-radius: 8px; padding: 6px 11px;
  font-family: inherit; font-size: 11.5px; cursor: pointer; white-space: nowrap;
}
.cx-btn:hover { background: rgba(56, 189, 248, 0.12); border-color: rgba(56, 189, 248, 0.35); color: #bae6fd; }
.cx-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; }
.cx-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: pointer; }
.cx-legend {
  position: absolute; left: 14px; bottom: 14px; z-index: 4;
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  padding: 9px 12px; width: 232px;
  backdrop-filter: blur(10px); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.cx-legend h4 { margin: 0 0 6px; font-size: 10.5px; color: var(--sub); font-weight: 600; letter-spacing: .3px; }
.cx-scale { height: 8px; border-radius: 4px; background: linear-gradient(90deg, #22c55e, #f59e0b 55%, #ef4444); }
.cx-scale-labels { display: flex; justify-content: space-between; margin-top: 4px; font-size: 10px; color: var(--sub); }
.cx-note { margin-top: 6px; font-size: 10px; color: var(--sub); line-height: 1.5; }
.cx-tooltip {
  position: absolute; z-index: 9; pointer-events: none;
  background: rgba(9, 15, 27, 0.97); border: 1px solid rgba(56, 189, 248, 0.32);
  border-radius: 9px; padding: 8px 11px; font-size: 11.5px; color: var(--ink);
  max-width: 340px; opacity: 0; transform: translateY(4px);
  transition: opacity .12s ease, transform .12s ease;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
}
.cx-tooltip.show { opacity: 1; transform: translateY(0); }
.cx-tooltip .tt-sub { color: var(--sub); font-size: 10.5px; margin-top: 3px; }
.cx-bar { display: grid; grid-template-columns: minmax(0, 1fr) 58px 36px; gap: 7px; align-items: center; margin: 5px 0; }
.cx-bar .cx-name { font-size: 11px; color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cx-bar .cx-track { height: 6px; background: rgba(148, 163, 184, 0.12); border-radius: 3px; overflow: hidden; }
.cx-bar .cx-track i { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, #22c55e, #f59e0b 60%, #ef4444); }
.cx-bar b { font-size: 10.5px; color: var(--sub); text-align: right; font-weight: 600; }
.cx-bar.click { cursor: pointer; }
.cx-bar.click:hover .cx-name { color: #7dd3fc; }
.cx-actions { display: flex; gap: 6px; margin-top: 10px; }
.cx-actions .cx-btn { flex: 1; }
.cx-mono { font-family: Consolas, "Cascadia Code", "Courier New", monospace; font-size: 10.5px; color: #a5b4fc; }
.cx-sig {
  font-family: Consolas, "Cascadia Code", "Courier New", monospace;
  font-size: 10.5px; color: #a5b4fc; background: rgba(99, 102, 241, 0.09);
  border-radius: 6px; padding: 6px 8px; margin: 0 0 10px; word-break: break-word;
}
.cx-none { color: var(--sub); font-size: 11.5px; }
@media (max-width: 1180px) {
  .cx-legend { display: none; }
  .cx-search { width: 170px; }
}
`;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function num(v, fallback) {
    const n = Number(v);
    return isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function rgba(hex, alpha) {
    const raw = String(hex || "").replace("#", "");
    const h = raw.length === 3 ? raw.split("").map(c => c + c).join("") : raw;
    const n = parseInt(h, 16);
    if (!isFinite(n)) return "rgba(148,163,184," + alpha + ")";
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function basename(path) {
    const p = String(path || "");
    const parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || p;
  }

  function shortFile(path) {
    const p = String(path || "");
    const parts = p.split(/[\\/]/);
    return parts.length > 3 ? ".../" + parts.slice(-3).join("/") : p;
  }

  function mix(hexA, hexB, t) {
    const pa = parseInt(String(hexA).slice(1), 16);
    const pb = parseInt(String(hexB).slice(1), 16);
    const ar = (pa >> 16) & 255;
    const ag = (pa >> 8) & 255;
    const ab = pa & 255;
    const br = (pb >> 16) & 255;
    const bg = (pb >> 8) & 255;
    const bb = pb & 255;
    return "rgb(" + Math.round(ar + (br - ar) * t) + "," + Math.round(ag + (bg - ag) * t) + "," + Math.round(ab + (bb - ab) * t) + ")";
  }

  const NON_FUNCTION = /^(class|module|interface|type|struct|enum|namespace|variable|const|property|field|object|union|trait)$/i;

  function isFunctionSymbol(sym) {
    if (!sym) return false;
    const kind = String(sym.kind || "").toLowerCase();
    if (!kind) return true;
    return !NON_FUNCTION.test(kind);
  }

  window.CodeViz.registerView("complexity", function (ctx) {
    const data = (ctx && ctx.data) || {};
    const rawFiles = Array.isArray(data.files) ? data.files.filter(Boolean) : [];
    const rawSymbols = Array.isArray(data.symbols) ? data.symbols.filter(Boolean) : [];
    const groupsMeta = (data.groups && typeof data.groups === "object") ? data.groups : {};
    const container = ctx.container;

    if (!container) return { activate() {}, deactivate() {} };

    const files = rawFiles
      .filter(f => f && typeof f.path === "string" && f.path)
      .map(f => ({
        path: f.path,
        module: f.module || "",
        group: f.group || "",
        lines: num(f.lines),
        symbols: num(f.symbols),
        branches: num(f.branches),
        excepts: num(f.excepts),
        functions: num(f.functions),
      }));

    if (!files.length) {
      container.innerHTML = '<div class="view-empty">没有可用的文件指标（data.files 为空）</div>';
      return { activate() {}, deactivate() {} };
    }

    const filesByPath = new Map(files.map(f => [f.path, f]));
    const funcsByFile = new Map();
    const allFunctions = [];
    for (const s of rawSymbols) {
      if (!s || !s.file || !isFunctionSymbol(s)) continue;
      const fn = {
        id: s.id || "",
        name: s.name || s.qualified || s.id || "(匿名)",
        qualified: s.qualified || s.name || "",
        file: s.file,
        line: num(s.line),
        lines: num(s.lines),
        branches: num(s.branches),
        excepts: num(s.excepts),
        signature: s.signature || "",
        doc: s.doc || "",
      };
      allFunctions.push(fn);
      if (!funcsByFile.has(fn.file)) funcsByFile.set(fn.file, []);
      funcsByFile.get(fn.file).push(fn);
    }
    for (const list of funcsByFile.values()) {
      list.sort((a, b) => (b.branches - a.branches) || (b.lines - a.lines) || a.name.localeCompare(b.name));
    }
    allFunctions.sort((a, b) => (b.branches - a.branches) || (b.lines - a.lines));
    const fnIndex = new Map();
    allFunctions.forEach((fn, i) => fnIndex.set(fn, i));
    const fnKeyOf = fn => "N:" + (fnIndex.has(fn) ? fnIndex.get(fn) : 0);
    const fileKeyOf = f => "F:" + f.path;

    function groupLabel(group) {
      const meta = group ? groupsMeta[group] : null;
      if (meta && meta.label) return meta.label;
      return group || "未分组";
    }

    function density(f) {
      return f.branches / Math.max(1, f.lines) * 100;
    }

    function funcCount(f) {
      if (f.functions > 0) return f.functions;
      const list = funcsByFile.get(f.path);
      return list ? list.length : 0;
    }

    // ---------------- DOM ----------------
    container.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = STYLE;
    container.appendChild(style);

    const root = document.createElement("div");
    root.className = "cx-root";
    container.appendChild(root);

    const toolbar = document.createElement("div");
    toolbar.className = "cx-toolbar";

    const areaLabel = document.createElement("div");
    areaLabel.className = "cx-label";
    areaLabel.appendChild(document.createTextNode("面积"));
    const areaTabs = document.createElement("div");
    areaTabs.className = "cx-tabs";
    const areaButtons = [];
    for (const [key, label] of [["lines", "行数"], ["branches", "分支"]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cx-tab";
      b.dataset.area = key;
      b.textContent = label;
      b.addEventListener("click", () => setArea(key));
      areaTabs.appendChild(b);
      areaButtons.push(b);
    }
    areaLabel.appendChild(areaTabs);
    toolbar.appendChild(areaLabel);

    const colorLabel = document.createElement("div");
    colorLabel.className = "cx-label";
    colorLabel.appendChild(document.createTextNode("颜色"));
    const colorTabs = document.createElement("div");
    colorTabs.className = "cx-tabs";
    const colorButtons = [];
    for (const [key, label] of [["branches", "分支总量"], ["density", "分支密度"]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cx-tab";
      b.dataset.color = key;
      b.textContent = label;
      b.addEventListener("click", () => setColor(key));
      colorTabs.appendChild(b);
      colorButtons.push(b);
    }
    colorLabel.appendChild(colorTabs);
    toolbar.appendChild(colorLabel);

    const spacer = document.createElement("div");
    spacer.className = "cx-spacer";
    toolbar.appendChild(spacer);

    const searchWrap = document.createElement("div");
    searchWrap.className = "cx-search";
    searchWrap.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>';
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "搜索文件 / 函数…";
    searchInput.setAttribute("aria-label", "搜索文件或函数");
    searchWrap.appendChild(searchInput);
    toolbar.appendChild(searchWrap);

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "cx-btn";
    resetBtn.textContent = "重置视图";
    resetBtn.addEventListener("click", () => {
      searchInput.value = "";
      state.query = "";
      if (ctx.router && typeof ctx.router.go === "function") ctx.router.go("complexity");
      else {
        state.selectedPath = null;
        state.selectedFnId = null;
        renderOverview();
        requestDraw();
      }
    });
    toolbar.appendChild(resetBtn);

    root.appendChild(toolbar);

    const stage = document.createElement("div");
    stage.className = "cx-stage";
    root.appendChild(stage);

    const canvas = document.createElement("canvas");
    canvas.className = "cx-canvas";
    stage.appendChild(canvas);

    const legend = document.createElement("div");
    legend.className = "cx-legend";
    const legendTitle = document.createElement("h4");
    const scale = document.createElement("div");
    scale.className = "cx-scale";
    const scaleLabels = document.createElement("div");
    scaleLabels.className = "cx-scale-labels";
    const scaleMin = document.createElement("span");
    scaleMin.textContent = "0";
    const scaleMax = document.createElement("span");
    scaleMax.textContent = "—";
    scaleLabels.appendChild(scaleMin);
    scaleLabels.appendChild(scaleMax);
    const legendNote = document.createElement("div");
    legendNote.className = "cx-note";
    legend.appendChild(legendTitle);
    legend.appendChild(scale);
    legend.appendChild(scaleLabels);
    legend.appendChild(legendNote);
    stage.appendChild(legend);

    const tooltip = document.createElement("div");
    tooltip.className = "cx-tooltip";
    stage.appendChild(tooltip);

    const panel = document.createElement("aside");
    panel.className = "view-panel";
    panel.style.top = "12px";
    panel.style.right = "12px";
    panel.style.bottom = "12px";
    const panelHead = document.createElement("div");
    panelHead.className = "view-panel-head";
    const panelTitle = document.createElement("h2");
    const panelBadge = document.createElement("div");
    panelBadge.className = "badge";
    panelHead.appendChild(panelTitle);
    panelHead.appendChild(panelBadge);
    const panelBody = document.createElement("div");
    panelBody.className = "view-panel-body";
    panel.appendChild(panelHead);
    panel.appendChild(panelBody);
    stage.appendChild(panel);

    // ---------------- state ----------------
    const state = {
      area: "lines",
      color: "branches",
      query: "",
      selectedPath: null,
      selectedFnId: null, // 当前选中的函数（面板上下文；文件块仍按 selectedPath 高亮）
      hover: null,
      tiles: [],
      groupRects: [],
      minScore: 0,
      w: 0,
      h: 0,
      dpr: 1,
      maxScore: 1,
      visible: false,
    };

    function valueOf(f) {
      return Math.max(0.4, state.area === "lines" ? f.lines : f.branches);
    }

    function scoreOf(f) {
      return state.color === "density" ? density(f) : f.branches;
    }

    function viewportW() {
      return Math.max(120, state.w - (state.w > 900 ? 366 : 0));
    }

    function colorFor(score) {
      const range = state.maxScore - state.minScore;
      const t = range > 1e-9 ? clamp((score - state.minScore) / range, 0, 1) : 1;
      return t < 0.5 ? mix("#22c55e", "#f59e0b", t * 2) : mix("#f59e0b", "#ef4444", (t - 0.5) * 2);
    }

    // ---------------- squarified treemap ----------------
    function squarify(items, x, y, w, h) {
      const total = items.reduce((s, it) => s + it.value, 0);
      if (!total || w <= 0 || h <= 0) return [];
      const scaleArea = (w * h) / total;
      const list = items.map(it => ({ item: it, area: Math.max(0.0001, it.value * scaleArea) }))
        .sort((a, b) => b.area - a.area);
      const out = [];
      let row = [];
      let rx = x;
      let ry = y;
      let rw = w;
      let rh = h;
      const worst = (r, side) => {
        const s = r.reduce((a, b) => a + b.area, 0);
        if (!s) return Infinity;
        const max = Math.max(...r.map(i => i.area));
        const min = Math.min(...r.map(i => i.area));
        if (min <= 0) return Infinity;
        return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
      };
      const flush = () => {
        const rowArea = row.reduce((a, b) => a + b.area, 0);
        if (!row.length || rowArea <= 0) { row = []; return; }
        if (rw >= rh) {
          const colW = rowArea / rh;
          let yy = ry;
          for (const it of row) {
            const hh = it.area / colW;
            out.push({ item: it.item, x: rx, y: yy, w: colW, h: hh });
            yy += hh;
          }
          rx += colW;
          rw -= colW;
        } else {
          const rowH = rowArea / rw;
          let xx = rx;
          for (const it of row) {
            const ww = it.area / rowH;
            out.push({ item: it.item, x: xx, y: ry, w: ww, h: rowH });
            xx += ww;
          }
          ry += rowH;
          rh -= rowH;
        }
        row = [];
      };
      let i = 0;
      while (i < list.length) {
        const it = list[i];
        const side = Math.min(rw, rh);
        if (!row.length || worst(row.concat([it]), side) <= worst(row, side)) {
          row.push(it);
          i++;
        } else {
          flush();
        }
      }
      if (row.length) flush();
      return out;
    }

    function computeLayout() {
      const vw = viewportW();
      const vh = state.h;
      state.tiles = [];
      state.groupRects = [];
      if (!vw || !vh) return;

      state.maxScore = 1;
      state.minScore = 0;
      const scores = files.map(f => scoreOf(f)).filter(v => isFinite(v));
      if (scores.length) {
        state.maxScore = Math.max(1, ...scores);
        state.minScore = state.color === "density" ? Math.min(...scores) : 0;
        if (state.maxScore - state.minScore < 1e-9) state.minScore = state.maxScore - 1;
      }

      const byGroup = new Map();
      for (const f of files) {
        if (valueOf(f) <= 0) continue;
        const key = f.group || "未分组";
        if (!byGroup.has(key)) byGroup.set(key, []);
        byGroup.get(key).push(f);
      }
      const groupItems = [...byGroup.entries()].map(([key, list]) => ({
        key: key,
        value: list.reduce((s, f) => s + valueOf(f), 0),
        files: list,
      })).sort((a, b) => b.value - a.value);

      const bottomReserve = state.w > 1180 ? 152 : 24;
      const rects = squarify(groupItems, 12, 12, Math.max(60, vw - 24), Math.max(60, vh - bottomReserve));
      state.groupRects = rects.map(r => ({ key: r.item.key, files: r.item.files, x: r.x, y: r.y, w: r.w, h: r.h }));

      for (const g of state.groupRects) {
        const header = g.h > 74 ? 24 : (g.h > 34 ? 16 : 0);
        const inner = { x: g.x + 4, y: g.y + header, w: g.w - 8, h: g.h - header - 4 };
        if (inner.w < 12 || inner.h < 12) continue;
        const items = g.files.map(f => ({ file: f, value: valueOf(f) }));
        const tileRects = squarify(items, inner.x, inner.y, inner.w, inner.h);
        for (const t of tileRects) {
          state.tiles.push({ file: t.item.file, x: t.x, y: t.y, w: t.w, h: t.h });
        }
      }
      updateLegend();
    }

    function updateLegend() {
      const densityMode = state.color === "density";
      legendTitle.textContent = densityMode ? "分支密度（每 100 行）" : "分支总量";
      scaleMin.textContent = densityMode ? state.minScore.toFixed(1) : "0";
      scaleMax.textContent = densityMode ? state.maxScore.toFixed(1) : String(Math.round(state.maxScore));
      const areaText = state.area === "lines" ? "行数" : "分支数";
      const colorText = densityMode ? "分支密度" : "分支总量";
      legendNote.textContent = "面积 = " + areaText + " · 颜色 = " + colorText + "（越红越高）";
    }

    // ---------------- 绘制 ----------------
    const canvasCtx = canvas.getContext("2d");
    let rafPending = false;

    function requestDraw() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        draw();
      });
    }

    function draw() {
      if (!canvasCtx || !state.w || !state.h) return;
      const c = canvasCtx;
      c.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      const bg = c.createLinearGradient(0, 0, state.w, state.h);
      bg.addColorStop(0, "#070b14");
      bg.addColorStop(0.55, "#0a1322");
      bg.addColorStop(1, "#0b1729");
      c.fillStyle = bg;
      c.fillRect(0, 0, state.w, state.h);

      if (!state.tiles.length) {
        c.fillStyle = "rgba(139,156,182,0.85)";
        c.font = '12px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("没有可绘制的文件指标", viewportW() / 2, state.h / 2);
        return;
      }

      for (const g of state.groupRects) drawGroup(c, g);
      for (const t of state.tiles) drawTile(c, t);
    }

    function matchQuery(f) {
      if (!state.query) return true;
      const q = state.query;
      if (f.path.toLowerCase().indexOf(q) >= 0) return true;
      if (basename(f.path).toLowerCase().indexOf(q) >= 0) return true;
      const list = funcsByFile.get(f.path) || [];
      for (const fn of list) {
        if (String(fn.name).toLowerCase().indexOf(q) >= 0) return true;
      }
      return false;
    }

    function drawGroup(c, g) {
      const matches = !state.query || g.files.some(matchQuery);
      c.globalAlpha = matches ? 1 : 0.28;
      c.fillStyle = "rgba(15,23,42,0.55)";
      roundRect(c, g.x, g.y, g.w, g.h, 8);
      c.fill();
      c.strokeStyle = matches ? "rgba(148,163,184,0.28)" : "rgba(148,163,184,0.1)";
      c.lineWidth = 1;
      c.stroke();
      if (g.w > 82 && g.h > 24) {
        c.fillStyle = matches ? "rgba(191,219,254,0.78)" : "rgba(191,219,254,0.25)";
        c.font = '600 10.5px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
        c.textAlign = "left";
        c.textBaseline = "middle";
        const label = groupLabel(g.key) + " · " + g.files.length;
        c.fillText(ellipsize(c, label, g.w - 16), g.x + 7, g.y + 11);
      }
      c.globalAlpha = 1;
    }

    function drawTile(c, t) {
      const f = t.file;
      const active = state.selectedPath === f.path;
      const hover = state.hover && state.hover.file && state.hover.file.path === f.path;
      const matched = matchQuery(f);
      const alpha = (state.query && !matched) ? 0.1 : 1;
      c.globalAlpha = alpha;

      roundRect(c, t.x + 1, t.y + 1, Math.max(1, t.w - 2), Math.max(1, t.h - 2), 4);
      c.fillStyle = colorFor(scoreOf(f));
      c.globalAlpha = alpha * (hover ? 1 : 0.86);
      c.fill();

      if (active || hover) {
        c.globalAlpha = alpha;
        c.strokeStyle = active ? "#e5ecf7" : "rgba(229,236,247,0.78)";
        c.lineWidth = active ? 2 : 1.2;
        roundRect(c, t.x + 1.5, t.y + 1.5, Math.max(1, t.w - 3), Math.max(1, t.h - 3), 4);
        c.stroke();
      }

      if (t.w > 54 && t.h > 20) {
        c.globalAlpha = alpha;
        c.font = '600 10.5px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillStyle = "rgba(7,11,20,0.8)";
        c.fillText(ellipsize(c, basename(f.path), t.w - 12), t.x + t.w / 2, t.y + t.h / 2);
      }
      c.globalAlpha = 1;
    }

    function ellipsize(c, text, maxW) {
      const str = String(text == null ? "" : text);
      if (c.measureText(str).width <= maxW) return str;
      let t = str;
      while (t.length > 1 && c.measureText(t + "…").width > maxW) t = t.slice(0, -1);
      return t + "…";
    }

    // ---------------- 右侧面板 ----------------
    function barRow(key, label, title, value, max, opts) {
      const options = opts || {};
      const pct = Math.max(3, Math.round(value / Math.max(1, max) * 100));
      return '<div class="cx-bar' + (options.click ? " click" : "") + '" data-key="' + esc(key) + '"' +
        (options.fn ? ' data-fn="1"' : "") + ">" +
        '<span class="cx-name" title="' + esc(title) + '">' + esc(label) + "</span>" +
        '<span class="cx-track"><i style="width:' + pct + '%"></i></span>' +
        "<b>" + esc(value) + "</b></div>";
    }

    function bindBars() {
      panelBody.querySelectorAll(".cx-bar.click[data-key]").forEach(el => {
        el.addEventListener("click", () => {
          const key = el.dataset.key || "";
          if (el.dataset.fn === "1") {
            const fn = allFunctions[Number(key.slice(2))];
            if (fn) openFunction(fn);
          } else {
            const f = filesByPath.get(key.slice(2));
            if (f) {
              state.query = "";
              searchInput.value = "";
              state.selectedPath = f.path;
              state.selectedFnId = null;
              renderFile(f);
              requestDraw();
              if (ctx.router && typeof ctx.router.go === "function") {
                ctx.router.go("complexity", "file=" + encodeURIComponent(f.path));
              }
            }
          }
        });
      });
    }

    function renderOverview() {
      state.selectedPath = null;
      state.selectedFnId = null;
      panelTitle.textContent = "复杂度概览";
      panelBadge.innerHTML = '<i style="background:#f59e0b;color:#f59e0b"></i><span>AST 指标</span>';
      const totalLines = files.reduce((s, f) => s + f.lines, 0);
      const totalBranches = files.reduce((s, f) => s + f.branches, 0);
      const totalFunctions = files.reduce((s, f) => s + funcCount(f), 0);
      const topFiles = files.slice().sort((a, b) => b.branches - a.branches).slice(0, 8);
      const topFns = allFunctions.slice(0, 8);
      const parts = [];
      parts.push('<p class="desc">' + files.length + " 个文件 · " + totalFunctions + " 个函数 · " + totalBranches +
        " 个分支 · " + totalLines + " 行。点击色块查看文件指标与最复杂函数。</p>");
      parts.push('<div class="section"><h3>总体</h3><div class="metrics">' +
        '<div class="metric"><b>' + files.length + "</b><span>文件</span></div>" +
        '<div class="metric"><b>' + totalFunctions + "</b><span>函数</span></div>" +
        '<div class="metric"><b>' + totalBranches + "</b><span>分支</span></div>" +
        "</div></div>");
      parts.push('<div class="section"><h3>分支最多的文件</h3>' +
        (topFiles.length
          ? topFiles.map(f => barRow(fileKeyOf(f), basename(f.path), f.path, f.branches, topFiles[0].branches, { click: true })).join("")
          : '<span class="cx-none">无文件数据</span>') +
        "</div>");
      parts.push('<div class="section"><h3>分支最多的函数</h3>' +
        (topFns.length
          ? topFns.map(fn => barRow(fnKeyOf(fn), fn.name + " · " + shortFile(fn.file) + ":" + fn.line, fn.name, fn.branches, topFns[0].branches || 1, { click: true, fn: true })).join("")
          : '<span class="cx-none">data.symbols 中没有函数级数据</span>') +
        "</div>");
      panelBody.innerHTML = parts.join("");
      bindBars();
    }

    function renderFile(f) {
      state.selectedPath = f.path;
      state.selectedFnId = null;
      const list = funcsByFile.get(f.path) || [];
      const top = list.slice(0, 10);
      const max = top.length ? Math.max(1, top[0].branches) : 1;
      panelTitle.textContent = basename(f.path);
      panelBadge.innerHTML = '<i style="background:' + colorFor(scoreOf(f)) + ";color:" + colorFor(scoreOf(f)) + '"></i><span>' +
        esc(groupLabel(f.group)) + "</span>";
      const parts = [];
      parts.push('<p class="pathline">' + esc(f.path) + "</p>");
      if (f.module) parts.push('<p class="desc" style="margin:0 0 10px">模块：<span class="cx-mono">' + esc(f.module) + "</span></p>");
      parts.push('<div class="section"><h3>文件指标</h3><div class="metrics">' +
        '<div class="metric"><b>' + f.lines + "</b><span>行</span></div>" +
        '<div class="metric"><b>' + funcCount(f) + "</b><span>函数</span></div>" +
        '<div class="metric"><b>' + f.branches + "</b><span>分支</span></div>" +
        '</div><div class="metrics" style="margin-top:7px">' +
        '<div class="metric"><b>' + density(f).toFixed(1) + "</b><span>分支/100 行</span></div>" +
        '<div class="metric"><b>' + f.excepts + "</b><span>except</span></div>" +
        '<div class="metric"><b>' + (f.branches / Math.max(1, funcCount(f))).toFixed(1) + "</b><span>分支/函数</span></div>" +
        "</div></div>");
      parts.push('<div class="section"><h3>最复杂函数（前 ' + top.length + "）</h3>" +
        (top.length
          ? top.map(fn => barRow(fnKeyOf(fn), fn.name + " · 第 " + fn.line + " 行", fn.name, fn.branches, max, { click: true, fn: true })).join("")
          : '<span class="cx-none">该文件没有函数级符号（或 data.symbols 未包含）</span>') +
        "</div>");
      parts.push('<div class="cx-actions"><button type="button" class="cx-btn" data-act="overview">返回概览</button>' +
        '<button type="button" class="cx-btn" data-act="file-src">查看文件</button></div>');
      panelBody.innerHTML = parts.join("");
      bindBars();
      const back = panelBody.querySelector('[data-act="overview"]');
      if (back) back.addEventListener("click", () => {
        if (ctx.router && typeof ctx.router.go === "function") ctx.router.go("complexity");
        else { renderOverview(); requestDraw(); }
      });
      const src = panelBody.querySelector('[data-act="file-src"]');
      if (src) src.addEventListener("click", () => {
        if (ctx.source && typeof ctx.source.showFile === "function") ctx.source.showFile(f.path, 1);
      });
    }

    function openFunction(fn) {
      state.selectedFnId = fn.id || null;
      state.selectedPath = fn.file || state.selectedPath;
      const file = filesByPath.get(fn.file) || null;
      panelTitle.textContent = fn.name;
      panelBadge.innerHTML = '<i style="background:#ef4444;color:#ef4444"></i><span>函数</span>';
      const densityValue = fn.lines ? (fn.branches / Math.max(1, fn.lines) * 100).toFixed(1) : "—";
      const verdict = fn.branches >= 25
        ? "分支较多：改动前先确认调用方与测试覆盖，考虑拆分函数。"
        : fn.branches >= 12
          ? "中等复杂度：注意边界条件与异常分支。"
          : "相对简单：仍建议确认调用链与数据口径。";
      const parts = [];
      parts.push('<p class="pathline">' + esc(fn.file) + ":" + fn.line + "</p>");
      if (fn.signature) parts.push('<div class="cx-sig">' + esc(fn.signature) + "</div>");
      if (fn.doc) parts.push('<p class="desc">' + esc(fn.doc) + "</p>");
      parts.push('<div class="section"><h3>指标</h3><div class="metrics">' +
        '<div class="metric"><b>' + fn.lines + "</b><span>行</span></div>" +
        '<div class="metric"><b>' + fn.branches + "</b><span>分支</span></div>" +
        '<div class="metric"><b>' + fn.excepts + "</b><span>except</span></div>" +
        '</div><div class="metrics" style="margin-top:7px">' +
        '<div class="metric"><b>' + densityValue + "</b><span>分支/100 行</span></div>" +
        '<div class="metric"><b>' + (file ? file.branches : "—") + "</b><span>文件分支</span></div>" +
        '<div class="metric"><b>' + (file ? funcCount(file) : "—") + "</b><span>文件函数</span></div>" +
        "</div></div>");
      parts.push('<div class="section"><h3>判断</h3><p class="desc" style="margin:0">' + esc(verdict) + "</p></div>");
      parts.push('<div class="cx-actions"><button type="button" class="cx-btn" data-act="src">打开源码</button>' +
        (file ? '<button type="button" class="cx-btn" data-act="file">返回文件</button>' : "") +
        "</div>");
      panelBody.innerHTML = parts.join("");
      const srcBtn = panelBody.querySelector('[data-act="src"]');
      if (srcBtn) srcBtn.addEventListener("click", () => openSource(fn));
      const fileBtn = panelBody.querySelector('[data-act="file"]');
      if (fileBtn) fileBtn.addEventListener("click", () => { renderFile(file); requestDraw(); });
      requestDraw();
      openSource(fn);
    }

    function openSource(fn) {
      if (fn && fn.id && ctx.source && typeof ctx.source.show === "function") {
        ctx.source.show(fn.id);
      } else if (fn && ctx.source && typeof ctx.source.showFile === "function") {
        ctx.source.showFile(fn.file, fn.line);
      } else if (window.CodeViz && window.CodeViz.toast) {
        window.CodeViz.toast("源码面板不可用");
      }
    }

    function renderSearch(rawQuery) {
      const q = rawQuery.trim().toLowerCase();
      if (!q) {
        renderOverview();
        return;
      }
      const filesHit = files.filter(f => f.path.toLowerCase().indexOf(q) >= 0).slice(0, 8);
      const fnHit = allFunctions.filter(fn => (fn.name + " " + fn.qualified + " " + fn.file).toLowerCase().indexOf(q) >= 0).slice(0, 10);
      panelTitle.textContent = "搜索：" + rawQuery.trim();
      panelBadge.innerHTML = '<i style="background:#38bdf8;color:#38bdf8"></i><span>' + (filesHit.length + fnHit.length) + " 项匹配</span>";
      const parts = [];
      if (!filesHit.length && !fnHit.length) {
        parts.push('<span class="cx-none">没有匹配的文件或函数，试试文件名 / 函数名的一部分。</span>');
      } else {
        parts.push('<div class="section"><h3>文件（' + filesHit.length + "）</h3>" +
          (filesHit.length
            ? filesHit.map(f => barRow(fileKeyOf(f), basename(f.path), f.path, f.branches, Math.max(1, filesHit[0].branches), { click: true })).join("")
            : '<span class="cx-none">无</span>') +
          "</div>");
        parts.push('<div class="section"><h3>函数（' + fnHit.length + "）</h3>" +
          (fnHit.length
            ? fnHit.map(fn => barRow(fnKeyOf(fn), fn.name + " · " + shortFile(fn.file) + ":" + fn.line, fn.name, fn.branches, Math.max(1, fnHit[0].branches), { click: true, fn: true })).join("")
            : '<span class="cx-none">无</span>') +
          "</div>");
      }
      panelBody.innerHTML = parts.join("");
      bindBars();
    }

    // ---------------- 交互 ----------------
    function tileAt(sx, sy) {
      for (let i = state.tiles.length - 1; i >= 0; i--) {
        const t = state.tiles[i];
        if (sx >= t.x && sx <= t.x + t.w && sy >= t.y && sy <= t.y + t.h) return t;
      }
      return null;
    }

    function localPoint(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function showTooltip(t, sx, sy) {
      if (!t) {
        tooltip.classList.remove("show");
        tooltip.dataset.path = "";
        return;
      }
      const f = t.file;
      if (tooltip.dataset.path !== f.path) {
        tooltip.dataset.path = f.path;
        tooltip.innerHTML = "<b>" + esc(basename(f.path)) + "</b>" +
          '<div class="tt-sub">' + esc(shortFile(f.path)) + "</div>" +
          '<div class="tt-sub">' + f.lines + " 行 · " + funcCount(f) + " 函数 · " + f.branches + " 分支 · 密度 " + density(f).toFixed(1) + "</div>";
        tooltip.style.borderColor = "rgba(56,189,248,0.32)";
      }
      tooltip.classList.add("show");
      const rect = tooltip.getBoundingClientRect();
      let x = sx + 14;
      let y = sy + 14;
      if (x + rect.width > state.w - 10) x = sx - rect.width - 14;
      if (y + rect.height > state.h - 10) y = sy - rect.height - 14;
      tooltip.style.left = Math.max(6, x) + "px";
      tooltip.style.top = Math.max(6, y) + "px";
    }

    canvas.addEventListener("pointermove", e => {
      const p = localPoint(e);
      const t = tileAt(p.x, p.y);
      if (t !== state.hover) {
        state.hover = t;
        requestDraw();
      }
      showTooltip(t, p.x, p.y);
    });
    canvas.addEventListener("pointerleave", () => {
      state.hover = null;
      tooltip.classList.remove("show");
      requestDraw();
    });
    canvas.addEventListener("click", e => {
      const p = localPoint(e);
      const t = tileAt(p.x, p.y);
      if (!t) return;
      const f = t.file;
      state.query = "";
      searchInput.value = "";
      state.selectedPath = f.path;
      state.selectedFnId = null;
      renderFile(f);
      requestDraw();
      if (ctx.router && typeof ctx.router.go === "function") {
        ctx.router.go("complexity", "file=" + encodeURIComponent(f.path));
      }
    });

    function setArea(key) {
      if (state.area === key) return;
      state.area = key;
      for (const b of areaButtons) b.classList.toggle("active", b.dataset.area === key);
      computeLayout();
      requestDraw();
    }

    function setColor(key) {
      if (state.color === key) return;
      state.color = key;
      for (const b of colorButtons) b.classList.toggle("active", b.dataset.color === key);
      computeLayout();
      requestDraw();
    }

    searchInput.addEventListener("input", () => {
      state.query = searchInput.value.trim().toLowerCase();
      renderSearch(searchInput.value);
      requestDraw();
    });
    searchInput.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        searchInput.value = "";
        state.query = "";
        const keep = state.selectedPath ? filesByPath.get(state.selectedPath) : null;
        if (keep) renderFile(keep);
        else renderOverview();
        requestDraw();
      } else if (e.key === "Enter") {
        const target = panelBody.querySelector('.cx-bar.click[data-fn="1"]');
        if (target) target.click();
      }
    });

    // ---------------- 尺寸 / 生命周期 ----------------
    function measure() {
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      state.w = w;
      state.h = h;
      state.dpr = Math.max(1, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * state.dpr) || canvas.height !== Math.round(h * state.dpr)) {
        canvas.width = Math.round(w * state.dpr);
        canvas.height = Math.round(h * state.dpr);
      }
    }

    function handleResize() {
      if (!state.visible) return;
      measure();
      computeLayout();
      requestDraw();
    }

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => handleResize());
      ro.observe(canvas);
    } else {
      window.addEventListener("resize", handleResize);
    }

    function initialTabState() {
      for (const b of areaButtons) b.classList.toggle("active", b.dataset.area === state.area);
      for (const b of colorButtons) b.classList.toggle("active", b.dataset.color === state.color);
    }

    function activate(params) {
      state.visible = true;
      const p = params && typeof params.get === "function" ? params : new URLSearchParams();
      const filePath = p.get("file");
      measure();
      computeLayout();
      if (filePath) {
        const f = filesByPath.get(filePath);
        if (f) {
          renderFile(f);
        } else {
          renderOverview();
          if (window.CodeViz && window.CodeViz.toast) window.CodeViz.toast("未找到文件：" + filePath);
        }
      } else if (state.query) {
        renderSearch(searchInput.value);
      } else {
        renderOverview();
      }
      requestDraw();
      requestAnimationFrame(() => {
        if (!state.visible) return;
        measure();
        computeLayout();
        requestDraw();
      });
    }

    function deactivate() {
      state.visible = false;
      state.hover = null;
      tooltip.classList.remove("show");
    }

    initialTabState();
    updateLegend();

    return { activate, deactivate };
  });
})();
