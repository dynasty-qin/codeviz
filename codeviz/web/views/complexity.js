(function () {
  "use strict";

  // 复杂度视图：squarified treemap。group 分组、文件为块。
  // 面积可切「行数 / 分支」，颜色可切「分支总量 / 分支密度」。
  // 数据来自 data.files / data.symbols，只使用 Canvas + DOM。
  // 公共工具来自 views/common.js（window.CV），主题色来自 window.CVTheme。

  const CV = window.CV;
  const THEME = window.CVTheme;

  const esc = CV.esc;
  const num = CV.num;
  const clamp = CV.clamp;

  // 绿 -> 琥珀 -> 红；语义保持「越红越复杂」。
  const SCALE = THEME.scale;

  // 数据里的颜色写进内联样式前先过白名单，防止注入 CSS。
  const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

  function safeColor(value, fallback) {
    const text = String(value == null ? "" : value).trim();
    return HEX_COLOR.test(text) ? text : fallback;
  }

  const STYLE = `
.cx-root { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; }
.cx-toolbar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 9px 14px; border-bottom: 1px solid var(--line);
  background: var(--panel); z-index: 6;
}
.cx-label {
  font-size: 12px; color: var(--sub); white-space: nowrap;
  display: flex; align-items: center; gap: 6px;
}
.cx-tabs {
  display: flex; gap: 2px; padding: 2px;
  background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px;
}
.cx-tab {
  border: 0; background: transparent; color: var(--sub);
  padding: 4px 10px; border-radius: 6px; cursor: pointer;
  font-family: inherit; font-size: 12px; white-space: nowrap;
  transition: background .15s ease, color .15s ease;
}
.cx-tab:hover { color: var(--ink); background: var(--accent-soft); }
.cx-tab.active {
  background: var(--accent-soft); color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent); font-weight: 600;
}
.cx-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.cx-spacer { flex: 1; }
.cx-search { position: relative; width: 236px; }
.cx-search input {
  width: 100%; padding: 7px 11px 7px 29px;
  border-radius: 8px; border: 1px solid var(--line);
  background: var(--panel-2); color: var(--ink);
  font-family: inherit; font-size: 12px; outline: none;
}
.cx-search input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.cx-search svg { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); opacity: .55; pointer-events: none; }
.cx-btn {
  border: 1px solid var(--line); background: var(--panel-2);
  color: var(--ink); border-radius: 8px; padding: 6px 11px;
  font-family: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
  transition: background .15s ease, border-color .15s ease, color .15s ease;
}
.cx-btn:hover { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.cx-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.cx-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; }
.cx-stage .view-panel { top: 12px; right: 12px; bottom: 12px; width: 340px; }
.cx-canvas {
  position: absolute; inset: 0; width: 100%; height: 100%; display: block;
  cursor: pointer; outline: none;
}
.cx-canvas:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }
.cx-legend {
  position: absolute; left: 14px; bottom: 14px; z-index: 4;
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  padding: 9px 12px; width: 232px;
  box-shadow: 0 12px 40px var(--shadow);
}
.cx-legend h4 { margin: 0 0 6px; font-size: 11.5px; color: var(--sub); font-weight: 600; letter-spacing: .3px; }
.cx-scale { height: 8px; border-radius: 4px; background: linear-gradient(90deg, #4d7c0f, #c2830a 55%, #b3261e); }
.cx-scale-labels { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11.5px; color: var(--sub); }
.cx-note { margin-top: 6px; font-size: 11.5px; color: var(--sub); line-height: 1.5; }
.cx-tooltip {
  position: absolute; z-index: 9; pointer-events: none;
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 9px; padding: 8px 11px; font-size: 12px; color: var(--ink);
  max-width: 340px; opacity: 0; transform: translateY(4px);
  transition: opacity .12s ease, transform .12s ease;
  box-shadow: 0 10px 30px var(--shadow);
}
.cx-tooltip.show { opacity: 1; transform: translateY(0); }
.cx-tooltip .tt-sub { color: var(--sub); font-size: 12px; margin-top: 3px; }
.cx-bar { display: grid; grid-template-columns: minmax(0, 1fr) 58px 36px; gap: 7px; align-items: center; margin: 5px 0; }
.cx-bar .cx-name { font-size: 12px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cx-bar .cx-track { height: 6px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 3px; overflow: hidden; }
.cx-bar .cx-track i { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, #4d7c0f, #c2830a 60%, #b3261e); }
.cx-bar b { font-size: 11.5px; color: var(--sub); text-align: right; font-weight: 600; }
.cx-bar.click { cursor: pointer; }
.cx-bar.click:hover .cx-name { color: var(--accent); }
.cx-bar.click:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 4px; }
.cx-actions { display: flex; gap: 6px; margin-top: 10px; }
.cx-actions .cx-btn { flex: 1; }
.cx-mono { font-family: var(--mono, Consolas), "Cascadia Code", "Courier New", monospace; font-size: 12px; color: var(--ink); }
.cx-sig {
  font-family: var(--mono, Consolas), "Cascadia Code", "Courier New", monospace;
  font-size: 12px; color: var(--ink); background: var(--panel-2);
  border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px;
  margin: 0 0 10px; word-break: break-word;
}
.cx-none { color: var(--sub); font-size: 12px; }
@media (max-width: 1180px) {
  .cx-legend { display: none; }
  .cx-search { width: 180px; }
}
@media (max-width: 900px) {
  .cx-stage .view-panel {
    top: auto; left: 8px; right: 8px; bottom: 8px;
    width: auto; max-height: 42%;
  }
  .cx-search { width: 150px; }
  .cx-toolbar { gap: 8px; }
}
`;

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
      // key 直接就是数组下标：面板里的点击永远回到同一个函数对象。
      fn.key = "N:" + allFunctions.length;
      allFunctions.push(fn);
      if (!funcsByFile.has(fn.file)) funcsByFile.set(fn.file, []);
      funcsByFile.get(fn.file).push(fn);
    }
    for (const list of funcsByFile.values()) {
      list.sort((a, b) => (b.branches - a.branches) || (b.lines - a.lines) || a.name.localeCompare(b.name));
    }
    allFunctions.sort((a, b) => (b.branches - a.branches) || (b.lines - a.lines));
    const fnKeyOf = fn => (fn && fn.key) ? fn.key : "N:" + Math.max(0, allFunctions.indexOf(fn));
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
      b.title = key === "lines" ? "色块面积按代码行数" : "色块面积按分支数";
      b.setAttribute("aria-pressed", "false");
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
      b.title = key === "density" ? "颜色按每 100 行分支数" : "颜色按分支总数";
      b.setAttribute("aria-pressed", "false");
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
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "复杂度矩形树图：面积表示行数或分支数，颜色越红复杂度越高；点击色块查看文件指标与最复杂函数。");
    stage.appendChild(canvas);

    const legend = document.createElement("div");
    legend.className = "cx-legend";
    const legendTitle = document.createElement("h4");
    const scale = document.createElement("div");
    scale.className = "cx-scale";
    // 与画布共用主题里的同一组色阶，避免 CSS / Canvas 两套颜色漂移。
    scale.style.background = "linear-gradient(90deg, " + SCALE[0] + " 0%, " + SCALE[1] + " 55%, " + SCALE[2] + " 100%)";
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
      return t < 0.5 ? CV.mix(SCALE[0], SCALE[1], t * 2) : CV.mix(SCALE[1], SCALE[2], (t - 0.5) * 2);
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
      // 窄屏详情面板是底部抽屉，treemap 只铺满上方可视区。
      const vh = state.w <= 900 ? Math.max(200, state.h * 0.56) : state.h;
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
      bg.addColorStop(0, THEME.bg0);
      bg.addColorStop(0.55, THEME.bg1);
      bg.addColorStop(1, THEME.bg2);
      c.fillStyle = bg;
      c.fillRect(0, 0, state.w, state.h);

      if (!state.tiles.length) {
        c.fillStyle = THEME.sub;
        c.font = '12px ' + CV.FONT;
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
      if (CV.basename(f.path).toLowerCase().indexOf(q) >= 0) return true;
      const list = funcsByFile.get(f.path) || [];
      for (const fn of list) {
        if (String(fn.name).toLowerCase().indexOf(q) >= 0) return true;
      }
      return false;
    }

    function drawGroup(c, g) {
      const matches = !state.query || g.files.some(matchQuery);
      c.globalAlpha = matches ? 1 : 0.3;
      // 近白底 + 浅描边，让分组在浅色画布上「浮」起来而不抢色块颜色。
      c.fillStyle = CV.tint(THEME.bg1, 0.55);
      CV.roundRect(c, g.x, g.y, g.w, g.h, 8);
      c.fill();
      c.strokeStyle = matches ? THEME.line : CV.rgba(THEME.ink, 0.06);
      c.lineWidth = 1;
      c.stroke();
      if (g.w > 82 && g.h > 24) {
        c.fillStyle = CV.rgba(THEME.ink, matches ? 0.72 : 0.28);
        c.font = '600 11.5px ' + CV.FONT;
        c.textAlign = "left";
        c.textBaseline = "middle";
        const label = groupLabel(g.key) + " · " + g.files.length;
        c.fillText(CV.ellipsize(c, label, g.w - 16), g.x + 7, g.y + 11);
      }
      c.globalAlpha = 1;
    }

    function drawTile(c, t) {
      const f = t.file;
      const active = state.selectedPath === f.path;
      const hover = state.hover && state.hover.file && state.hover.file.path === f.path;
      const matched = matchQuery(f);
      const alpha = (state.query && !matched) ? 0.12 : 1;
      const base = colorFor(scoreOf(f));
      c.globalAlpha = alpha;

      // 浅色主题：色阶先和白色混合成柔和的底色，再加深色描边保证边界可辨。
      CV.roundRect(c, t.x + 1, t.y + 1, Math.max(1, t.w - 2), Math.max(1, t.h - 2), 4);
      c.fillStyle = CV.tint(base, hover ? 0.58 : 0.68);
      c.fill();
      c.strokeStyle = CV.rgba(CV.mix(base, THEME.ink, 0.2), hover ? 0.65 : 0.42);
      c.lineWidth = 1;
      c.stroke();

      if (active || hover) {
        c.strokeStyle = active ? THEME.accent : CV.rgba(THEME.ink, 0.5);
        c.lineWidth = active ? 2 : 1.2;
        CV.roundRect(c, t.x + 1.5, t.y + 1.5, Math.max(1, t.w - 3), Math.max(1, t.h - 3), 4);
        c.stroke();
      }

      if (t.w > 54 && t.h > 20) {
        c.font = '600 11.5px ' + CV.FONT;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillStyle = CV.rgba(THEME.ink, 0.86);
        c.fillText(CV.ellipsize(c, CV.basename(f.path), t.w - 12), t.x + t.w / 2, t.y + t.h / 2);
      }
      c.globalAlpha = 1;
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
      const badgeColor = safeColor(SCALE[1], THEME.accent);
      panelBadge.innerHTML = '<i style="background:' + badgeColor + ";color:" + badgeColor + '"></i><span>AST 指标</span>';
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
          ? topFiles.map(f => barRow(fileKeyOf(f), CV.basename(f.path), f.path, f.branches, topFiles[0].branches, { click: true })).join("")
          : '<span class="cx-none">无文件数据</span>') +
        "</div>");
      parts.push('<div class="section"><h3>分支最多的函数</h3>' +
        (topFns.length
          ? topFns.map(fn => barRow(fnKeyOf(fn), fn.name + " · " + CV.shortPath(fn.file, 3) + ":" + fn.line, fn.name, fn.branches, topFns[0].branches || 1, { click: true, fn: true })).join("")
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
      panelTitle.textContent = CV.basename(f.path);
      const badgeColor = safeColor(colorFor(scoreOf(f)), THEME.accent);
      panelBadge.innerHTML = '<i style="background:' + badgeColor + ";color:" + badgeColor + '"></i><span>' +
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
      const badgeColor = safeColor(SCALE[2], THEME.accent);
      panelBadge.innerHTML = '<i style="background:' + badgeColor + ";color:" + badgeColor + '"></i><span>函数</span>';
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
      const badgeColor = safeColor(THEME.accent, THEME.accent);
      panelBadge.innerHTML = '<i style="background:' + badgeColor + ";color:" + badgeColor + '"></i><span>' +
        (filesHit.length + fnHit.length) + " 项匹配</span>";
      const parts = [];
      if (!filesHit.length && !fnHit.length) {
        parts.push('<span class="cx-none">没有匹配的文件或函数，试试文件名 / 函数名的一部分。</span>');
      } else {
        parts.push('<div class="section"><h3>文件（' + filesHit.length + "）</h3>" +
          (filesHit.length
            ? filesHit.map(f => barRow(fileKeyOf(f), CV.basename(f.path), f.path, f.branches, Math.max(1, filesHit[0].branches), { click: true })).join("")
            : '<span class="cx-none">无</span>') +
          "</div>");
        parts.push('<div class="section"><h3>函数（' + fnHit.length + "）</h3>" +
          (fnHit.length
            ? fnHit.map(fn => barRow(fnKeyOf(fn), fn.name + " · " + CV.shortPath(fn.file, 3) + ":" + fn.line, fn.name, fn.branches, Math.max(1, fnHit[0].branches), { click: true, fn: true })).join("")
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
        tooltip.innerHTML = "<b>" + esc(CV.basename(f.path)) + "</b>" +
          '<div class="tt-sub">' + esc(CV.shortPath(f.path, 3)) + "</div>" +
          '<div class="tt-sub">' + f.lines + " 行 · " + funcCount(f) + " 函数 · " + f.branches + " 分支 · 密度 " + density(f).toFixed(1) + "</div>";
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
      for (const b of areaButtons) {
        const on = b.dataset.area === key;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      }
      computeLayout();
      requestDraw();
    }

    function setColor(key) {
      if (state.color === key) return;
      state.color = key;
      for (const b of colorButtons) {
        const on = b.dataset.color === key;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      }
      computeLayout();
      requestDraw();
    }

    // 搜索去抖：输入停顿后才做文件 / 函数全量匹配。
    const SEARCH_DEBOUNCE = 120;
    let searchTimer = 0;

    function applySearch() {
      state.query = searchInput.value.trim().toLowerCase();
      renderSearch(searchInput.value);
      requestDraw();
    }

    searchInput.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      if (!searchInput.value.trim()) {
        state.query = "";
        renderOverview();
        requestDraw();
        return;
      }
      searchTimer = window.setTimeout(applySearch, SEARCH_DEBOUNCE);
    });
    searchInput.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        window.clearTimeout(searchTimer);
        searchInput.value = "";
        state.query = "";
        const keep = state.selectedPath ? filesByPath.get(state.selectedPath) : null;
        if (keep) renderFile(keep);
        else renderOverview();
        requestDraw();
      } else if (e.key === "Enter") {
        // 回车立即结算当前输入并打开第一条函数结果。
        window.clearTimeout(searchTimer);
        if (searchInput.value.trim()) applySearch();
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
      // 高分屏封顶 2 倍，避免大画布吃掉过多内存。
      state.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
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
      for (const b of areaButtons) {
        const on = b.dataset.area === state.area;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      }
      for (const b of colorButtons) {
        const on = b.dataset.color === state.color;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      }
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
      window.clearTimeout(searchTimer);
      tooltip.classList.remove("show");
    }

    initialTabState();
    updateLegend();

    return { activate, deactivate };
  });
})();
