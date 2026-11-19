(function () {
  "use strict";

  // 系统依赖视图：模块级 / 文件级 + 3D 透视 / 2D 平面。
  // 数据只来自 ctx.data（codeviz/v1）：modules / moduleEdges / files / fileEdges / groups。
  // 只用 Canvas 2D 绘制，不依赖任何外部库；所有 DOM 都放在 ctx.container 内。

  const TAU = Math.PI * 2;
  const CV = window.CV;
  const TH = window.CVTheme;
  const FONT = CV.FONT;
  const MONO = CV.MONO;
  const clamp = CV.clamp;
  const toNum = CV.toNum;
  // 只接受合法十六进制色值，避免把数据里的字符串直接拼进 style / canvas
  const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const MAX_LAYERS = 7;

  function overlapRect(a, b) {
    return a.x < b.x + b.w + 4 && a.x + a.w + 4 > b.x &&
      a.y < b.y + b.h + 4 && a.y + a.h + 4 > b.y;
  }

  const STYLE = `
.dv-root { position: absolute; inset: 0; color: var(--ink, #24302c); }
.dv-canvas {
  position: absolute; inset: 0; display: block; width: 100%; height: 100%;
  cursor: grab; touch-action: none; z-index: 1; outline: none;
}
.dv-canvas:focus-visible {
  outline: 2px solid var(--accent, #2f7a68);
  outline-offset: -3px; border-radius: 6px;
}
.dv-canvas.dv-grabbing { cursor: grabbing; }

.dv-hud {
  position: absolute; left: 14px; top: 14px; z-index: 6;
  display: flex; flex-direction: column; gap: 8px; align-items: flex-start;
  max-width: calc(100% - 400px); pointer-events: none;
}
.dv-hud > * { pointer-events: auto; }
.dv-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.dv-crumbs {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 11px; border-radius: 10px; max-width: 100%;
  background: var(--panel, #ffffff); border: 1px solid var(--line, rgba(36,48,44,0.12));
  backdrop-filter: blur(10px); box-shadow: 0 8px 24px var(--shadow, rgba(31,42,38,0.14));
  font-size: 12px; color: var(--sub, #5f6f69); white-space: nowrap;
}
.dv-crumbs button {
  border: 0; background: none; color: var(--accent, #2f7a68); font: inherit;
  cursor: pointer; padding: 0; max-width: 260px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dv-crumbs button:hover { text-decoration: underline; }
.dv-crumbs .dv-sep { opacity: .45; }
.dv-crumbs .dv-cur {
  color: var(--ink, #24302c); max-width: 260px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}

.dv-seg {
  display: flex; gap: 2px; padding: 3px; border-radius: 10px;
  background: var(--panel, #ffffff); border: 1px solid var(--line, rgba(36,48,44,0.12));
  backdrop-filter: blur(10px);
}
.dv-seg button {
  border: 0; background: transparent; color: var(--sub, #5f6f69);
  font: inherit; font-size: 12px; padding: 5px 10px;
  border-radius: 7px; cursor: pointer; transition: background .15s ease, color .15s ease;
}
.dv-seg button:hover { color: var(--ink, #24302c); background: var(--accent-soft, rgba(47,122,104,0.12)); }
.dv-seg button.active {
  background: var(--accent-soft, rgba(47,122,104,0.12)); color: var(--accent, #2f7a68);
  box-shadow: inset 0 0 0 1px rgba(47, 122, 104, .28);
}

.dv-search {
  display: flex; align-items: center; gap: 6px; height: 32px;
  padding: 0 10px; border-radius: 10px;
  background: var(--panel, #ffffff); border: 1px solid var(--line, rgba(36,48,44,0.12));
  backdrop-filter: blur(10px); transition: border-color .15s ease, box-shadow .15s ease;
}
.dv-search:focus-within {
  border-color: var(--accent, #2f7a68);
  box-shadow: 0 0 0 3px var(--accent-soft, rgba(47,122,104,0.12));
}
.dv-search input {
  width: 178px; border: 0; outline: 0; background: transparent;
  color: var(--ink, #24302c); font: inherit; font-size: 12px;
}
.dv-search input::placeholder { color: var(--sub, #5f6f69); opacity: .72; }

.dv-btn {
  border: 1px solid var(--line, rgba(36,48,44,0.12)); background: var(--panel, #ffffff);
  color: var(--ink, #24302c); font: inherit; font-size: 12px;
  padding: 7px 11px; border-radius: 9px; cursor: pointer;
  backdrop-filter: blur(10px); transition: background .15s ease, color .15s ease, border-color .15s ease;
  white-space: nowrap;
}
.dv-btn:hover {
  color: var(--accent, #2f7a68); border-color: rgba(47, 122, 104, .35);
  background: var(--accent-soft, rgba(47,122,104,0.12));
}

.dv-legend {
  position: absolute; left: 14px; bottom: 14px; z-index: 5;
  display: flex; flex-wrap: wrap; gap: 4px 11px; max-width: 330px;
  padding: 8px 11px; border-radius: 10px;
  background: var(--panel, #ffffff); border: 1px solid var(--line, rgba(36,48,44,0.12));
  backdrop-filter: blur(10px); font-size: 11.5px; color: var(--sub, #5f6f69);
}
.dv-legend .dv-li { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
.dv-legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
.dv-legend .dv-count { color: var(--sub, #5f6f69); opacity: .8; }

.dv-hint {
  position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
  z-index: 4; max-width: 90%; overflow: hidden; text-overflow: ellipsis;
  font-size: 11.5px; color: var(--sub, #5f6f69); white-space: nowrap; pointer-events: none;
  background: var(--panel, #ffffff); border: 1px solid var(--line, rgba(36,48,44,0.12));
  padding: 5px 12px; border-radius: 20px;
  box-shadow: 0 6px 18px var(--shadow, rgba(31,42,38,0.14));
}

.dv-empty {
  position: absolute; inset: 0; z-index: 3; display: none;
  align-items: center; justify-content: center; flex-direction: column; gap: 6px;
  padding: 0 24px; text-align: center; pointer-events: none;
  color: var(--sub, #5f6f69); font-size: 13px;
}
.dv-empty.show { display: flex; }
.dv-empty-sub { font-size: 11.5px; opacity: .72; }

.dv-tip {
  position: absolute; z-index: 12; pointer-events: none;
  background: ${TH.tipBg}; border: 1px solid ${TH.line};
  border-radius: 9px; padding: 8px 11px; max-width: 300px;
  font-size: 12px; color: ${TH.ink}; opacity: 0; transform: translateY(4px);
  transition: opacity .12s ease, transform .12s ease;
  box-shadow: 0 12px 30px ${TH.shadow};
}
.dv-tip.show { opacity: 1; transform: translateY(0); }
.dv-tip b { font-size: 12.5px; }
.dv-tip .sub { color: ${TH.sub}; font-size: 11.5px; margin-top: 3px; }

.dv-list { margin: 0; padding-left: 16px; color: ${TH.sub}; font-size: 12px; line-height: 1.8; }
.dv-filelist { display: flex; flex-direction: column; gap: 4px; }
.dv-file {
  display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
  padding: 5px 8px; border-radius: 7px; cursor: pointer;
  background: ${TH.accentSoft}; border: 1px solid transparent;
  color: ${TH.ink}; font-size: 12px;
}
.dv-file:hover { border-color: ${TH.accent}; }
.dv-file code {
  color: ${TH.accent}; font-family: ${MONO}; font-size: 11.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dv-file span { color: ${TH.sub}; flex: none; font-size: 11.5px; }
.dv-legend-grid { display: flex; flex-wrap: wrap; gap: 6px 13px; font-size: 11.5px; color: ${TH.sub}; }
.dv-gi { display: flex; align-items: center; gap: 5px; }
.dv-gi i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
.dv-gi em { color: ${TH.sub}; font-style: normal; }

@media (max-width: 900px) {
  .dv-hud {
    left: 8px; top: 8px; right: 8px;
    max-width: calc(100% - 16px);
  }
  .dv-hud .dv-row { gap: 6px; }
  .dv-search { flex: 1 1 auto; min-width: 0; }
  .dv-search input { width: 100%; min-width: 0; }
  .dv-legend, .dv-hint { display: none; }
  .dv-root .view-panel {
    left: 8px; right: 8px; top: auto; bottom: 8px;
    width: auto; max-height: 42%; border-radius: 12px;
  }
}
`;

  function createDepsView(viewCtx) {
    const container = viewCtx.container;
    if (!container) return { activate: function () {}, deactivate: function () {} };

    const data = (viewCtx.data && typeof viewCtx.data === "object") ? viewCtx.data : {};
    const router = viewCtx.router || null;
    const sourceApi = viewCtx.source || null;

    function toast(text) {
      try {
        if (viewCtx.app && typeof viewCtx.app.toast === "function") viewCtx.app.toast(text);
        else if (window.CodeViz && typeof window.CodeViz.toast === "function") window.CodeViz.toast(text);
      } catch (err) { /* ignore */ }
    }

    /* ==================== 数据整理（一次性） ==================== */

    const groups = (data.groups && typeof data.groups === "object" && !Array.isArray(data.groups))
      ? data.groups : {};

    const modules = [];
    (Array.isArray(data.modules) ? data.modules : []).forEach(function (m) {
      if (m && m.id != null && m.id !== "") modules.push(m);
    });
    const moduleById = new Map();
    modules.forEach(function (m) { moduleById.set(String(m.id), m); });

    const files = [];
    (Array.isArray(data.files) ? data.files : []).forEach(function (f) {
      if (f && f.path != null && f.path !== "") files.push(f);
    });
    const fileByPath = new Map();
    files.forEach(function (f) { fileByPath.set(String(f.path), f); });

    const filesByModule = new Map();
    files.forEach(function (f) {
      const key = f.module == null ? "" : String(f.module);
      if (!filesByModule.has(key)) filesByModule.set(key, []);
      filesByModule.get(key).push(f);
    });

    const rawModuleEdges = Array.isArray(data.moduleEdges) ? data.moduleEdges : [];
    const rawFileEdges = Array.isArray(data.fileEdges) ? data.fileEdges : [];

    function moduleFiles(id) {
      const key = String(id);
      const list = filesByModule.get(key);
      if (list && list.length) return list;
      return synthesizeModuleFiles(key);
    }

    // data.files 缺失时，退回契约里的 modules[].files（只有路径，没有指标）。
    function synthesizeModuleFiles(id) {
      const m = moduleById.get(String(id));
      if (!m || !Array.isArray(m.files)) return [];
      const out = [];
      for (let i = 0; i < m.files.length; i++) {
        const p = m.files[i];
        const path = typeof p === "string" ? p : (p && p.path ? String(p.path) : "");
        if (!path) continue;
        out.push({ path: path, module: String(id), group: m.group });
      }
      return out;
    }

    function synthesizeAllFiles(moduleFilter) {
      const out = [];
      const seen = new Set();
      for (let i = 0; i < modules.length; i++) {
        const id = String(modules[i].id);
        if (moduleFilter && id !== moduleFilter) continue;
        const list = synthesizeModuleFiles(id);
        for (let j = 0; j < list.length; j++) {
          const path = list[j].path;
          if (seen.has(path)) continue;
          seen.add(path);
          out.push(list[j]);
        }
      }
      return out;
    }

    function moduleLabel(id) {
      const m = moduleById.get(String(id));
      if (m && m.label) return String(m.label);
      if (m && m.id) return String(m.id);
      return String(id == null ? "未命名模块" : id);
    }

    function groupKey(g) {
      return (g == null || g === "") ? "other" : String(g);
    }

    // 数据里的分组颜色只信任 #rgb / #rrggbb，其余一律退回主题调色板
    function groupColor(g) {
      const key = groupKey(g);
      const def = groups[key];
      if (def && typeof def.color === "string" && COLOR_RE.test(def.color.trim())) {
        return def.color.trim();
      }
      return TH.palette[CV.hashStr(key) % TH.palette.length] || TH.node;
    }

    function groupLabel(g) {
      const key = groupKey(g);
      const def = groups[key];
      if (def && def.label) return String(def.label);
      return key === "other" ? "未分组" : key;
    }

    function mergeEdges(list, validIds) {
      const merged = new Map();
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e) continue;
        const s = e.source == null ? "" : String(e.source);
        const t = e.target == null ? "" : String(e.target);
        if (!s || !t || s === t) continue;
        if (!validIds.has(s) || !validIds.has(t)) continue;
        const weight = Math.max(1, toNum(e.weight, 1));
        const key = s + "\u0000" + t;
        const hit = merged.get(key);
        if (hit) hit.weight += weight;
        else merged.set(key, { source: s, target: t, weight: weight, bend: 0 });
      }
      const out = [];
      merged.forEach(function (e) {
        // 稳定的曲线偏移，2D 下避免所有边完全重叠
        e.bend = (((CV.hashStr(e.source + "\u0001" + e.target) % 7) - 3) * 0.045);
        out.push(e);
      });
      return out;
    }

    function deriveModuleEdges() {
      const out = [];
      for (let i = 0; i < rawFileEdges.length; i++) {
        const e = rawFileEdges[i];
        if (!e) continue;
        const a = fileByPath.get(String(e.source));
        const b = fileByPath.get(String(e.target));
        if (!a || !b) continue;
        const ma = a.module == null ? "" : String(a.module);
        const mb = b.module == null ? "" : String(b.module);
        if (!ma || !mb || ma === mb) continue;
        out.push({ source: ma, target: mb, weight: toNum(e.weight, 1) });
      }
      return out;
    }

    const moduleIdSet = new Set(moduleById.keys());
    let mergedModuleEdges = mergeEdges(rawModuleEdges, moduleIdSet);
    if (!mergedModuleEdges.length && rawFileEdges.length) {
      mergedModuleEdges = mergeEdges(deriveModuleEdges(), moduleIdSet);
    }

    function buildDepMap(edges) {
      const out = new Map();
      const inn = new Map();
      edges.forEach(function (e) {
        if (!out.has(e.source)) out.set(e.source, []);
        out.get(e.source).push({ id: e.target, weight: e.weight });
        if (!inn.has(e.target)) inn.set(e.target, []);
        inn.get(e.target).push({ id: e.source, weight: e.weight });
      });
      const sortFn = function (a, b) { return (b.weight || 0) - (a.weight || 0) || String(a.id).localeCompare(String(b.id)); };
      out.forEach(function (l) { l.sort(sortFn); });
      inn.forEach(function (l) { l.sort(sortFn); });
      return { out: out, inn: inn };
    }

    const moduleDeps = buildDepMap(mergedModuleEdges);
    const fileDeps = buildDepMap(mergeEdges(rawFileEdges,
      new Set(files.map(function (f) { return String(f.path); }))));

    /* ==================== 状态 ==================== */

    const state = {
      level: "module",
      moduleId: null,
      dim3: false,
      search: "",
      selectedId: null,
      hoverId: null,
      panel: { kind: "overview", id: null },
      nodes: [],
      edges: [],
      nodeById: new Map(),
      outMap: new Map(),
      inMap: new Map(),
      screen: new Map(),
      zRange: { min: 0, span: 1 },
      width: 0,
      height: 0,
      dpr: 1,
      t: { x: 0, y: 0, k: 1 },
      cam: {
        yaw: -0.55, pitch: 0.35, dist: 2400, focal: 900,
        target: { x: 0, y: 0, z: 0 },
      },
      camInit: false,
      userMoved: false,
      fitPending: true,
      drag: null,
      tipId: null,
      // 双击会连续派发两次 click：第一次切层级后用它吃掉第二次
      lastLevelChange: 0,
      // 多指触控：pointerId -> 局部坐标；pinch 存在时进入双指缩放
      pointers: new Map(),
      pinch: null,
      suppressClick: false,
      built: false,
      active: false,
      raf: 0,
    };

    /* ==================== DOM ==================== */

    container.innerHTML = "";
    container.classList.add("dv-root");

    const styleEl = document.createElement("style");
    styleEl.textContent = STYLE;
    container.appendChild(styleEl);

    const canvas = document.createElement("canvas");
    canvas.className = "dv-canvas";
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "系统依赖图：方向键平移，加号减号缩放，回车打开选中节点，Esc 取消选中");
    container.appendChild(canvas);
    const pen = canvas.getContext("2d");

    const hud = document.createElement("div");
    hud.className = "dv-hud";
    container.appendChild(hud);

    const crumbsEl = document.createElement("div");
    crumbsEl.className = "dv-crumbs";
    crumbsEl.setAttribute("aria-label", "依赖层级");
    hud.appendChild(crumbsEl);

    const rowEl = document.createElement("div");
    rowEl.className = "dv-row";
    hud.appendChild(rowEl);

    const levelSeg = document.createElement("div");
    levelSeg.className = "dv-seg";
    levelSeg.innerHTML =
      '<button type="button" data-level="module">模块</button>' +
      '<button type="button" data-level="file">文件</button>';
    rowEl.appendChild(levelSeg);

    const dimSeg = document.createElement("div");
    dimSeg.className = "dv-seg";
    dimSeg.innerHTML =
      '<button type="button" data-dim="3d">3D</button>' +
      '<button type="button" data-dim="2d">2D</button>';
    rowEl.appendChild(dimSeg);

    const searchWrap = document.createElement("label");
    searchWrap.className = "dv-search";
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "搜索模块 / 文件…";
    searchInput.setAttribute("aria-label", "搜索模块或文件");
    searchWrap.appendChild(searchInput);
    rowEl.appendChild(searchWrap);

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "dv-btn";
    resetBtn.textContent = "复位";
    resetBtn.title = "重排布局并复位视角（双击画布同样有效）";
    rowEl.appendChild(resetBtn);

    const legendEl = document.createElement("div");
    legendEl.className = "dv-legend";
    container.appendChild(legendEl);

    const hintEl = document.createElement("div");
    hintEl.className = "dv-hint";
    container.appendChild(hintEl);

    const emptyEl = document.createElement("div");
    emptyEl.className = "dv-empty";
    container.appendChild(emptyEl);

    const tipEl = document.createElement("div");
    tipEl.className = "dv-tip";
    container.appendChild(tipEl);

    const panelEl = document.createElement("aside");
    panelEl.className = "view-panel";
    panelEl.innerHTML =
      '<div class="view-panel-head"><h2>系统依赖</h2><div class="badge"></div></div>' +
      '<div class="view-panel-body"></div>';
    container.appendChild(panelEl);
    const panelTitle = panelEl.querySelector("h2");
    const panelBadge = panelEl.querySelector(".badge");
    const panelBody = panelEl.querySelector(".view-panel-body");

    const levelButtons = Array.prototype.slice.call(levelSeg.querySelectorAll("button"));
    const dimButtons = Array.prototype.slice.call(dimSeg.querySelectorAll("button"));

    /* ==================== 坐标 / 尺寸 / 相机 ==================== */

    function viewport() {
      const w = state.width;
      let gutter = 0;
      if (w >= 1180) gutter = 372;
      else if (w >= 940) gutter = 330;
      // 窄屏下详情面板是底部抽屉（约 42% 高），把可视绘图区让到面板上方。
      const h = w <= 900 ? Math.max(180, state.height * 0.56) : state.height;
      return { w: Math.max(220, w - gutter), h: h };
    }

    function ensureSize() {
      const w = Math.round(container.clientWidth || 0);
      const h = Math.round(container.clientHeight || 0);
      if (!w || !h) return false;
      const changed = w !== state.width || h !== state.height || !canvas.width;
      state.width = w;
      state.height = h;
      state.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const pw = Math.round(w * state.dpr);
      const ph = Math.round(h * state.dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      return changed;
    }

    function projectPoint(px, py, pz, vp) {
      const cam = state.cam;
      const cy = Math.cos(cam.yaw);
      const sy = Math.sin(cam.yaw);
      const cp = Math.cos(cam.pitch);
      const sp = Math.sin(cam.pitch);
      const dx = px - cam.target.x;
      const dy = py - cam.target.y;
      const dz = pz - cam.target.z;
      const x1 = dx * cy + dz * sy;
      const z1 = -dx * sy + dz * cy;
      const y2 = dy * cp - z1 * sp;
      const z2 = dy * sp + z1 * cp;
      const zc = z2 + cam.dist;
      if (zc < 40) return null;
      const s = cam.focal / zc;
      return { x: vp.w / 2 + x1 * s, y: vp.h / 2 - y2 * s, s: s, zc: zc };
    }

    function computeScreen() {
      const vp = viewport();
      const map = new Map();
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < state.nodes.length; i++) {
        const n = state.nodes[i];
        let p;
        if (state.dim3) {
          p = projectPoint(n.x, n.y, n.z, vp);
        } else {
          p = {
            x: n.x2 * state.t.k + state.t.x,
            y: n.y2 * state.t.k + state.t.y,
            s: state.t.k,
            zc: 0,
          };
        }
        if (!p) continue;
        p.r = state.dim3
          ? clamp(n.base * p.s, 2.8, 30)
          : clamp(n.base * p.s, 3.5, 26);
        map.set(n.id, p);
        if (state.dim3) {
          if (p.zc < minZ) minZ = p.zc;
          if (p.zc > maxZ) maxZ = p.zc;
        }
      }
      state.screen = map;
      if (!Number.isFinite(minZ)) { minZ = 0; maxZ = 0; }
      state.zRange = { min: minZ, span: Math.max(1, maxZ - minZ) };
    }

    function ensureScreen() {
      if (state.screen.size !== state.nodes.length) computeScreen();
    }

    function fit3D() {
      const nodes = state.nodes;
      if (!nodes.length) return;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
        if (n.z < minZ) minZ = n.z;
        if (n.z > maxZ) maxZ = n.z;
      }
      const vp = viewport();
      const cam = state.cam;
      cam.yaw = -0.55;
      cam.pitch = 0.35;
      cam.target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
      cam.focal = clamp(Math.min(vp.w, vp.h) * 0.95, 420, 2200);
      const radius = Math.max(180, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
      cam.dist = clamp(radius * 2.35, 520, 16000);

      // 透视投影下用「投影包围盒」迭代贴合，兼顾不同纵深节点的透视缩放与画面居中。
      const availW = Math.max(120, vp.w * 0.86);
      const availH = Math.max(120, vp.h * 0.76);
      for (let iter = 0; iter < 5; iter++) {
        let pMinX = Infinity, pMaxX = -Infinity;
        let pMinY = Infinity, pMaxY = -Infinity;
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          const p = projectPoint(n.x, n.y, n.z, vp);
          if (!p) continue;
          const r = clamp(n.base * p.s, 2.8, 30);
          if (p.x - r < pMinX) pMinX = p.x - r;
          if (p.x + r > pMaxX) pMaxX = p.x + r;
          if (p.y - r < pMinY) pMinY = p.y - r;
          if (p.y + r > pMaxY) pMaxY = p.y + r;
        }
        if (!Number.isFinite(pMinX)) break;
        const bw = Math.max(1, pMaxX - pMinX);
        const bh = Math.max(1, pMaxY - pMinY);
        const scale = Math.min(availW / bw, availH / bh);
        const shiftX = (pMinX + pMaxX) / 2 - vp.w / 2;
        const shiftY = (pMinY + pMaxY) / 2 - vp.h / 2;
        const kk = cam.dist / cam.focal;
        const basis = cameraBasis();
        // 平移相机目标，使投影包围盒回到画面中心
        cam.target.x += (basis.right.x * shiftX - basis.up.x * shiftY) * kk;
        cam.target.y += (basis.right.y * shiftX - basis.up.y * shiftY) * kk;
        cam.target.z += (basis.right.z * shiftX - basis.up.z * shiftY) * kk;
        cam.dist = clamp(cam.dist / clamp(scale, 0.25, 4), 320, 20000);
      }

      state.camInit = true;
      state.userMoved = false;
    }

    function fit2D() {
      const nodes = state.nodes;
      if (!nodes.length) return;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        // 标签是画在节点下方的胶囊，横向最多约 170px：给标签留出空间，
        // 否则首屏边缘的节点文字会被裁掉。
        const padX = Math.max(n.base + 18, 92);
        const padTop = n.base + 20;
        const padBottom = n.base + 38;
        if (n.x2 - padX < minX) minX = n.x2 - padX;
        if (n.x2 + padX > maxX) maxX = n.x2 + padX;
        if (n.y2 - padTop < minY) minY = n.y2 - padTop;
        if (n.y2 + padBottom > maxY) maxY = n.y2 + padBottom;
      }
      const vp = viewport();
      const bw = Math.max(60, maxX - minX);
      const bh = Math.max(60, maxY - minY);
      const k = clamp(Math.min(vp.w * 0.84 / bw, vp.h * 0.80 / bh), 0.07, 1.8);
      state.t.k = k;
      state.t.x = vp.w / 2 - (minX + maxX) / 2 * k;
      state.t.y = vp.h / 2 - (minY + maxY) / 2 * k;
      state.userMoved = false;
    }

    function fitView() {
      if (state.dim3) fit3D();
      else fit2D();
      state.userMoved = false;
    }

    /* ==================== 图构建 / 布局 ==================== */

    function makeModuleNode(m) {
      const id = String(m.id);
      const fl = moduleFiles(id);
      const fileCount = toNum(m.fileCount, fl.length);
      const symbolSum = fl.reduce(function (a, f) { return a + toNum(f.symbols, 0); }, 0);
      const symbols = toNum(m.symbols, symbolSum);
      return {
        id: id,
        kind: "module",
        label: String(m.label || m.id),
        group: m.group == null ? "other" : String(m.group),
        raw: m,
        files: fl,
        metric: { files: fileCount, symbols: symbols },
        base: clamp(16 + Math.sqrt(Math.max(1, symbols || fileCount * 10) / 9), 20, 42),
        x: 0, y: 0, z: 0, x2: 0, y2: 0,
        _hs: "",
      };
    }

    function makeFileNode(f) {
      const path = String(f.path);
      const modId = f.module == null ? "" : String(f.module);
      const mod = moduleById.get(modId);
      const group = (f.group != null && f.group !== "")
        ? String(f.group)
        : (mod && mod.group != null ? String(mod.group) : "other");
      const symbols = toNum(f.symbols, 0);
      return {
        id: path,
        kind: "file",
        label: CV.basename(path),
        full: path,
        group: group,
        raw: f,
        modId: modId,
        metric: {
          lines: toNum(f.lines, 0),
          symbols: symbols,
          branches: toNum(f.branches, 0),
          excepts: toNum(f.excepts, 0),
          functions: toNum(f.functions, 0),
        },
        base: clamp(10 + Math.sqrt(Math.max(1, symbols || 5) / 5), 12, 30),
        x: 0, y: 0, z: 0, x2: 0, y2: 0,
        _hs: "",
      };
    }

    function buildModuleNodes() {
      return modules.map(makeModuleNode);
    }

    function buildFileNodes() {
      let list;
      if (state.moduleId) {
        list = files.length
          ? files.filter(function (f) { return String(f.module) === state.moduleId; })
          : synthesizeAllFiles(state.moduleId);
      } else {
        list = files.length ? files : synthesizeAllFiles(null);
      }
      return list.map(makeFileNode);
    }

    function buildNeighbors(edges) {
      const out = new Map();
      const inn = new Map();
      edges.forEach(function (e) {
        if (!out.has(e.source)) out.set(e.source, []);
        out.get(e.source).push({ id: e.target, weight: e.weight });
        if (!inn.has(e.target)) inn.set(e.target, []);
        inn.get(e.target).push({ id: e.source, weight: e.weight });
      });
      state.outMap = out;
      state.inMap = inn;
    }

    // 分层：从入度为 0 的节点做 BFS，得到（近似）依赖方向；环里的节点归入第 0 层。
    function computeLayers(nodes, edges) {
      const ids = new Set(nodes.map(function (n) { return n.id; }));
      const indeg = new Map();
      const outAdj = new Map();
      ids.forEach(function (id) { indeg.set(id, 0); outAdj.set(id, []); });
      edges.forEach(function (e) {
        if (!ids.has(e.source) || !ids.has(e.target)) return;
        outAdj.get(e.source).push(e.target);
        indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
      });
      const layer = new Map();
      const queue = [];
      ids.forEach(function (id) {
        if (!indeg.get(id)) { layer.set(id, 0); queue.push(id); }
      });
      let head = 0;
      while (head < queue.length) {
        const u = queue[head++];
        const lu = layer.get(u) || 0;
        const list = outAdj.get(u) || [];
        for (let i = 0; i < list.length; i++) {
          const v = list[i];
          if (layer.has(v)) continue;
          layer.set(v, lu + 1);
          queue.push(v);
        }
      }
      ids.forEach(function (id) { if (!layer.has(id)) layer.set(id, 0); });
      return layer;
    }

    function groupOrderIndex(nodes) {
      const labelOf = new Map();
      nodes.forEach(function (n) {
        if (!labelOf.has(n.group)) labelOf.set(n.group, groupLabel(n.group));
      });
      const keys = Array.from(labelOf.keys()).sort(function (a, b) {
        return String(labelOf.get(a)).localeCompare(String(labelOf.get(b)));
      });
      const index = new Map();
      keys.forEach(function (k, i) { index.set(k, i); });
      return index;
    }

    function layoutGraph() {
      const nodes = state.nodes;
      const edges = state.edges;
      if (!nodes.length) return;

      const rawLayers = computeLayers(nodes, edges);
      let maxRaw = 0;
      rawLayers.forEach(function (v) { if (v > maxRaw) maxRaw = v; });
      const columns = Math.min(MAX_LAYERS, maxRaw + 1);
      const compress = function (v) {
        return maxRaw === 0 ? 0 : Math.round(v * (columns - 1) / maxRaw);
      };

      const byLayer = new Map();
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.layer = compress(rawLayers.get(n.id) || 0);
        if (!byLayer.has(n.layer)) byLayer.set(n.layer, []);
        byLayer.get(n.layer).push(n);
      }

      const order = groupOrderIndex(nodes);
      byLayer.forEach(function (list) {
        list.sort(function (a, b) {
          const ga = order.has(a.group) ? order.get(a.group) : 99;
          const gb = order.has(b.group) ? order.get(b.group) : 99;
          return ga - gb || String(a.label).localeCompare(String(b.label));
        });
      });

      const span = columns - 1;
      byLayer.forEach(function (list, layerIndex) {
        const count = list.length;
        const x3 = (layerIndex - span / 2) * 520;
        const x2 = (layerIndex - span / 2) * 400;
        const ringR = count <= 1 ? 0 : Math.max(130, (count * 38) / TAU);
        const gap2 = clamp(2200 / Math.max(1, count), 34, 64);
        for (let i = 0; i < count; i++) {
          const n = list[i];
          const angle = count <= 1 ? 0 : (i / count) * TAU - Math.PI / 2;
          n.x = x3;
          n.y = Math.sin(angle) * ringR;
          n.z = Math.cos(angle) * ringR;
          n.x2 = x2;
          n.y2 = (i - (count - 1) / 2) * gap2;
        }
      });
    }

    function relayout() {
      layoutGraph();
      state.camInit = false;
      state.fitPending = true;
      state.userMoved = false;
      state.screen = new Map();
    }

    /* ==================== 重建当前层级 ==================== */

    function rebuild() {
      const level = state.level;
      let nodes;
      let edges;

      if (level === "file") {
        nodes = buildFileNodes();
        const ids = new Set(nodes.map(function (n) { return n.id; }));
        edges = mergeEdges(rawFileEdges, ids);
      } else {
        nodes = buildModuleNodes();
        const ids = new Set(nodes.map(function (n) { return n.id; }));
        edges = mergeEdges(rawModuleEdges, ids);
        if (!edges.length && rawFileEdges.length) edges = mergeEdges(deriveModuleEdges(), ids);
      }

      state.nodes = nodes;
      state.edges = edges;
      state.nodeById = new Map();
      nodes.forEach(function (n) {
        n._hs = "";
        state.nodeById.set(n.id, n);
      });
      buildNeighbors(edges);

      layoutGraph();
      state.screen = new Map();
      state.camInit = false;
      state.fitPending = true;
      state.userMoved = false;
      state.hoverId = null;
      state.tipId = null;
      tipEl.classList.remove("show");

      if (level === "file" && state.moduleId) {
        state.selectedId = null;
        state.panel = { kind: "module", id: state.moduleId };
      } else if (state.selectedId && state.nodeById.has(state.selectedId)) {
        const n = state.nodeById.get(state.selectedId);
        state.panel = { kind: n.kind, id: n.id };
      } else {
        state.selectedId = null;
        state.panel = { kind: "overview", id: null };
      }

      renderPanel();
      renderCrumbs();
      updateToolbar();
      updateLegend();
      updateEmpty();
      updateHint();
      updateCanvasA11y();
      state.built = true;
    }

    /* ==================== 右侧详情面板 ==================== */

    function metricCell(value, label) {
      return '<div class="metric"><b>' + CV.esc(value) + '</b><span>' + CV.esc(label) + "</span></div>";
    }

    function setPanel(title, color, badgeText, bodyHtml) {
      panelTitle.textContent = title;
      panelBadge.innerHTML = '<i style="background:' + CV.esc(color) + ";color:" + CV.esc(color) + '"></i><span>' +
        CV.esc(badgeText) + "</span>";
      panelBody.innerHTML = bodyHtml;
      panelBody.scrollTop = 0;
    }

    function groupCounts() {
      const map = new Map();
      const list = state.nodes.length
        ? state.nodes
        : modules.map(function (m) { return { group: m.group }; });
      list.forEach(function (n) {
        const g = groupKey(n.group);
        map.set(g, (map.get(g) || 0) + 1);
      });
      return Array.from(map.entries()).sort(function (a, b) {
        return b[1] - a[1] || String(a[0]).localeCompare(String(b[0]));
      });
    }

    function renderOverview() {
      state.panel = { kind: "overview", id: null };
      const project = data.project || {};
      const idx = data.index || {};
      const projectName = project.name ? String(project.name) : "codeviz";
      const desc = project.description ? String(project.description) : "";

      const parts = [];
      if (desc) parts.push('<p class="desc">' + CV.esc(desc) + "</p>");
      parts.push('<div class="section"><h3>规模</h3><div class="metrics">' +
        metricCell(modules.length, "模块") +
        metricCell(Number.isFinite(Number(idx.files)) ? idx.files : files.length, "文件") +
        metricCell(mergedModuleEdges.length, "模块依赖") +
        "</div></div>");

      parts.push('<div class="section"><h3>怎么用</h3><ul class="dv-list">' +
        "<li>点击模块下钻到文件级，面包屑「全部」返回</li>" +
        "<li>点击文件打开源码侧栏，并查看文件指标</li>" +
        "<li>悬停节点高亮上下游；搜索框过滤，回车定位首个匹配</li>" +
        "<li>3D 拖拽空白旋转，Shift / 右键拖拽平移</li>" +
        "<li>2D 拖拽平移；滚轮缩放；双击复位</li>" +
        "</ul></div>");

      const counts = groupCounts();
      if (counts.length) {
        parts.push('<div class="section"><h3>分组</h3><div class="dv-legend-grid">' +
          counts.map(function (entry) {
            const color = groupColor(entry[0]);
            return '<span class="dv-gi"><i style="background:' + CV.esc(color) + ";color:" + CV.esc(color) +
              '"></i>' + CV.esc(groupLabel(entry[0])) + ' <em>' + entry[1] + "</em></span>";
          }).join("") +
          "</div></div>");
      }

      setPanel(projectName + " · 依赖", "#38bdf8", "项目概览", parts.join(""));
    }

    function depChips(list, kind) {
      if (!list || !list.length) return '<span class="empty">无</span>';
      return list.map(function (d) {
        const id = String(d.id);
        const label = kind === "module" ? moduleLabel(id) : CV.basename(id);
        return '<div class="chip" data-act="' + (kind === "module" ? "module" : "file") +
          '" data-id="' + CV.esc(id) + '" title="' + CV.esc(id) + '"><span>' + CV.esc(label) +
          "</span><span>" + toNum(d.weight, 0) + "</span></div>";
      }).join("");
    }

    function renderModulePanel(id) {
      const key = String(id);
      const m = moduleById.get(key);
      const node = state.nodeById.get(key);
      if (!m && !node) { renderOverview(); return; }

      const fl = moduleFiles(key);
      const fileCount = m ? toNum(m.fileCount, fl.length) : fl.length;
      const symbols = m
        ? toNum(m.symbols, fl.reduce(function (a, f) { return a + toNum(f.symbols, 0); }, 0))
        : (node ? node.metric.symbols : 0);
      const outs = moduleDeps.out.get(key) || [];
      const ins = moduleDeps.inn.get(key) || [];
      const desc = m && m.desc ? String(m.desc) : "";
      const group = (m && m.group != null) ? m.group : (node ? node.group : "other");

      const top = fl.slice().sort(function (a, b) {
        return toNum(b.symbols, 0) - toNum(a.symbols, 0) ||
          toNum(b.lines, 0) - toNum(a.lines, 0) ||
          String(a.path).localeCompare(String(b.path));
      }).slice(0, 6);

      const parts = [];
      if (desc) parts.push('<p class="desc">' + CV.esc(desc) + "</p>");
      parts.push('<div class="section"><h3>规模</h3><div class="metrics">' +
        metricCell(fileCount, "文件") +
        metricCell(symbols, "符号") +
        metricCell(outs.length + ins.length, "依赖") +
        "</div></div>");

      parts.push('<div class="section"><h3>Top 文件（按符号数）</h3>' +
        (top.length
          ? '<div class="dv-filelist">' + top.map(function (f) {
            const path = String(f.path);
            return '<div class="dv-file" data-act="open" data-path="' + CV.esc(path) +
              '" title="' + CV.esc(path) + '"><code>' + CV.esc(CV.basename(path)) +
              "</code><span>" + toNum(f.symbols, 0) + " 符号</span></div>";
          }).join("") + "</div>"
          : '<span class="empty">该模块没有文件记录</span>') +
        "</div>");

      parts.push('<div class="section"><h3>依赖（出 · ' + outs.length + '）</h3><div class="chips">' +
        depChips(outs, "module") + "</div></div>");
      parts.push('<div class="section"><h3>被依赖（入 · ' + ins.length + '）</h3><div class="chips">' +
        depChips(ins, "module") + "</div></div>");

      setPanel(moduleLabel(key), groupColor(group), groupLabel(group) + " · 模块", parts.join(""));
    }

    function renderFilePanel(id) {
      const key = String(id);
      const node = state.nodeById.get(key);
      const f = fileByPath.get(key) || (node ? node.raw : null);
      if (!f && !node) { renderOverview(); return; }

      const modId = node ? node.modId : (f && f.module != null ? String(f.module) : "");
      const mod = moduleById.get(modId);
      const group = node ? node.group : (f && f.group != null ? f.group : (mod && mod.group) || "other");
      const metric = node ? node.metric : {
        lines: toNum(f && f.lines, 0),
        symbols: toNum(f && f.symbols, 0),
        branches: toNum(f && f.branches, 0),
        excepts: toNum(f && f.excepts, 0),
        functions: toNum(f && f.functions, 0),
      };
      const outs = fileDeps.out.get(key) || [];
      const ins = fileDeps.inn.get(key) || [];

      const parts = [];
      parts.push('<p class="pathline">' + CV.esc(key) + "</p>");
      if (modId) {
        parts.push('<div class="section"><h3>所属模块</h3><div class="chips">' +
          '<div class="chip" data-act="module" data-id="' + CV.esc(modId) + '"><span>' +
          CV.esc(moduleLabel(modId)) + "</span><span>→</span></div></div></div>");
      }
      parts.push('<div class="section"><h3>规模</h3><div class="metrics">' +
        metricCell(metric.lines || "—", "行数") +
        metricCell(metric.symbols, "符号") +
        metricCell(metric.functions, "函数") +
        "</div></div>");
      parts.push('<div class="section"><h3>复杂度</h3><div class="metrics">' +
        metricCell(metric.branches, "分支") +
        metricCell(metric.excepts, "except") +
        metricCell(outs.length + ins.length, "依赖") +
        "</div></div>");

      parts.push('<div class="section"><h3>依赖（出 · ' + outs.length + '）</h3><div class="chips">' +
        depChips(outs, "file") + "</div></div>");
      parts.push('<div class="section"><h3>被依赖（入 · ' + ins.length + '）</h3><div class="chips">' +
        depChips(ins, "file") + "</div></div>");
      parts.push('<div class="section"><div class="chips">' +
        '<div class="chip" data-act="open" data-path="' + CV.esc(key) + '"><span>在源码侧栏打开</span><span>↗</span></div>' +
        "</div></div>");

      setPanel(CV.basename(key), groupColor(group), groupLabel(group) + " · 文件", parts.join(""));
    }

    function renderPanel() {
      const target = state.panel || { kind: "overview", id: null };
      if (target.kind === "module") renderModulePanel(target.id);
      else if (target.kind === "file") renderFilePanel(target.id);
      else renderOverview();
    }

    panelBody.addEventListener("click", function (ev) {
      const el = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null;
      if (!el) return;
      const act = el.dataset.act;
      if (act === "module") {
        openModuleChip(el.dataset.id);
      } else if (act === "file") {
        revealPath(el.dataset.id);
      } else if (act === "open") {
        openSource(el.dataset.path);
      }
    });

    /* ==================== 面包屑 / 工具条 / 图例 / 提示 ==================== */

    function renderCrumbs() {
      const parts = [];
      parts.push('<button type="button" data-crumb="all">全部</button>');
      if (state.level === "file") {
        parts.push('<span class="dv-sep">/</span>');
        if (state.moduleId) {
          parts.push('<button type="button" data-crumb="module">' + CV.esc(moduleLabel(state.moduleId)) + "</button>");
        } else {
          parts.push('<span class="dv-cur">全部文件</span>');
        }
      }
      if (state.panel && state.panel.kind === "file") {
        const node = state.nodeById.get(state.panel.id);
        const label = node ? node.label : CV.basename(state.panel.id);
        parts.push('<span class="dv-sep">/</span><span class="dv-cur">' + CV.esc(label) + "</span>");
      } else if (state.panel && state.panel.kind === "module" && state.level === "module" && state.panel.id) {
        parts.push('<span class="dv-sep">/</span><span class="dv-cur">' + CV.esc(moduleLabel(state.panel.id)) + "</span>");
      }
      crumbsEl.innerHTML = parts.join("");
    }

    crumbsEl.addEventListener("click", function (ev) {
      const btn = ev.target && ev.target.closest ? ev.target.closest("[data-crumb]") : null;
      if (!btn) return;
      if (btn.dataset.crumb === "all") {
        go("module");
      } else if (btn.dataset.crumb === "module") {
        if (!state.moduleId) return;
        state.selectedId = null;
        state.panel = { kind: "module", id: state.moduleId };
        renderPanel();
        renderCrumbs();
      }
    });

    function updateToolbar() {
      levelButtons.forEach(function (b) {
        b.classList.toggle("active", b.dataset.level === state.level);
      });
      dimButtons.forEach(function (b) {
        b.classList.toggle("active", (b.dataset.dim === "3d") === state.dim3);
      });
    }

    function updateLegend() {
      const counts = new Map();
      state.nodes.forEach(function (n) {
        const g = groupKey(n.group);
        counts.set(g, (counts.get(g) || 0) + 1);
      });
      const items = Array.from(counts.entries()).sort(function (a, b) {
        return b[1] - a[1] || String(a[0]).localeCompare(String(b[0]));
      }).slice(0, 12);
      if (!items.length) {
        legendEl.style.display = "none";
        legendEl.innerHTML = "";
        return;
      }
      legendEl.style.display = "";
      legendEl.innerHTML = items.map(function (entry) {
        const color = groupColor(entry[0]);
        return '<span class="dv-li"><i style="background:' + CV.esc(color) + ";color:" + CV.esc(color) +
          '"></i>' + CV.esc(groupLabel(entry[0])) + '<span class="dv-count">' + entry[1] + "</span></span>";
      }).join("");
    }

    function updateHint() {
      hintEl.textContent = state.dim3
        ? "3D：拖拽空白旋转 · 滚轮缩放 · Shift / 右键拖拽平移 · 拖拽节点 · 双击复位"
        : "2D：拖拽空白平移 · 滚轮缩放 · 拖拽节点 · 双击复位";
    }

    function updateEmpty() {
      if (state.nodes.length) {
        emptyEl.classList.remove("show");
        return;
      }
      let text = "没有可展示的依赖数据";
      if (state.level === "file") {
        text = state.moduleId
          ? "该模块没有文件记录（data.files 为空，或 module 字段不匹配）"
          : "没有文件级数据（data.files 为空）";
      } else if (!modules.length) {
        text = "没有模块级数据（data.modules 为空）";
      }
      emptyEl.innerHTML = "<div>" + CV.esc(text) + "</div>" +
        '<div class="dv-empty-sub">仍可切换层级 / 维度，或检查 codeviz/v1 数据契约</div>';
      emptyEl.classList.add("show");
    }

    function updateCanvasA11y() {
      const kind = state.level === "file" ? "文件" : "模块";
      canvas.setAttribute("aria-label",
        "系统依赖图：当前显示 " + state.nodes.length + " 个" + kind + "节点、" +
        state.edges.length + " 条依赖。方向键平移，加号减号缩放，回车打开选中节点，Esc 取消选中。");
    }

    /* ==================== 层级 / 语义缩放 / 选中 ==================== */

    function go(level, moduleId) {
      let qs = level === "file"
        ? (moduleId ? "level=file&module=" + encodeURIComponent(moduleId) : "level=file")
        : "level=module";
      // 2D 是附加状态：保留在 URL 里，便于深链与跨层级切换
      if (!state.dim3) qs += "&dim=2d";
      if (router && typeof router.go === "function") router.go("deps", qs);
      else location.hash = "#deps?" + qs;
    }

    function setDim(dim3) {
      if (state.dim3 === dim3) return;
      state.dim3 = dim3;
      state.camInit = false;
      state.userMoved = false;
      state.fitPending = true;
      state.screen = new Map();
      updateToolbar();
      updateHint();
    }

    function openSource(path) {
      if (!path) return;
      if (sourceApi && typeof sourceApi.showFile === "function") {
        try { sourceApi.showFile(String(path), 1); }
        catch (err) { console.error(err); }
      } else {
        toast("源码侧栏不可用");
      }
    }

    function selectNode(id, focus) {
      const key = String(id);
      const node = state.nodeById.get(key);
      if (!node) return false;
      state.selectedId = key;
      state.panel = { kind: node.kind, id: key };
      renderPanel();
      renderCrumbs();
      if (focus) focusNode(node);
      return true;
    }

    function focusNode(node) {
      if (!node) return;
      if (state.dim3) {
        state.cam.target = { x: node.x, y: node.y, z: node.z };
        state.cam.dist = clamp(state.cam.dist, 700, 1500);
        state.camInit = true;
      } else {
        const vp = viewport();
        state.t.k = clamp(Math.max(state.t.k, 0.9), 0.2, 2.4);
        state.t.x = vp.w / 2 - node.x2 * state.t.k;
        state.t.y = vp.h / 2 - node.y2 * state.t.k;
      }
      state.userMoved = true;
    }

    function openModuleChip(id) {
      if (!id) return;
      const key = String(id);
      if (state.level === "module" && state.nodeById.has(key)) {
        selectNode(key, true);
        return;
      }
      if (state.level === "file" && state.moduleId === key) {
        state.selectedId = null;
        state.panel = { kind: "module", id: key };
        renderPanel();
        renderCrumbs();
        return;
      }
      go("file", key);
    }

    function revealPath(path) {
      if (!path) return;
      const key = String(path);
      if (state.nodeById.has(key)) {
        selectNode(key, true);
        return;
      }
      const f = fileByPath.get(key);
      if (f && f.module != null) {
        const mid = String(f.module);
        toast("切换到模块：" + moduleLabel(mid));
        go("file", mid);
        return;
      }
      toast("该文件不在当前视图中");
    }

    function onNodeClick(node) {
      if (!node) return;
      // 双击会连续触发两次 click：层级刚切换时忽略第二次，避免误开源码
      if (performance.now() - state.lastLevelChange < 320) return;
      if (node.kind === "module") {
        // 语义缩放：模块 → 该模块的文件
        state.lastLevelChange = performance.now();
        go("file", node.id);
        return;
      }
      selectNode(node.id, false);
      openSource(node.id);
    }

    /* ==================== 搜索 ==================== */

    function haystack(n) {
      if (n._hs) return n._hs;
      const parts = [n.label, n.full || "", n.group || "", groupLabel(n.group)];
      if (n.kind === "module" && n.files) {
        for (let i = 0; i < n.files.length; i++) {
          if (n.files[i] && n.files[i].path) parts.push(String(n.files[i].path));
        }
      }
      n._hs = parts.join(" ").toLowerCase();
      return n._hs;
    }

    function searchSet() {
      const q = state.search.trim().toLowerCase();
      if (!q) return null;
      const set = new Set();
      for (let i = 0; i < state.nodes.length; i++) {
        const n = state.nodes[i];
        if (haystack(n).indexOf(q) >= 0) set.add(n.id);
      }
      return set;
    }

    function locateFirstMatch() {
      const q = state.search.trim().toLowerCase();
      if (!q) return;
      const matches = state.nodes.filter(function (n) { return haystack(n).indexOf(q) >= 0; });
      if (!matches.length) {
        toast("没有匹配的节点");
        return;
      }
      const rank = function (n) {
        const label = String(n.label).toLowerCase();
        if (label === q) return 0;
        if (label.indexOf(q) === 0) return 1;
        if (label.indexOf(q) >= 0) return 2;
        if (String(n.full || "").toLowerCase().indexOf(q) >= 0) return 3;
        return 4;
      };
      matches.sort(function (a, b) {
        return rank(a) - rank(b) || String(a.label).localeCompare(String(b.label));
      });
      const node = matches[0];
      selectNode(node.id, true);
    }

    searchInput.addEventListener("input", function () {
      state.search = searchInput.value || "";
    });
    searchInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        locateFirstMatch();
      } else if (ev.key === "Escape") {
        searchInput.value = "";
        state.search = "";
        searchInput.blur();
      }
    });

    resetBtn.addEventListener("click", function () {
      relayout();
    });

    levelSeg.addEventListener("click", function (ev) {
      const btn = ev.target && ev.target.closest ? ev.target.closest("[data-level]") : null;
      if (!btn) return;
      const level = btn.dataset.level;
      if (level === state.level) return;
      if (level === "module") go("module");
      else go("file", state.moduleId || null);
    });

    dimSeg.addEventListener("click", function (ev) {
      const btn = ev.target && ev.target.closest ? ev.target.closest("[data-dim]") : null;
      if (!btn) return;
      setDim(btn.dataset.dim === "3d");
    });

    /* ==================== 命中测试 / 交互 ==================== */

    function hitTest(sx, sy) {
      ensureScreen();
      let best = null;
      let bestScore = Infinity;
      for (let i = 0; i < state.nodes.length; i++) {
        const n = state.nodes[i];
        const p = state.screen.get(n.id);
        if (!p) continue;
        const d = Math.hypot(sx - p.x, sy - p.y);
        if (d > p.r + 8) continue;
        const depth = state.dim3 ? clamp((p.zc - state.zRange.min) * 0.004, 0, 8) : 0;
        const score = d + depth;
        if (score < bestScore) { best = n; bestScore = score; }
      }
      return best;
    }

    function localPoint(ev) {
      const rect = canvas.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    }

    function cameraBasis() {
      const cam = state.cam;
      const cy = Math.cos(cam.yaw);
      const sy = Math.sin(cam.yaw);
      const cp = Math.cos(cam.pitch);
      const sp = Math.sin(cam.pitch);
      return {
        right: { x: cy, y: 0, z: -sy },
        up: { x: -sy * sp, y: cp, z: -cy * sp },
      };
    }

    function showTip(node, sx, sy) {
      if (!node) {
        if (state.tipId !== null) {
          state.tipId = null;
          tipEl.classList.remove("show");
        }
        return;
      }
      if (state.tipId !== node.id) {
        state.tipId = node.id;
        const outs = (state.outMap.get(node.id) || []).length;
        const ins = (state.inMap.get(node.id) || []).length;
        let sub;
        if (node.kind === "module") {
          sub = groupLabel(node.group) + " · " + node.metric.files + " 文件 · " + node.metric.symbols + " 符号";
        } else {
          sub = groupLabel(node.group) + " · " + node.metric.lines + " 行 · " + node.metric.symbols + " 符号";
        }
        tipEl.innerHTML = "<b>" + CV.esc(node.label) + "</b>" +
          (node.kind === "file" ? '<div class="sub">' + CV.esc(CV.shortPath(node.full, 4)) + "</div>" : "") +
          '<div class="sub">' + CV.esc(sub) + "</div>" +
          '<div class="sub">依赖 ' + outs + " 出 / " + ins + " 入</div>";
        tipEl.style.borderColor = CV.rgba(groupColor(node.group), 0.55);
        tipEl.classList.add("show");
      }
      const maxW = state.width - 12;
      const maxH = state.height - 12;
      let x = sx + 14;
      let y = sy + 14;
      const tw = tipEl.offsetWidth;
      const th = tipEl.offsetHeight;
      if (x + tw > maxW) x = sx - tw - 14;
      if (y + th > maxH) y = sy - th - 14;
      tipEl.style.left = Math.max(6, x) + "px";
      tipEl.style.top = Math.max(6, y) + "px";
    }

    function zoomAt(px, py, factor) {
      const k = clamp(state.t.k * factor, 0.08, 3.5);
      const wx = (px - state.t.x) / state.t.k;
      const wy = (py - state.t.y) / state.t.k;
      state.t.k = k;
      state.t.x = px - wx * k;
      state.t.y = py - wy * k;
      state.userMoved = true;
    }

    function panBy(dx, dy) {
      if (state.dim3) {
        const basis = cameraBasis();
        const s = Math.max(0.05, state.cam.focal / state.cam.dist);
        state.cam.target.x += (-basis.right.x * dx + basis.up.x * dy) / s;
        state.cam.target.y += (-basis.right.y * dx + basis.up.y * dy) / s;
        state.cam.target.z += (-basis.right.z * dx + basis.up.z * dy) / s;
      } else {
        state.t.x += dx;
        state.t.y += dy;
      }
      state.userMoved = true;
    }

    function pointerPair() {
      const list = [];
      state.pointers.forEach(function (p) { list.push(p); });
      if (list.length < 2) return null;
      const a = list[0];
      const b = list[1];
      return {
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      };
    }

    function startPinch() {
      const pair = pointerPair();
      if (!pair) return;
      // 双指按下即进入缩放：取消单指拖拽，之后的抬起不再当作点击
      state.drag = null;
      state.hoverId = null;
      state.tipId = null;
      tipEl.classList.remove("show");
      state.pinch = {
        dist: pair.dist,
        k: state.t.k,
        camDist: state.cam.dist,
        w: {
          x: (pair.mid.x - state.t.x) / Math.max(0.001, state.t.k),
          y: (pair.mid.y - state.t.y) / Math.max(0.001, state.t.k),
        },
      };
    }

    function updatePinch() {
      const pair = pointerPair();
      if (!pair || !state.pinch) return;
      const pinch = state.pinch;
      const factor = clamp(pair.dist / pinch.dist, 0.2, 5);
      if (state.dim3) {
        state.cam.dist = clamp(pinch.camDist / factor, 320, 20000);
      } else {
        state.t.k = clamp(pinch.k * factor, 0.08, 3.5);
        state.t.x = pair.mid.x - pinch.w.x * state.t.k;
        state.t.y = pair.mid.y - pinch.w.y * state.t.k;
      }
      state.userMoved = true;
    }

    function onPointerDown(ev) {
      if (ev.button !== 0 && ev.button !== 2) return;
      const p = localPoint(ev);
      state.pointers.set(ev.pointerId, p);
      if (state.pointers.size === 1) state.suppressClick = false;
      try { canvas.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }

      if (state.pointers.size === 2) {
        startPinch();
        canvas.classList.remove("dv-grabbing");
        requestDraw();
        return;
      }
      if (state.pinch) return;

      ensureScreen();
      const hit = hitTest(p.x, p.y);
      const rightOrShift = ev.button === 2 || ev.shiftKey;

      if (state.dim3) {
        if (hit) {
          const proj = state.screen.get(hit.id);
          state.drag = {
            mode: "node3d", node: hit, sx: p.x, sy: p.y, moved: false,
            start: { x: hit.x, y: hit.y, z: hit.z },
            s: proj ? Math.max(0.05, proj.s) : 0.5,
          };
        } else if (rightOrShift) {
          state.drag = { mode: "pan3d", sx: p.x, sy: p.y, moved: false };
        } else {
          state.drag = { mode: "orbit", sx: p.x, sy: p.y, moved: false };
        }
      } else {
        if (hit) {
          state.drag = {
            mode: "node2d", node: hit, sx: p.x, sy: p.y, moved: false,
            ox: hit.x2, oy: hit.y2,
          };
        } else {
          state.drag = { mode: "pan2d", sx: p.x, sy: p.y, ox: state.t.x, oy: state.t.y, moved: false };
        }
      }

      canvas.classList.add("dv-grabbing");
      tipEl.classList.remove("show");
      requestDraw();
    }

    function onPointerMove(ev) {
      const p = localPoint(ev);
      if (state.pointers.has(ev.pointerId)) state.pointers.set(ev.pointerId, p);

      if (state.pinch) {
        if (state.pointers.size >= 2) {
          updatePinch();
          requestDraw();
          return;
        }
        state.pinch = null;
      }

      const d = state.drag;
      if (d) {
        if (Math.abs(p.x - d.sx) + Math.abs(p.y - d.sy) > 2) d.moved = true;
        const dx = p.x - d.sx;
        const dy = p.y - d.sy;
        if (d.mode === "orbit") {
          state.cam.yaw += dx * 0.006;
          state.cam.pitch = clamp(state.cam.pitch - dy * 0.006, -1.28, 1.28);
          d.sx = p.x; d.sy = p.y;
          state.userMoved = true;
        } else if (d.mode === "pan3d") {
          panBy(dx, dy);
          d.sx = p.x; d.sy = p.y;
        } else if (d.mode === "node3d") {
          const basis = cameraBasis();
          const s = d.s;
          d.node.x = d.start.x + (basis.right.x * dx - basis.up.x * dy) / s;
          d.node.y = d.start.y + (basis.right.y * dx - basis.up.y * dy) / s;
          d.node.z = d.start.z + (basis.right.z * dx - basis.up.z * dy) / s;
          state.userMoved = true;
        } else if (d.mode === "pan2d") {
          state.t.x = d.ox + dx;
          state.t.y = d.oy + dy;
          state.userMoved = true;
        } else if (d.mode === "node2d") {
          d.node.x2 = d.ox + dx / Math.max(0.05, state.t.k);
          d.node.y2 = d.oy + dy / Math.max(0.05, state.t.k);
          state.userMoved = true;
        }
        if (d.moved) {
          tipEl.classList.remove("show");
          state.tipId = null;
        }
        requestDraw();
        return;
      }

      const hit = hitTest(p.x, p.y);
      const id = hit ? hit.id : null;
      if (id !== state.hoverId) {
        state.hoverId = id;
        canvas.style.cursor = hit ? "pointer" : "grab";
      }
      showTip(hit, p.x, p.y);
      requestDraw();
    }

    function onPointerUp(ev) {
      state.pointers.delete(ev.pointerId);
      try { canvas.releasePointerCapture(ev.pointerId); } catch (err) { /* ignore */ }

      if (state.pinch) {
        // 双指缩放结束后不派发点击
        state.suppressClick = true;
        state.drag = null;
        if (state.pointers.size < 2) state.pinch = null;
        canvas.classList.remove("dv-grabbing");
        requestDraw();
        return;
      }

      const d = state.drag;
      state.drag = null;
      canvas.classList.remove("dv-grabbing");
      if (state.suppressClick) {
        if (!state.pointers.size) state.suppressClick = false;
        requestDraw();
        return;
      }
      if (d && !d.moved && (d.mode === "node3d" || d.mode === "node2d")) {
        onNodeClick(d.node);
      }
      requestDraw();
    }

    function onPointerLeave() {
      if (state.drag || state.pinch) return;
      state.hoverId = null;
      state.tipId = null;
      tipEl.classList.remove("show");
      requestDraw();
    }

    function onWheel(ev) {
      ev.preventDefault();
      const p = localPoint(ev);
      if (state.dim3) {
        state.cam.dist = clamp(state.cam.dist * Math.exp(ev.deltaY * 0.0012), 320, 20000);
        state.userMoved = true;
      } else {
        zoomAt(p.x, p.y, Math.exp(-ev.deltaY * 0.0014));
      }
      tipEl.classList.remove("show");
      state.tipId = null;
      requestDraw();
    }

    function openSelected() {
      const id = state.selectedId;
      if (!id) return;
      const node = state.nodeById.get(id);
      if (!node) return;
      if (node.kind === "module") {
        state.lastLevelChange = performance.now();
        go("file", node.id);
      } else {
        openSource(node.id);
      }
    }

    function deselect() {
      state.selectedId = null;
      state.panel = { kind: "overview", id: null };
      renderPanel();
      renderCrumbs();
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
    canvas.addEventListener("dblclick", function (ev) {
      ev.preventDefault();
      relayout();
      requestDraw();
    });
    canvas.addEventListener("keydown", function (ev) {
      const step = ev.shiftKey ? 16 : 48;
      let handled = true;
      switch (ev.key) {
        case "ArrowLeft": panBy(step, 0); break;
        case "ArrowRight": panBy(-step, 0); break;
        case "ArrowUp": panBy(0, step); break;
        case "ArrowDown": panBy(0, -step); break;
        case "+":
        case "=":
          if (state.dim3) state.cam.dist = clamp(state.cam.dist / 1.12, 320, 20000);
          else zoomAt(state.width / 2, state.height / 2, 1.12);
          state.userMoved = true;
          break;
        case "-":
        case "_":
          if (state.dim3) state.cam.dist = clamp(state.cam.dist * 1.12, 320, 20000);
          else zoomAt(state.width / 2, state.height / 2, 1 / 1.12);
          state.userMoved = true;
          break;
        case "Escape":
          deselect();
          break;
        case "Enter":
          openSelected();
          break;
        default:
          handled = false;
      }
      if (!handled) return;
      ev.preventDefault();
      requestDraw();
    });

    window.addEventListener("resize", function () {
      if (!state.active) return;
      state.screen = new Map();
      if (!state.userMoved) state.fitPending = true;
      requestDraw();
    });

    /* ==================== 绘制 ==================== */

    // 点阵预渲染成图案，只有 gap / dpr 变化时才重建
    let gridCache = null;

    function gridPattern(gap) {
      const dpr = state.dpr;
      const key = Math.round(gap * 100) / 100;
      if (gridCache && gridCache.gap === key && gridCache.dpr === dpr) return gridCache;
      const tile = document.createElement("canvas");
      const size = Math.max(6, Math.round(gap * dpr));
      tile.width = size;
      tile.height = size;
      const tctx = tile.getContext("2d");
      tctx.fillStyle = TH.grid;
      tctx.beginPath();
      tctx.arc(size / 2, size / 2, Math.max(0.8, dpr * 0.9), 0, TAU);
      tctx.fill();
      const pattern = pen.createPattern(tile, "repeat");
      if (!pattern) return null;
      gridCache = { gap: key, dpr: dpr, pattern: pattern, tileGap: size / dpr };
      return gridCache;
    }

    function drawBackdrop() {
      pen.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      const bg = pen.createLinearGradient(0, 0, state.width, state.height);
      bg.addColorStop(0, TH.bg0);
      bg.addColorStop(0.55, TH.bg1);
      bg.addColorStop(1, TH.bg2);
      pen.fillStyle = bg;
      pen.fillRect(0, 0, state.width, state.height);

      const gap = state.dim3 ? 46 : clamp(46 * state.t.k, 28, 72);
      if (gap < 16) return;
      const cache = gridPattern(gap);
      if (!cache) return;
      const g = cache.tileGap;
      const ox = state.dim3 ? 0 : ((state.t.x % g) + g) % g;
      const oy = state.dim3 ? 0 : ((state.t.y % g) + g) % g;
      // 图案按设备像素铺，避免被 dpr 变换二次放大
      pen.setTransform(1, 0, 0, 1, 0, 0);
      pen.save();
      pen.translate(Math.round(ox * state.dpr), Math.round(oy * state.dpr));
      pen.fillStyle = cache.pattern;
      pen.fillRect(0, 0, canvas.width, canvas.height);
      pen.restore();
      pen.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    }

    function drawFloor() {
      const nodes = state.nodes;
      if (!nodes.length) return;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
        if (n.z < minZ) minZ = n.z;
        if (n.z > maxZ) maxZ = n.z;
      }
      if (!Number.isFinite(minX)) return;
      const vp = viewport();
      const y = minY - 170;
      const x0 = minX - 160;
      const x1 = maxX + 160;
      const z0 = minZ - 160;
      const z1 = maxZ + 160;
      const N = 8;
      pen.strokeStyle = CV.rgba(TH.sub, 0.12);
      pen.lineWidth = 1;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const a = projectPoint(x0 + (x1 - x0) * t, y, z0, vp);
        const b = projectPoint(x0 + (x1 - x0) * t, y, z1, vp);
        if (a && b) {
          pen.beginPath(); pen.moveTo(a.x, a.y); pen.lineTo(b.x, b.y); pen.stroke();
        }
        const c = projectPoint(x0, y, z0 + (z1 - z0) * t, vp);
        const d = projectPoint(x1, y, z0 + (z1 - z0) * t, vp);
        if (c && d) {
          pen.beginPath(); pen.moveTo(c.x, c.y); pen.lineTo(d.x, d.y); pen.stroke();
        }
      }
    }

    function focusInfo() {
      const primary = state.hoverId || state.selectedId;
      if (!primary || !state.nodeById.has(primary)) return null;
      const nodes = new Set([primary]);
      const outs = state.outMap.get(primary) || [];
      const ins = state.inMap.get(primary) || [];
      for (let i = 0; i < outs.length; i++) nodes.add(outs[i].id);
      for (let i = 0; i < ins.length; i++) nodes.add(ins[i].id);
      if (state.selectedId && state.selectedId !== primary && state.nodeById.has(state.selectedId)) {
        nodes.add(state.selectedId);
      }
      return { id: primary, idSet: new Set([primary]), nodes: nodes };
    }

    function isActiveNode(n) {
      return n.id === state.hoverId || n.id === state.selectedId;
    }

    function isDimNode(n, focus, matches) {
      if (matches && !matches.has(n.id)) return true;
      if (focus && !focus.nodes.has(n.id)) return true;
      return false;
    }

    function drawArrow(x, y, angle, size, color) {
      pen.beginPath();
      pen.moveTo(x, y);
      pen.lineTo(x - Math.cos(angle - 0.42) * size, y - Math.sin(angle - 0.42) * size);
      pen.lineTo(x - Math.cos(angle + 0.42) * size, y - Math.sin(angle + 0.42) * size);
      pen.closePath();
      pen.fillStyle = color;
      pen.fill();
    }

    function drawEdges(focus, matches) {
      const screen = state.screen;
      const zr = state.zRange;
      // 稳定顺序直接绘制：不构造临时数组，也不再每帧排序
      for (let i = 0; i < state.edges.length; i++) {
        const e = state.edges[i];
        const a = screen.get(e.source);
        const b = screen.get(e.target);
        if (!a || !b) continue;
        const na = state.nodeById.get(e.source);
        if (!na) continue;

        const active = !!focus && (focus.idSet.has(e.source) || focus.idSet.has(e.target));
        let dim = false;
        if (focus && !active) dim = true;
        if (matches && !active && !(matches.has(e.source) && matches.has(e.target))) dim = true;

        const col = groupColor(na.group);
        let depth = 1;
        if (state.dim3) {
          depth = clamp(1.05 - (((a.zc + b.zc) / 2) - zr.min) / zr.span * 0.75, 0.22, 1);
        }
        const width = clamp(0.6 + Math.log2((e.weight || 1) + 1) * 0.5, 0.6, 2.8);

        pen.globalAlpha = dim
          ? (state.dim3 ? 0.10 : 0.12)
          : (state.dim3 ? 0.16 + depth * 0.55 : 0.58);
        pen.strokeStyle = active ? CV.rgba(col, 0.95) : CV.mix(col, TH.bg1, 0.18);
        pen.lineWidth = active ? 2.4 : width;
        if (active) {
          pen.shadowColor = CV.rgba(col, 0.30);
          pen.shadowBlur = 8;
        }

        if (state.dim3) {
          pen.beginPath();
          pen.moveTo(a.x, a.y);
          pen.lineTo(b.x, b.y);
          pen.stroke();
        } else {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const off = len * (e.bend || 0);
          const cx = (a.x + b.x) / 2 - (dy / len) * off;
          const cy = (a.y + b.y) / 2 + (dx / len) * off;
          pen.beginPath();
          pen.moveTo(a.x, a.y);
          pen.quadraticCurveTo(cx, cy, b.x, b.y);
          pen.stroke();

          const t = 0.88;
          const mt = 1 - t;
          const ax = mt * mt * a.x + 2 * mt * t * cx + t * t * b.x;
          const ay = mt * mt * a.y + 2 * mt * t * cy + t * t * b.y;
          const ang = Math.atan2(b.y - cy, b.x - cx);
          pen.shadowBlur = 0;
          drawArrow(ax, ay, ang, 6, CV.rgba(col, dim ? 0.24 : 0.78));
        }
        pen.shadowBlur = 0;
      }
      pen.globalAlpha = 1;
    }

    function drawNodeShape(n, p, now, active) {
      const col = groupColor(n.group);
      const r = p.r;
      if (r < 0.7) return;

      if (active) {
        // 选中 / 悬停的呼吸环用主题强调色，不再用节点本体色
        const pulse = 1 + Math.sin(now / 280) * 0.06;
        pen.beginPath();
        pen.arc(p.x, p.y, r * pulse + 7, 0, TAU);
        pen.strokeStyle = CV.rgba(TH.accent, 0.45);
        pen.lineWidth = 2;
        pen.stroke();
      }

      // 浅底上更友好的径向渐变：中心实、边缘淡化
      const grad = pen.createRadialGradient(
        p.x - r * 0.35, p.y - r * 0.4, Math.max(0.4, r * 0.12),
        p.x, p.y, Math.max(r, 0.5)
      );
      grad.addColorStop(0, CV.rgba(col, 0.95));
      grad.addColorStop(0.55, CV.rgba(col, 0.55));
      grad.addColorStop(1, CV.rgba(col, 0.18));
      pen.beginPath();
      pen.arc(p.x, p.y, r, 0, TAU);
      pen.fillStyle = grad;
      pen.fill();

      pen.lineWidth = active ? 1.8 : 1.1;
      pen.strokeStyle = CV.rgba(col, active ? 0.95 : 0.5);
      pen.stroke();

      if (r > 6) {
        pen.beginPath();
        pen.arc(p.x, p.y, Math.max(1.4, r * 0.15), 0, TAU);
        pen.fillStyle = "rgba(255,255,255,0.85)";
        pen.fill();
      }
    }

    function drawNodes(focus, matches, now) {
      for (let i = 0; i < state.nodes.length; i++) {
        const n = state.nodes[i];
        const p = state.screen.get(n.id);
        if (!p) continue;
        const active = isActiveNode(n);
        const dim = isDimNode(n, focus, matches) && !active;
        pen.globalAlpha = dim ? 0.2 : 1;
        drawNodeShape(n, p, now, active);
        pen.globalAlpha = 1;
      }
    }

    function drawPill(text, x, y, active, fontSize) {
      pen.font = (active ? "700 " : "600 ") + fontSize + "px " + FONT;
      const w = pen.measureText(text).width;
      const h = fontSize + 8;
      pen.fillStyle = active ? "rgba(255,255,255,0.97)" : "rgba(255,255,255,0.80)";
      CV.roundRect(pen, x - w / 2 - 7, y - h / 2, w + 14, h, 8);
      pen.fill();
      if (active) {
        pen.strokeStyle = CV.rgba(TH.accent, 0.55);
        pen.lineWidth = 1;
        pen.stroke();
      }
      pen.fillStyle = active ? TH.ink : TH.sub;
      pen.textAlign = "center";
      pen.textBaseline = "middle";
      pen.fillText(text, x, y + 0.5);
    }

    function drawLabels(focus, matches) {
      const items = [];
      for (let i = 0; i < state.nodes.length; i++) {
        const n = state.nodes[i];
        const p = state.screen.get(n.id);
        if (!p) continue;
        const active = isActiveNode(n);
        if (!active && isDimNode(n, focus, matches)) continue;
        if (p.x < -90 || p.x > state.width + 90 || p.y < -70 || p.y > state.height + 70) continue;
        items.push({ n: n, p: p, active: active });
      }
      if (!items.length) return;

      items.sort(function (a, b) {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (b.p.r !== a.p.r) return b.p.r - a.p.r;
        return state.dim3 ? a.p.zc - b.p.zc : a.p.y - b.p.y;
      });

      const placed = [];
      let count = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.active && count >= 240) break;
        const fs = item.n.kind === "module" ? 12.5 : 12;
        pen.font = (item.active ? "700 " : "600 ") + fs + "px " + FONT;
        const text = CV.ellipsize(pen, item.n.label, 170);
        const w = pen.measureText(text).width + 14;
        const h = fs + 8;
        const x = item.p.x;
        const y = item.p.y + item.p.r + h / 2 + 5;
        const rect = { x: x - w / 2, y: y - h / 2, w: w, h: h };
        if (!item.active && placed.some(function (q) { return overlapRect(q, rect); })) continue;
        placed.push(rect);
        drawPill(text, x, y, item.active, fs);
        count++;
      }
    }

    function draw(now) {
      const resized = ensureSize();
      if (!state.width || !state.height) return;
      if (resized) {
        if (state.dim3 ? !state.camInit : !state.userMoved) state.fitPending = true;
      }
      if (state.fitPending) {
        fitView();
        state.fitPending = false;
      }
      computeScreen();

      drawBackdrop();
      if (state.dim3) drawFloor();

      const focus = focusInfo();
      const matches = searchSet();

      drawEdges(focus, matches);
      drawNodes(focus, matches, now);
      drawLabels(focus, matches);
    }

    /* ==================== 生命周期 ==================== */

    // 单帧合并：任何交互只登记一次 rAF，空闲时完全不跑循环
    function requestDraw() {
      if (!state.active || state.raf) return;
      state.raf = requestAnimationFrame(frame);
    }

    // 仅当有悬停 / 选中节点，且系统未要求减少动态效果时，才继续跑脉冲
    function needsPulse() {
      return !!((state.hoverId || state.selectedId) && !CV.prefersReducedMotion());
    }

    function frame(now) {
      state.raf = 0;
      if (!state.active) return;
      try {
        draw(now);
      } catch (err) {
        console.error("[codeviz] deps draw failed:", err);
      }
      if (needsPulse()) state.raf = requestAnimationFrame(frame);
    }

    function activate(params) {
      const p = (params && typeof params.get === "function") ? params : new URLSearchParams();
      const levelParam = p.get("level");
      let level = levelParam === "file" ? "file" : "module";
      let moduleId = level === "file" ? p.get("module") : null;

      if (moduleId) {
        moduleId = String(moduleId);
        if (!moduleById.has(moduleId)) {
          if (state.built) toast("未找到模块：" + moduleId);
          moduleId = null;
          level = "module";
        }
      }

      const changed = level !== state.level || moduleId !== state.moduleId || !state.built;
      state.level = level;
      state.moduleId = moduleId;
      state.lastLevelChange = performance.now();

      const dimParam = p.get("dim");
      if (dimParam === "2d" && state.dim3) {
        state.dim3 = false;
        state.camInit = false;
        state.fitPending = true;
        state.screen = new Map();
      } else if (dimParam === "3d" && !state.dim3) {
        state.dim3 = true;
        state.fitPending = true;
        state.screen = new Map();
      }

      state.active = true;
      ensureSize();
      if (changed) {
        rebuild();
      } else {
        renderCrumbs();
        updateToolbar();
        updateEmpty();
        updateHint();
      }
      updateToolbar();
      requestDraw();
    }

    function deactivate() {
      state.active = false;
      if (state.raf) {
        cancelAnimationFrame(state.raf);
        state.raf = 0;
      }
      state.drag = null;
      state.pointers.clear();
      state.pinch = null;
      state.suppressClick = false;
      state.hoverId = null;
      state.tipId = null;
      tipEl.classList.remove("show");
      canvas.classList.remove("dv-grabbing");
    }

    // 初始面板（activate 之前也能看到内容）
    renderOverview();
    renderCrumbs();
    updateToolbar();
    updateLegend();
    updateHint();
    updateEmpty();

    return { activate: activate, deactivate: deactivate };
  }

  window.CodeViz.registerView("deps", createDepsView);
})();
