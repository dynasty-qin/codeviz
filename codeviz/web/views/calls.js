(function () {
  "use strict";

  // 调用链视图：数据驱动（data.symbols / data.calls / data.entries）。
  // 2D 分层布局：根函数居中偏左，callees 向右展开，直接调用者（up=1）在左侧。
  // 只使用 Canvas + DOM，不依赖任何外部库。

  const STYLE = `
.cv-calls { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; }
.cv-toolbar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 9px 14px; border-bottom: 1px solid var(--line);
  background: rgba(7, 11, 20, 0.55); z-index: 6;
}
.cv-label { font-size: 11px; color: var(--sub); white-space: nowrap; }
.cv-select {
  background: rgba(148, 163, 184, 0.08); color: var(--ink);
  border: 1px solid var(--line); border-radius: 8px;
  padding: 6px 9px; font-family: inherit; font-size: 12px;
  max-width: 260px; outline: none;
}
.cv-select:focus { border-color: rgba(56, 189, 248, 0.5); }
.cv-select:disabled { opacity: .5; }
.cv-tabs { display: flex; gap: 2px; padding: 2px; background: rgba(148, 163, 184, 0.08); border-radius: 8px; }
.cv-tab {
  border: 0; background: transparent; color: var(--sub);
  padding: 4px 10px; border-radius: 6px; cursor: pointer;
  font-family: inherit; font-size: 11.5px; transition: all .15s ease;
}
.cv-tab:hover { color: var(--ink); }
.cv-tab.active { background: rgba(56, 189, 248, 0.17); color: #7dd3fc; box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.3); }
.cv-check { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--sub); cursor: pointer; white-space: nowrap; }
.cv-check input { accent-color: #38bdf8; }
.cv-spacer { flex: 1; }
.cv-search { position: relative; width: 232px; }
.cv-search input {
  width: 100%; padding: 7px 11px 7px 29px;
  border-radius: 8px; border: 1px solid var(--line);
  background: rgba(148, 163, 184, 0.06); color: var(--ink);
  font-family: inherit; font-size: 12px; outline: none;
}
.cv-search input:focus { border-color: rgba(56, 189, 248, 0.55); box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.1); }
.cv-search svg { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); opacity: .5; pointer-events: none; }
.cv-results {
  position: absolute; top: 36px; left: 0; right: 0; z-index: 30;
  background: rgba(9, 15, 27, 0.98); border: 1px solid var(--line);
  border-radius: 9px; display: none; overflow: hidden auto;
  max-height: 320px; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
}
.cv-results.show { display: block; }
.cv-result { padding: 7px 10px; cursor: pointer; border-bottom: 1px solid rgba(148, 163, 184, 0.08); }
.cv-result:hover { background: rgba(56, 189, 248, 0.1); }
.cv-result b { display: block; font-size: 11.5px; font-weight: 600; }
.cv-result span { font-size: 10px; color: var(--sub); }
.cv-result em { font-size: 10px; color: var(--sub); font-style: normal; }
.cv-btn {
  border: 1px solid var(--line); background: rgba(148, 163, 184, 0.06);
  color: var(--ink); border-radius: 8px; padding: 6px 11px;
  font-family: inherit; font-size: 11.5px; cursor: pointer;
  white-space: nowrap; transition: all .15s ease;
}
.cv-btn:hover { background: rgba(56, 189, 248, 0.12); border-color: rgba(56, 189, 248, 0.35); color: #bae6fd; }
.cv-btn:disabled { opacity: .35; cursor: default; }
.cv-status { font-size: 10.5px; color: #fbbf24; white-space: nowrap; }
.cv-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; }
.cv-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }
.cv-canvas.grabbing { cursor: grabbing; }
.cv-crumb {
  position: absolute; top: 12px; left: 14px; z-index: 4;
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  max-width: calc(100% - 400px);
  font-size: 11.5px; color: var(--sub);
  background: rgba(7, 11, 20, 0.62); padding: 6px 10px; border-radius: 9px;
  border: 1px solid rgba(148, 163, 184, 0.12);
}
.cv-crumb-item {
  border: 0; background: transparent; color: #93c5fd; cursor: pointer;
  font-family: inherit; font-size: 11.5px; padding: 0 1px;
  max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cv-crumb-item:hover { text-decoration: underline; }
.cv-crumb-item.current { color: var(--ink); font-weight: 600; cursor: default; text-decoration: none; }
.cv-crumb-sep { opacity: .45; font-size: 11px; }
.cv-hint {
  position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%);
  font-size: 11px; color: var(--sub); z-index: 3; pointer-events: none;
  background: rgba(7, 11, 20, 0.58); padding: 5px 12px; border-radius: 20px;
  border: 1px solid rgba(148, 163, 184, 0.1); white-space: nowrap;
  max-width: 92%; overflow: hidden; text-overflow: ellipsis;
}
.cv-tooltip {
  position: absolute; z-index: 9; pointer-events: none;
  background: rgba(9, 15, 27, 0.97); border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 9px; padding: 8px 11px; font-size: 12px; color: var(--ink);
  max-width: 330px; opacity: 0; transform: translateY(4px);
  transition: opacity .12s ease, transform .12s ease;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
}
.cv-tooltip.show { opacity: 1; transform: translateY(0); }
.cv-tooltip .tt-sub { color: var(--sub); font-size: 10.5px; margin-top: 3px; }
.cv-sig {
  font-family: Consolas, "Cascadia Code", "Courier New", monospace;
  font-size: 10.5px; color: #a5b4fc; background: rgba(99, 102, 241, 0.09);
  border-radius: 6px; padding: 6px 8px; margin: 0 0 10px; word-break: break-word;
}
.cv-actions { display: flex; gap: 6px; margin-top: 10px; }
.cv-actions .cv-btn { flex: 1; }
.cv-none { color: var(--sub); font-size: 11.5px; }
@media (max-width: 980px) {
  .cv-crumb { max-width: calc(100% - 30px); }
  .cv-hint { display: none; }
}
`;

  const CARD_W = 186;
  const CARD_H = 46;
  const MAX_NODES = 180;
  const COL_GAP = CARD_W + 64;
  const MAX_LIST = 40;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function num(v) {
    const n = Number(v);
    return isFinite(n) ? n : 0;
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

  function shortFile(path) {
    const p = String(path || "");
    if (!p) return "";
    const parts = p.split(/[\\/]/);
    return parts.length > 3 ? ".../" + parts.slice(-3).join("/") : p;
  }

  function prettyId(id) {
    const p = String(id || "");
    const i = p.indexOf(":");
    const tail = i >= 0 ? p.slice(i + 1) : p;
    return tail.length > 30 ? tail.slice(0, 28) + "…" : tail;
  }

  window.CodeViz.registerView("calls", function (ctx) {
    const data = (ctx && ctx.data) || {};
    const symbols = Array.isArray(data.symbols) ? data.symbols.filter(Boolean) : [];
    const rawCalls = Array.isArray(data.calls) ? data.calls : [];
    const entries = Array.isArray(data.entries) ? data.entries.filter(Boolean) : [];
    const files = Array.isArray(data.files) ? data.files.filter(Boolean) : [];
    const modules = Array.isArray(data.modules) ? data.modules.filter(Boolean) : [];
    const groups = (data.groups && typeof data.groups === "object") ? data.groups : {};
    const container = ctx.container;

    if (!container) return { activate() {}, deactivate() {} };

    if (!symbols.length && !rawCalls.length) {
      container.innerHTML = '<div class="view-empty">没有可用的调用数据（data.symbols / data.calls 为空）</div>';
      return { activate() {}, deactivate() {} };
    }

    const byId = new Map();
    for (const s of symbols) {
      if (s && s.id) byId.set(s.id, s);
    }
    const synthetic = new Set();
    const fileByPath = new Map();
    for (const f of files) {
      if (f && f.path) fileByPath.set(f.path, f);
    }
    const moduleGroup = new Map();
    for (const m of modules) {
      if (m && m.id) moduleGroup.set(m.id, m.group);
    }

    function resolve(id) {
      if (!id) return null;
      const known = byId.get(id);
      if (known) return known;
      const stub = {
        id: id,
        name: prettyId(id),
        qualified: prettyId(id),
        file: "",
        line: 0,
        kind: "",
      };
      byId.set(id, stub);
      synthetic.add(id);
      return stub;
    }

    function groupKey(sym) {
      if (!sym) return "";
      if (sym.group) return sym.group;
      const f = fileByPath.get(sym.file);
      if (f && f.group) return f.group;
      if (sym.module && moduleGroup.has(sym.module)) return moduleGroup.get(sym.module);
      return "";
    }

    function colorOf(sym) {
      const g = groupKey(sym);
      const meta = g ? groups[g] : null;
      return (meta && /^#[0-9a-f]{3,8}$/i.test(String(meta.color || ""))) ? meta.color : "#38bdf8";
    }

    function groupLabelOf(sym) {
      const g = groupKey(sym);
      if (g && groups[g] && groups[g].label) return groups[g].label;
      if (g) return g;
      if (sym && (sym.module || sym.file)) return "未分组";
      return "符号";
    }

    // ---------------- 调用边索引 ----------------
    const outMap = new Map();
    const inMap = new Map();
    const seen = new Set();
    const edges = [];
    for (const e of rawCalls) {
      if (!e || !e.source || !e.target) continue;
      const key = e.source + "\u0000" + e.target;
      if (seen.has(key)) continue;
      seen.add(key);
      outMap.set(e.source, outMap.get(e.source) || []);
      outMap.get(e.source).push(e.target);
      inMap.set(e.target, inMap.get(e.target) || []);
      inMap.get(e.target).push(e.source);
      edges.push({ source: e.source, target: e.target });
    }

    const outIds = id => outMap.get(id) || [];
    const inIds = id => inMap.get(id) || [];

    function knownId(id) {
      return !!id && (byId.has(id) || outMap.has(id) || inMap.has(id));
    }

    function defaultRoot() {
      // 默认根优先从 entries 里挑「当前 calls 子图中直接下游最多」的入口，
      // 避免真实构建首屏落在一个几乎没有下游的函数上；出度相同按 label 升序。
      let bestEntry = null;
      let bestOut = -1;
      for (const e of entries) {
        if (!e || !e.id || !knownId(e.id)) continue;
        const out = outIds(e.id).length;
        if (out > bestOut) {
          bestOut = out;
          bestEntry = e;
        } else if (out === bestOut && bestEntry) {
          const a = String(e.label || e.id);
          const b = String(bestEntry.label || bestEntry.id);
          if (a.localeCompare(b) < 0) bestEntry = e;
        }
      }
      if (bestEntry) return bestEntry.id;

      // 没有可用入口时退回：度数最大的符号。
      let best = null;
      let bestDeg = -1;
      for (const s of symbols) {
        if (!s || !s.id) continue;
        const deg = outIds(s.id).length + inIds(s.id).length;
        if (deg > bestDeg) { bestDeg = deg; best = s.id; }
      }
      if (best) return best;
      return symbols[0] ? symbols[0].id : (edges[0] ? edges[0].source : null);
    }

    // ---------------- DOM ----------------
    container.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = STYLE;
    container.appendChild(style);

    const wrap = document.createElement("div");
    wrap.className = "cv-calls";
    container.appendChild(wrap);

    const toolbar = document.createElement("div");
    toolbar.className = "cv-toolbar";

    const entryWrap = document.createElement("label");
    entryWrap.className = "cv-label";
    entryWrap.textContent = "入口 ";
    const entrySelect = document.createElement("select");
    entrySelect.className = "cv-select";
    entrySelect.title = "从 data.entries 选择调用链入口";
    entryWrap.appendChild(entrySelect);
    toolbar.appendChild(entryWrap);

    const depthWrap = document.createElement("div");
    depthWrap.className = "cv-label";
    depthWrap.textContent = "深度 ";
    const depthTabs = document.createElement("span");
    depthTabs.className = "cv-tabs";
    depthTabs.style.display = "inline-flex";
    depthTabs.style.marginLeft = "4px";
    const depthButtons = [];
    for (const d of [1, 2, 3]) {
      const b = document.createElement("button");
      b.className = "cv-tab";
      b.type = "button";
      b.dataset.depth = String(d);
      b.textContent = String(d);
      b.addEventListener("click", () => setDepth(d));
      depthTabs.appendChild(b);
      depthButtons.push(b);
    }
    depthWrap.appendChild(depthTabs);
    toolbar.appendChild(depthWrap);

    const upLabel = document.createElement("label");
    upLabel.className = "cv-check";
    const upCheck = document.createElement("input");
    upCheck.type = "checkbox";
    upLabel.appendChild(upCheck);
    upLabel.appendChild(document.createTextNode("含直接调用者"));
    upCheck.addEventListener("change", () => {
      state.up = upCheck.checked;
      buildGraph();
      layout();
      fitView();
      requestDraw();
      syncUrl();
    });
    toolbar.appendChild(upLabel);

    const spacer = document.createElement("div");
    spacer.className = "cv-spacer";
    toolbar.appendChild(spacer);

    const statusEl = document.createElement("span");
    statusEl.className = "cv-status";
    toolbar.appendChild(statusEl);

    const search = document.createElement("div");
    search.className = "cv-search";
    search.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>';
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "搜索函数 / 文件…";
    searchInput.setAttribute("aria-label", "搜索函数");
    search.appendChild(searchInput);
    const resultsEl = document.createElement("div");
    resultsEl.className = "cv-results";
    search.appendChild(resultsEl);
    toolbar.appendChild(search);

    const backBtn = document.createElement("button");
    backBtn.className = "cv-btn";
    backBtn.type = "button";
    backBtn.textContent = "返回";
    backBtn.disabled = true;
    backBtn.addEventListener("click", goBack);
    toolbar.appendChild(backBtn);

    const resetBtn = document.createElement("button");
    resetBtn.className = "cv-btn";
    resetBtn.type = "button";
    resetBtn.textContent = "重置视图";
    resetBtn.addEventListener("click", () => {
      if (!state.nodes.length) return;
      layout();
      fitView();
      requestDraw();
    });
    toolbar.appendChild(resetBtn);

    wrap.appendChild(toolbar);

    const stage = document.createElement("div");
    stage.className = "cv-stage";
    wrap.appendChild(stage);

    const canvas = document.createElement("canvas");
    canvas.className = "cv-canvas";
    stage.appendChild(canvas);

    const crumbEl = document.createElement("div");
    crumbEl.className = "cv-crumb";
    crumbEl.setAttribute("aria-label", "调用链面包屑");
    stage.appendChild(crumbEl);

    const hintEl = document.createElement("div");
    hintEl.className = "cv-hint";
    hintEl.textContent = "点击节点看详情 · 双击重设根 · 滚轮缩放 · 拖拽平移";
    stage.appendChild(hintEl);

    const tooltip = document.createElement("div");
    tooltip.className = "cv-tooltip";
    stage.appendChild(tooltip);

    const panel = document.createElement("aside");
    panel.className = "view-panel";
    panel.style.top = "12px";
    panel.style.right = "12px";
    panel.style.bottom = "12px";
    const panelHead = document.createElement("div");
    panelHead.className = "view-panel-head";
    const panelTitle = document.createElement("h2");
    panelTitle.textContent = "调用链";
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
      rootId: null,
      depth: 2,
      up: false,
      nodes: [],
      edges: [],
      nodeById: new Map(),
      levelOf: new Map(),
      history: [],
      hover: null,
      selected: null,
      t: { x: 0, y: 0, k: 1 },
      drag: null,
      w: 0,
      h: 0,
      dpr: 1,
      truncated: false,
      visible: false,
      fitted: false,
      pendingInternal: false,
    };

    function viewportW() {
      return Math.max(120, state.w - (state.w > 900 ? 366 : 0));
    }

    // ---------------- 图构建 ----------------
    function buildGraph() {
      const root = state.rootId;
      state.truncated = false;
      if (!root) {
        state.nodes = [];
        state.edges = [];
        state.nodeById = new Map();
        state.levelOf = new Map();
        return;
      }
      const levels = new Map([[root, 0]]);
      const order = [root];
      let truncated = false;
      let cursor = 0;
      while (cursor < order.length) {
        const id = order[cursor++];
        const lv = levels.get(id) || 0;
        if (lv >= state.depth) continue;
        const outs = outIds(id);
        for (const t of outs) {
          if (levels.has(t) || t === root) continue;
          if (order.length >= MAX_NODES) { truncated = true; break; }
          levels.set(t, lv + 1);
          order.push(t);
        }
        if (truncated) break;
      }
      if (state.up) {
        for (const s of inIds(root)) {
          if (levels.has(s)) continue;
          if (order.length >= MAX_NODES) { truncated = true; break; }
          levels.set(s, -1);
          order.push(s);
        }
      }
      state.truncated = truncated;

      const idSet = new Set(order);
      const nodes = order.map(id => {
        const sym = resolve(id) || {};
        const outDeg = outIds(id).filter(t => idSet.has(t)).length;
        const inDeg = inIds(id).filter(s => idSet.has(s)).length;
        return {
          id: id,
          level: levels.get(id) || 0,
          label: sym.name || sym.qualified || prettyId(id),
          qualified: sym.qualified || "",
          signature: sym.signature || "",
          doc: sym.doc || "",
          file: sym.file || "",
          line: num(sym.line),
          lines: num(sym.lines),
          branches: num(sym.branches),
          excepts: num(sym.excepts),
          color: colorOf(sym),
          groupLabel: groupLabelOf(sym),
          out: outDeg,
          inc: inDeg,
          x: 0,
          y: 0,
        };
      });
      state.nodes = nodes;
      state.nodeById = new Map(nodes.map(n => [n.id, n]));
      state.levelOf = new Map(nodes.map(n => [n.id, n.level]));
      state.edges = edges.filter(e => idSet.has(e.source) && idSet.has(e.target));
      state.hover = null;
      state.fitted = false;
      statusEl.textContent = truncated ? "已截断：最多 " + MAX_NODES + " 个节点" : "";
      hintEl.textContent = state.edges.length
        ? "点击节点看详情 · 双击重设根 · 滚轮缩放 · 拖拽平移"
        : "该函数在当前深度内没有可显示的调用关系";
    }

    function layout() {
      const nodes = state.nodes;
      if (!nodes.length) return;
      const byLevel = new Map();
      for (const n of nodes) {
        if (!byLevel.has(n.level)) byLevel.set(n.level, []);
        byLevel.get(n.level).push(n);
      }
      const levels = [...byLevel.keys()].sort((a, b) => a - b);
      const minLevel = levels[0];
      const available = Math.max(260, (state.h || 600) * 0.84);

      for (const lv of levels) {
        const list = byLevel.get(lv);
        const count = list.length;
        const gap = count <= 1 ? 0 : clamp(available / (count - 1), 62, 118);

        // 用上一层邻居的平均 y 做重心排序，减少连线交叉。
        for (const n of list) {
          let sum = 0;
          let cnt = 0;
          for (const src of inIds(n.id)) {
            const other = state.nodeById.get(src);
            if (other && other.level < lv) { sum += other.y; cnt++; }
          }
          if (!cnt) {
            for (const dst of outIds(n.id)) {
              const other = state.nodeById.get(dst);
              if (other && other.level < lv) { sum += other.y; cnt++; }
            }
          }
          n._bary = cnt ? sum / cnt : 0;
        }
        list.sort((a, b) => (a._bary - b._bary) || (b.out + b.inc - a.out - a.inc) || String(a.label).localeCompare(String(b.label)));
        const startY = -((count - 1) * gap) / 2;
        list.forEach((n, i) => {
          n.x = (lv - minLevel) * COL_GAP;
          n.y = startY + i * gap;
        });
      }
    }

    function fitView() {
      if (!state.nodes.length || !state.w || !state.h) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of state.nodes) {
        minX = Math.min(minX, n.x - CARD_W / 2);
        maxX = Math.max(maxX, n.x + CARD_W / 2);
        minY = Math.min(minY, n.y - CARD_H / 2);
        maxY = Math.max(maxY, n.y + CARD_H / 2);
      }
      const vw = viewportW();
      const padX = 34;
      const padTop = 56;
      const padBottom = 40;
      const availW = Math.max(80, vw - padX * 2);
      const availH = Math.max(80, state.h - padTop - padBottom);
      const bw = Math.max(1, maxX - minX);
      const bh = Math.max(1, maxY - minY);
      const k = clamp(Math.min(availW / bw, availH / bh), 0.18, 1.15);
      state.t.k = k;
      state.t.x = padX + (availW - bw * k) / 2 - minX * k;
      state.t.y = padTop + (availH - bh * k) / 2 - minY * k;
      state.fitted = true;
    }

    function toWorld(sx, sy) {
      return { x: (sx - state.t.x) / state.t.k, y: (sy - state.t.y) / state.t.k };
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

      drawGrid(c);

      if (!state.nodes.length) {
        c.fillStyle = "rgba(139,156,182,0.85)";
        c.font = '12px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("没有可显示的调用关系", viewportW() / 2, state.h / 2);
        return;
      }

      const focus = state.hover || state.selected;
      const focusSet = focus ? connectedSet(focus.id) : null;

      c.save();
      c.translate(state.t.x, state.t.y);
      c.scale(state.t.k, state.t.k);
      drawEdges(c, focusSet, focus);
      drawNodes(c, focusSet, focus);
      c.restore();

      drawHeaders(c);
    }

    function drawGrid(c) {
      const gap = 44 * state.t.k;
      if (gap < 14) return;
      const ox = ((state.t.x % gap) + gap) % gap;
      const oy = ((state.t.y % gap) + gap) % gap;
      c.fillStyle = "rgba(148,163,184,0.08)";
      for (let x = ox; x < state.w; x += gap) {
        for (let y = oy; y < state.h; y += gap) {
          c.beginPath();
          c.arc(x, y, 1, 0, Math.PI * 2);
          c.fill();
        }
      }
    }

    function connectedSet(id) {
      const set = new Set([id]);
      for (const e of state.edges) {
        if (e.source === id) set.add(e.target);
        if (e.target === id) set.add(e.source);
      }
      return set;
    }

    function drawHeaders(c) {
      c.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      const levels = [...new Set(state.nodes.map(n => n.level))].sort((a, b) => a - b);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = '600 11px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
      for (const lv of levels) {
        const list = state.nodes.filter(n => n.level === lv);
        if (!list.length) continue;
        const x = list[0].x;
        let top = Infinity;
        for (const n of list) top = Math.min(top, n.y - CARD_H / 2);
        const sx = state.t.x + x * state.t.k;
        const sy = state.t.y + (top - 20) * state.t.k;
        if (sx < 46 || sx > viewportW() - 46 || sy < 24) continue;
        const label = lv < 0 ? "调用者" : lv === 0 ? "根函数" : "第 " + lv + " 层";
        c.fillStyle = "rgba(147,197,253,0.62)";
        c.fillText(label + " · " + list.length, sx, sy);
        c.strokeStyle = "rgba(147,197,253,0.14)";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(sx - 36, sy + 9);
        c.lineTo(sx + 36, sy + 9);
        c.stroke();
      }
    }

    function drawEdges(c, focusSet, focus) {
      for (const e of state.edges) {
        const a = state.nodeById.get(e.source);
        const b = state.nodeById.get(e.target);
        if (!a || !b) continue;
        const active = focusSet ? (focusSet.has(a.id) && focusSet.has(b.id) && (focus.id === a.id || focus.id === b.id)) : false;
        const dim = focusSet && !active;
        const col = a.color;
        c.globalAlpha = dim ? 0.12 : (active ? 0.95 : 0.4);
        c.strokeStyle = active ? rgba(col, 0.95) : rgba(col, 0.68);
        c.lineWidth = active ? 2.1 : 1.2;
        if (active) {
          c.shadowColor = rgba(col, 0.75);
          c.shadowBlur = 7;
        }
        let x1;
        let y1;
        let x2;
        let y2;
        let mx;
        const dx = b.x - a.x;
        if (Math.abs(dx) < 8) {
          const dir = b.y >= a.y ? 1 : -1;
          x1 = a.x;
          y1 = a.y + dir * CARD_H / 2;
          x2 = b.x;
          y2 = b.y - dir * CARD_H / 2;
          c.beginPath();
          c.moveTo(x1, y1);
          c.bezierCurveTo(x1 + 52, y1 + dir * 26, x2 + 52, y2 - dir * 26, x2, y2);
          c.stroke();
          c.shadowBlur = 0;
          drawArrow(c, x2, y2, Math.PI / 2 * dir, col, active);
          continue;
        }
        const rightward = dx > 0;
        x1 = a.x + (rightward ? CARD_W / 2 : -CARD_W / 2);
        y1 = a.y;
        x2 = b.x + (rightward ? -CARD_W / 2 : CARD_W / 2);
        y2 = b.y;
        mx = (x1 + x2) / 2;
        c.beginPath();
        c.moveTo(x1, y1);
        c.bezierCurveTo(mx, y1, mx, y2, x2, y2);
        c.stroke();
        c.shadowBlur = 0;
        const ang = Math.atan2(y2 - y1, x2 - mx) || 0;
        drawArrow(c, x2, y2, ang, col, active);
      }
      c.globalAlpha = 1;
    }

    function drawArrow(c, x, y, ang, col, active) {
      const size = 7.5;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x - Math.cos(ang - 0.42) * size, y - Math.sin(ang - 0.42) * size);
      c.lineTo(x - Math.cos(ang + 0.42) * size, y - Math.sin(ang + 0.42) * size);
      c.closePath();
      c.fillStyle = rgba(col, active ? 1 : 0.7);
      c.fill();
    }

    function ellipsize(c, text, maxW) {
      const str = String(text == null ? "" : text);
      if (c.measureText(str).width <= maxW) return str;
      let t = str;
      while (t.length > 1 && c.measureText(t + "…").width > maxW) t = t.slice(0, -1);
      return t + "…";
    }

    function drawNodes(c, focusSet, focus) {
      for (const n of state.nodes) {
        const isFocus = focus && focus.id === n.id;
        const dim = focusSet && !focusSet.has(n.id);
        c.globalAlpha = dim ? 0.22 : 1;
        drawNode(c, n, isFocus);
      }
      c.globalAlpha = 1;
    }

    function drawNode(c, n, active) {
      const x = n.x - CARD_W / 2;
      const y = n.y - CARD_H / 2;
      const col = n.color;
      c.save();

      roundRect(c, x, y, CARD_W, CARD_H, 9);
      c.fillStyle = active ? rgba(col, 0.32) : rgba(col, 0.13);
      c.shadowColor = rgba(col, active ? 0.55 : 0.22);
      c.shadowBlur = active ? 20 : 10;
      c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = active ? rgba(col, 0.95) : rgba(col, 0.42);
      c.lineWidth = active ? 1.9 : 1;
      c.stroke();

      roundRect(c, x + 1, y + 9, 3, CARD_H - 18, 1.5);
      c.fillStyle = rgba(col, 0.95);
      c.fill();

      c.textAlign = "left";
      c.textBaseline = "middle";
      c.font = '600 12px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
      c.fillStyle = active ? "#f2f8ff" : "#dbe6f5";
      c.fillText(ellipsize(c, n.label, CARD_W - 26), x + 12, y + 16);

      c.font = '10px Consolas, "Microsoft YaHei", system-ui, sans-serif';
      c.fillStyle = "rgba(139,156,182,0.95)";
      const sub = n.file ? shortFile(n.file) + (n.line ? ":" + n.line : "") : (n.groupLabel || "");
      c.fillText(ellipsize(c, sub, CARD_W - 24), x + 12, y + 32);

      if (n.id === state.rootId) {
        roundRect(c, x - 4, y - 4, CARD_W + 8, CARD_H + 8, 12);
        c.setLineDash([5, 4]);
        c.strokeStyle = rgba(col, 0.72);
        c.lineWidth = 1.2;
        c.stroke();
        c.setLineDash([]);
      }
      c.restore();
    }

    // ---------------- 命中测试 / 交互 ----------------
    function hitTest(sx, sy) {
      if (!state.nodes.length) return null;
      const p = toWorld(sx, sy);
      for (let i = state.nodes.length - 1; i >= 0; i--) {
        const n = state.nodes[i];
        if (Math.abs(p.x - n.x) <= CARD_W / 2 + 4 && Math.abs(p.y - n.y) <= CARD_H / 2 + 4) return n;
      }
      return null;
    }

    function localPoint(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function showTooltip(node, sx, sy) {
      if (!node) {
        tooltip.classList.remove("show");
        tooltip.dataset.id = "";
        return;
      }
      if (tooltip.dataset.id !== node.id) {
        tooltip.dataset.id = node.id;
        tooltip.innerHTML =
          "<b>" + esc(node.label) + "</b>" +
          '<div class="tt-sub">' + esc(node.file ? shortFile(node.file) + ":" + node.line : "（无文件信息）") + "</div>" +
          '<div class="tt-sub">' + esc(node.groupLabel) + " · 出 " + node.out + " · 入 " + node.inc + "</div>";
        tooltip.style.borderColor = rgba(node.color, 0.55);
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

    function onPointerDown(e) {
      if (e.button !== 0) return;
      const p = localPoint(e);
      const node = hitTest(p.x, p.y);
      state.drag = {
        node: node,
        sx: p.x,
        sy: p.y,
        ox: state.t.x,
        oy: state.t.y,
        moved: false,
        id: e.pointerId,
      };
      canvas.classList.add("grabbing");
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }

    function onPointerMove(e) {
      const p = localPoint(e);
      const drag = state.drag;
      if (drag) {
        if (Math.abs(p.x - drag.sx) + Math.abs(p.y - drag.sy) > 3) drag.moved = true;
        if (drag.moved) {
          state.t.x = drag.ox + (p.x - drag.sx);
          state.t.y = drag.oy + (p.y - drag.sy);
          tooltip.classList.remove("show");
          requestDraw();
        }
        return;
      }
      const node = hitTest(p.x, p.y);
      if (node !== state.hover) {
        state.hover = node;
        canvas.style.cursor = node ? "pointer" : "grab";
        requestDraw();
      }
      showTooltip(node, p.x, p.y);
    }

    function onPointerUp() {
      const drag = state.drag;
      state.drag = null;
      canvas.classList.remove("grabbing");
      if (!drag) return;
      if (!drag.moved && drag.node) selectNode(drag.node, true);
    }

    function onPointerLeave() {
      if (state.drag) return;
      state.hover = null;
      tooltip.classList.remove("show");
      requestDraw();
    }

    function onWheel(e) {
      e.preventDefault();
      const p = localPoint(e);
      const before = toWorld(p.x, p.y);
      state.t.k = clamp(state.t.k * Math.exp(-e.deltaY * 0.0014), 0.15, 3.2);
      const after = toWorld(p.x, p.y);
      state.t.x += (after.x - before.x) * state.t.k;
      state.t.y += (after.y - before.y) * state.t.k;
      requestDraw();
    }

    function onDblClick(e) {
      const p = localPoint(e);
      const node = hitTest(p.x, p.y);
      if (node) {
        setRoot(node.id);
      } else {
        layout();
        fitView();
        requestDraw();
      }
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDblClick);

    // ---------------- 根节点 / 历史 / URL ----------------
    function qs() {
      if (!state.rootId) return "";
      let s = "root=" + encodeURIComponent(state.rootId) + "&depth=" + state.depth;
      if (state.up) s += "&up=1";
      return s;
    }

    function syncUrl() {
      if (!state.rootId) return;
      const next = qs();
      if (typeof ctx.router === "object" && ctx.router && typeof ctx.router.go === "function") {
        ctx.router.go("calls", next);
      } else {
        location.hash = "#calls?" + next;
      }
    }

    function setRoot(id, opts) {
      const options = opts || {};
      if (!id) return;
      const sym = resolve(id);
      if (!sym) return;
      if (state.rootId && state.rootId !== id && options.push !== false) {
        state.history.push(state.rootId);
        if (state.history.length > 20) state.history.shift();
      }
      state.rootId = id;
      state.selected = null;
      buildGraph();
      layout();
      fitView();
      updateCrumb();
      syncEntrySelect();
      updateBack();
      const rootNode = state.nodeById.get(id);
      if (rootNode) showDetails(rootNode, false);
      requestDraw();
      if (options.syncUrl !== false) {
        state.pendingInternal = true;
        syncUrl();
      }
    }

    function goBack() {
      if (!state.history.length) return;
      const prev = state.history.pop();
      state.rootId = prev;
      state.selected = null;
      buildGraph();
      layout();
      fitView();
      updateCrumb();
      syncEntrySelect();
      updateBack();
      const rootNode = state.nodeById.get(prev);
      if (rootNode) showDetails(rootNode, false);
      requestDraw();
      state.pendingInternal = true;
      syncUrl();
    }

    function updateBack() {
      backBtn.disabled = state.history.length === 0;
    }

    function updateCrumb() {
      const ids = state.history.concat(state.rootId ? [state.rootId] : []);
      const shown = ids.slice(-5);
      const trimmed = ids.length > 5;
      crumbEl.innerHTML = "";
      if (trimmed) {
        const dots = document.createElement("span");
        dots.className = "cv-crumb-sep";
        dots.textContent = "…";
        crumbEl.appendChild(dots);
      }
      shown.forEach((id, i) => {
        const index = ids.length - shown.length + i;
        if (i > 0) {
          const sep = document.createElement("span");
          sep.className = "cv-crumb-sep";
          sep.textContent = "›";
          crumbEl.appendChild(sep);
        }
        const node = state.nodeById.get(id) || resolve(id);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cv-crumb-item" + (id === state.rootId ? " current" : "");
        const label = node ? (node.label || node.name || node.qualified || "") : "";
        btn.textContent = label || prettyId(id);
        btn.title = node && node.file ? node.file + (node.line ? ":" + node.line : "") : prettyId(id);
        if (id !== state.rootId) {
          btn.addEventListener("click", () => {
            state.history = state.history.slice(0, index);
            state.rootId = id;
            state.selected = null;
            buildGraph();
            layout();
            fitView();
            updateCrumb();
            syncEntrySelect();
            updateBack();
            const node2 = state.nodeById.get(id);
            if (node2) showDetails(node2, false);
            requestDraw();
            state.pendingInternal = true;
            syncUrl();
          });
        }
        crumbEl.appendChild(btn);
      });
    }

    function setDepth(d) {
      if (![1, 2, 3].includes(d) || d === state.depth) return;
      state.depth = d;
      updateDepthTabs();
      if (state.rootId) {
        buildGraph();
        layout();
        fitView();
        requestDraw();
      }
      syncUrl();
    }

    function updateDepthTabs() {
      for (const b of depthButtons) b.classList.toggle("active", Number(b.dataset.depth) === state.depth);
    }

    function syncEntrySelect() {
      let index = -1;
      for (let i = 0; i < entries.length; i++) {
        if (entries[i] && entries[i].id === state.rootId) { index = i; break; }
      }
      entrySelect.value = index >= 0 ? String(index) : "";
    }

    function renderEntries() {
      entrySelect.innerHTML = "";
      if (!entries.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "（无入口数据）";
        entrySelect.appendChild(opt);
        entrySelect.disabled = true;
        return;
      }
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "— 选择入口 —";
      entrySelect.appendChild(empty);
      entries.forEach((e, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        const label = e.label || e.id;
        opt.textContent = String(label).length > 46 ? String(label).slice(0, 44) + "…" : label;
        entrySelect.appendChild(opt);
      });
      entrySelect.addEventListener("change", () => {
        if (entrySelect.value === "") return;
        const item = entries[Number(entrySelect.value)];
        if (item && item.id) setRoot(item.id);
      });
    }

    // ---------------- 右侧详情面板 ----------------
    function selectNode(node, openSource) {
      if (!node) return;
      state.selected = node;
      requestDraw();
      showDetails(node, openSource);
    }

    function uniqueResolved(ids) {
      const seenIds = new Set();
      const out = [];
      for (const id of ids) {
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        const sym = resolve(id);
        if (sym) out.push(sym);
      }
      return out;
    }

    function chipHtml(sym) {
      const outDeg = new Set(outIds(sym.id)).size;
      const inDeg = new Set(inIds(sym.id)).size;
      const label = sym.name || sym.qualified || prettyId(sym.id);
      return '<div class="chip" data-id="' + esc(sym.id) + '"><span>' + esc(label) + "</span><span>" + outDeg + "/" + inDeg + "</span></div>";
    }

    function showDetails(node, openSource) {
      if (!node) return;
      const isSynthetic = synthetic.has(node.id);
      panelTitle.textContent = node.label;
      panelBadge.innerHTML = '<i style="background:' + node.color + ";color:" + node.color + '"></i><span>' + esc(node.groupLabel) + "</span>";

      const outs = uniqueResolved(outIds(node.id));
      const ins = uniqueResolved(inIds(node.id));
      const outList = outs.slice(0, MAX_LIST);
      const inList = ins.slice(0, MAX_LIST);

      const parts = [];
      parts.push('<p class="pathline">' + (node.file ? esc(shortFile(node.file)) + ":" + node.line : "（无文件信息）") + "</p>");
      if (node.signature) parts.push('<div class="cv-sig">' + esc(node.signature) + "</div>");
      if (node.doc) parts.push('<p class="desc">' + esc(node.doc) + "</p>");
      parts.push('<div class="section"><h3>规模</h3><div class="metrics">' +
        '<div class="metric"><b>' + node.out + "</b><span>调用</span></div>" +
        '<div class="metric"><b>' + node.inc + "</b><span>被调用</span></div>" +
        '<div class="metric"><b>' + (node.lines || "—") + "</b><span>行数</span></div>" +
        "</div></div>");
      parts.push('<div class="section"><h3>复杂度</h3><div class="metrics">' +
        '<div class="metric"><b>' + (node.branches || 0) + "</b><span>分支</span></div>" +
        '<div class="metric"><b>' + (node.excepts || 0) + "</b><span>except</span></div>" +
        '<div class="metric"><b>' + (state.levelOf.get(node.id) == null ? "—" : state.levelOf.get(node.id)) + "</b><span>层级</span></div>" +
        "</div></div>");
      parts.push('<div class="section"><h3>调用了（' + outs.length + "）</h3><div class=\"chips\">" +
        (outList.length ? outList.map(chipHtml).join("") : '<span class="cv-none">无</span>') +
        (outs.length > MAX_LIST ? '<span class="cv-none">仅显示前 ' + MAX_LIST + " 个</span>" : "") +
        "</div></div>");
      parts.push('<div class="section"><h3>被调用（' + ins.length + "）</h3><div class=\"chips\">" +
        (inList.length ? inList.map(chipHtml).join("") : '<span class="cv-none">无</span>') +
        (ins.length > MAX_LIST ? '<span class="cv-none">仅显示前 ' + MAX_LIST + " 个</span>" : "") +
        "</div></div>");
      parts.push('<div class="cv-actions"><button type="button" class="cv-btn" data-act="focus">以此函数为中心</button>' +
        (isSynthetic ? "" : '<button type="button" class="cv-btn" data-act="src">打开源码</button>') +
        "</div>");
      panelBody.innerHTML = parts.join("");

      panelBody.querySelectorAll(".chip[data-id]").forEach(el => {
        el.addEventListener("click", () => setRoot(el.dataset.id));
      });
      const focusBtn = panelBody.querySelector('[data-act="focus"]');
      if (focusBtn) focusBtn.addEventListener("click", () => setRoot(node.id));
      const srcBtn = panelBody.querySelector('[data-act="src"]');
      if (srcBtn) {
        srcBtn.addEventListener("click", () => {
          if (ctx.source && typeof ctx.source.show === "function") ctx.source.show(node.id);
          else if (window.CodeViz && window.CodeViz.toast) window.CodeViz.toast("源码面板不可用");
        });
      }

      if (openSource && !isSynthetic && ctx.source && typeof ctx.source.show === "function") {
        ctx.source.show(node.id);
      }
    }

    // ---------------- 搜索 ----------------
    function closeResults() {
      resultsEl.classList.remove("show");
      resultsEl.innerHTML = "";
    }

    function runSearch() {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) {
        closeResults();
        return;
      }
      const matches = [];
      for (const s of symbols) {
        if (!s || !s.id) continue;
        const hay = (s.name || "") + " " + (s.qualified || "") + " " + (s.file || "");
        if (hay.toLowerCase().indexOf(q) >= 0) {
          matches.push(s);
          if (matches.length >= 12) break;
        }
      }
      resultsEl.innerHTML = "";
      if (!matches.length) {
        const row = document.createElement("div");
        row.className = "cv-result";
        row.innerHTML = '<em>没有匹配的函数</em>';
        resultsEl.appendChild(row);
        resultsEl.classList.add("show");
        return;
      }
      for (const s of matches) {
        const row = document.createElement("div");
        row.className = "cv-result";
        row.dataset.id = s.id;
        row.innerHTML = "<b>" + esc(s.name || s.qualified || s.id) + "</b><span>" +
          esc(s.file ? shortFile(s.file) + ":" + num(s.line) : "（无文件信息）") + "</span>";
        row.addEventListener("click", () => {
          searchInput.value = "";
          closeResults();
          setRoot(s.id);
        });
        resultsEl.appendChild(row);
      }
      resultsEl.classList.add("show");
    }

    searchInput.addEventListener("input", runSearch);
    searchInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        const first = resultsEl.querySelector(".cv-result[data-id]");
        if (first) first.click();
      } else if (e.key === "Escape") {
        searchInput.value = "";
        closeResults();
      }
    });
    document.addEventListener("pointerdown", e => {
      if (!state.visible) return;
      if (!search.contains(e.target)) closeResults();
    });

    // ---------------- 尺寸 / 生命周期 ----------------
    function measure() {
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      const changed = w !== state.w || h !== state.h;
      state.w = w;
      state.h = h;
      state.dpr = Math.max(1, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * state.dpr) || canvas.height !== Math.round(h * state.dpr)) {
        canvas.width = Math.round(w * state.dpr);
        canvas.height = Math.round(h * state.dpr);
      }
      return changed;
    }

    function handleResize() {
      if (!state.visible) return;
      measure();
      if (state.nodes.length) {
        layout();
        fitView();
      }
      requestDraw();
    }

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => handleResize());
      ro.observe(canvas);
    } else {
      window.addEventListener("resize", handleResize);
    }

    function activate(params) {
      state.visible = true;
      const p = params && typeof params.get === "function" ? params : new URLSearchParams();
      const depthParam = Number(p.get("depth"));
      const nextDepth = depthParam === 1 || depthParam === 2 || depthParam === 3 ? depthParam : 2;
      const upParam = p.get("up") === "1" || p.get("up") === "true";
      let dirty = false;
      if (nextDepth !== state.depth) { state.depth = nextDepth; dirty = true; }
      if (upParam !== state.up) { state.up = upParam; dirty = true; }
      updateDepthTabs();
      upCheck.checked = state.up;

      const requested = p.get("root");
      let nextRoot = requested && knownId(requested) ? requested : null;
      if (!nextRoot) nextRoot = state.rootId || defaultRoot();
      if (requested && !knownId(requested) && window.CodeViz && window.CodeViz.toast) {
        window.CodeViz.toast("未找到函数：" + requested);
      }

      const rootChanged = nextRoot !== state.rootId;
      if (rootChanged) {
        // 外部跳转（浏览器前进/后退、手改 URL）不并入本次会话下钻历史；
        // 视图内部的重设根由 setRoot 自行维护 history。
        if (!state.pendingInternal && state.rootId) state.history = [];
        state.rootId = nextRoot;
        state.selected = null;
        dirty = true;
      }
      state.pendingInternal = false;
      if (dirty || !state.nodes.length) {
        buildGraph();
      }
      measure();
      layout();
      fitView();
      updateCrumb();
      syncEntrySelect();
      updateBack();
      const rootNode = state.nodeById.get(state.rootId);
      if (rootNode) showDetails(rootNode, false);
      closeResults();
      requestDraw();
      // 首次进入时布局尺寸可能还没稳定，下一帧再贴合一次。
      requestAnimationFrame(() => {
        if (!state.visible) return;
        measure();
        layout();
        fitView();
        requestDraw();
      });
    }

    function deactivate() {
      state.visible = false;
      state.drag = null;
      state.hover = null;
      tooltip.classList.remove("show");
      closeResults();
    }

    renderEntries();
    updateDepthTabs();

    return { activate, deactivate };
  });
})();
