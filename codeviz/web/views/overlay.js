(function () {
  "use strict";

  // 覆盖层视图：渲染 data.overlays 中配置的 layers（分层卡片）或 image（架构图）。
  // 纯 DOM 实现，可深链：#overlay/<id> 或 #overlay?id=<id>。

  const STYLE = `
.cvo-root {
  position: absolute; inset: 0; overflow: auto;
  padding: 24px 26px 64px;
}
.cvo-inner { max-width: 1360px; margin: 0 auto; }
.cvo-head { margin: 0 0 20px; }
.cvo-kicker {
  font-size: 10px; letter-spacing: 1.6px; text-transform: uppercase;
  color: #38bdf8; opacity: .85;
}
.cvo-head h2 { margin: 7px 0 0; font-size: 21px; line-height: 1.35; letter-spacing: .2px; }
.cvo-head p { margin: 7px 0 0; font-size: 12.5px; color: var(--sub); line-height: 1.7; }
.cvo-layer {
  background: linear-gradient(180deg, rgba(17, 26, 43, 0.88), rgba(11, 17, 30, 0.72));
  border: 1px solid var(--line); border-radius: 16px;
  padding: 15px 16px 17px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
}
.cvo-layer-head { display: flex; align-items: center; gap: 10px; margin: 0 0 13px; }
.cvo-step {
  font-size: 10px; color: #7dd3fc; background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.28); border-radius: 20px;
  padding: 3px 9px; letter-spacing: .5px; font-variant-numeric: tabular-nums;
}
.cvo-layer-head h3 { margin: 0; font-size: 13.5px; font-weight: 600; letter-spacing: .2px; }
.cvo-count { margin-left: auto; font-size: 10.5px; color: var(--sub); white-space: nowrap; }
.cvo-cards { display: grid; gap: 10px; grid-template-columns: repeat(var(--cvo-cols, 3), minmax(0, 1fr)); }
.cvo-card {
  background: rgba(148, 163, 184, 0.06); border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 11px; padding: 11px 12px; min-height: 58px;
  display: flex; flex-direction: column; gap: 5px; min-width: 0;
  transition: border-color .15s ease, background .15s ease, transform .15s ease;
}
.cvo-card:hover {
  border-color: rgba(56, 189, 248, 0.4); background: rgba(56, 189, 248, 0.1);
  transform: translateY(-1px);
}
.cvo-card b { font-size: 12px; font-weight: 600; color: #e8f1ff; word-break: break-word; }
.cvo-card span { font-size: 10.5px; color: var(--sub); line-height: 1.55; word-break: break-word; }
.cvo-flow { display: flex; flex-direction: column; align-items: center; height: 34px; justify-content: center; }
.cvo-flow i { display: block; width: 2px; height: 15px; background: linear-gradient(180deg, rgba(56, 189, 248, 0.06), rgba(56, 189, 248, 0.5)); }
.cvo-flow u {
  display: block; width: 0; height: 0; margin-top: -1px;
  border-left: 6px solid transparent; border-right: 6px solid transparent;
  border-top: 8px solid rgba(56, 189, 248, 0.55);
}
.cvo-figure { margin: 0; display: flex; flex-direction: column; gap: 10px; }
.cvo-figure img {
  max-width: 100%; height: auto; border-radius: 14px;
  border: 1px solid var(--line); background: #060a12; cursor: zoom-in;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.4); display: block;
}
.cvo-figure img.zoomed { max-width: none; cursor: zoom-out; }
.cvo-figure figcaption { font-size: 11px; color: var(--sub); }
.cvo-empty {
  display: flex; flex-direction: column; gap: 12px; align-items: flex-start;
  color: var(--sub); font-size: 12.5px; padding: 24px;
  border: 1px dashed rgba(148, 163, 184, 0.22); border-radius: 14px;
  background: rgba(148, 163, 184, 0.03); line-height: 1.7;
}
.cvo-empty h3 { margin: 0; font-size: 14px; color: var(--ink); }
.cvo-empty .chips { flex-direction: row; flex-wrap: wrap; gap: 8px; }
.cvo-empty .chip { padding: 6px 10px; }
@media (max-width: 980px) {
  .cvo-root { padding: 18px 16px 48px; }
  .cvo-cards { grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); }
  .cvo-head h2 { font-size: 18px; }
}
`;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function clampInt(v, min, max, fallback) {
    const n = Math.floor(Number(v));
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  window.CodeViz.registerView("overlay", function (ctx) {
    const data = (ctx && ctx.data) || {};
    const overlays = Array.isArray(data.overlays) ? data.overlays.filter(Boolean) : [];
    const container = ctx.container;
    if (!container) return { activate() {}, deactivate() {} };

    container.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = STYLE;
    container.appendChild(style);

    const root = document.createElement("div");
    root.className = "cvo-root";
    const inner = document.createElement("div");
    inner.className = "cvo-inner";
    const head = document.createElement("header");
    head.className = "cvo-head";
    const kicker = document.createElement("div");
    kicker.className = "cvo-kicker";
    const titleEl = document.createElement("h2");
    const subEl = document.createElement("p");
    head.appendChild(kicker);
    head.appendChild(titleEl);
    head.appendChild(subEl);
    const body = document.createElement("div");
    body.className = "cvo-body";
    inner.appendChild(head);
    inner.appendChild(body);
    root.appendChild(inner);
    container.appendChild(root);

    const byId = new Map();
    for (const o of overlays) {
      if (o && o.id) byId.set(String(o.id), o);
    }

    let visible = false;

    function parseHashId() {
      const hash = String(location.hash || "").replace(/^#/, "");
      const m = hash.match(/^overlay\/([^?]+)/);
      if (!m) return "";
      try {
        return decodeURIComponent(m[1]);
      } catch (e) {
        return m[1];
      }
    }

    function resolveId(params) {
      const fromParams = params && typeof params.get === "function" ? params.get("id") : "";
      if (fromParams) return String(fromParams);
      return parseHashId();
    }

    function renderEmpty(title, text, extraNodes) {
      titleEl.textContent = title;
      subEl.textContent = "";
      kicker.textContent = "覆盖层";
      body.innerHTML = "";
      const box = document.createElement("div");
      box.className = "cvo-empty";
      const p = document.createElement("span");
      p.textContent = text;
      box.appendChild(p);
      if (extraNodes && extraNodes.length) {
        const chips = document.createElement("div");
        chips.className = "chips";
        for (const node of extraNodes) chips.appendChild(node);
        box.appendChild(chips);
      }
      body.appendChild(box);
    }

    function overlayChip(o) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.style.border = "1px solid rgba(56,189,248,0.15)";
      btn.textContent = o.title || o.id;
      btn.addEventListener("click", () => {
        if (ctx.router && typeof ctx.router.go === "function") ctx.router.go("overlay/" + encodeURIComponent(o.id));
        else location.hash = "#overlay/" + encodeURIComponent(o.id);
      });
      return btn;
    }

    function renderLayers(overlay) {
      const layers = Array.isArray(overlay.layers) ? overlay.layers.filter(Boolean) : [];
      if (!layers.length) {
        renderEmpty(overlay.title || overlay.id || "覆盖层", "该覆盖层类型为 layers，但没有配置任何层（layers 为空）。");
        return;
      }
      body.innerHTML = "";
      layers.forEach((layer, index) => {
        const section = document.createElement("section");
        section.className = "cvo-layer";

        const layerHead = document.createElement("div");
        layerHead.className = "cvo-layer-head";
        const step = document.createElement("span");
        step.className = "cvo-step";
        step.textContent = "L" + (index + 1);
        const h3 = document.createElement("h3");
        h3.textContent = layer.title || "第 " + (index + 1) + " 层";
        const count = document.createElement("span");
        count.className = "cvo-count";
        const items = Array.isArray(layer.items) ? layer.items.filter(Boolean) : [];
        count.textContent = items.length + " 项";
        layerHead.appendChild(step);
        layerHead.appendChild(h3);
        layerHead.appendChild(count);
        section.appendChild(layerHead);

        const grid = document.createElement("div");
        grid.className = "cvo-cards";
        const cols = clampInt(layer.columns, 1, 8, Math.min(4, Math.max(1, items.length)));
        grid.style.setProperty("--cvo-cols", String(cols));
        if (!items.length) {
          const empty = document.createElement("span");
          empty.className = "empty";
          empty.textContent = "（该层暂无内容）";
          grid.appendChild(empty);
        } else {
          for (const item of items) {
            const card = document.createElement("div");
            card.className = "cvo-card";
            const b = document.createElement("b");
            b.textContent = item.title || "未命名";
            card.appendChild(b);
            if (item.desc) {
              const span = document.createElement("span");
              span.textContent = item.desc;
              card.appendChild(span);
            }
            grid.appendChild(card);
          }
        }
        section.appendChild(grid);
        body.appendChild(section);

        if (index < layers.length - 1) {
          const flow = document.createElement("div");
          flow.className = "cvo-flow";
          flow.setAttribute("aria-hidden", "true");
          const line = document.createElement("i");
          const arrow = document.createElement("u");
          flow.appendChild(line);
          flow.appendChild(arrow);
          body.appendChild(flow);
        }
      });
    }

    function renderImage(overlay) {
      if (!overlay.image) {
        renderEmpty(overlay.title || overlay.id || "覆盖层", "该覆盖层类型为 image，但没有配置图片路径（image 字段缺失）。");
        return;
      }
      body.innerHTML = "";
      const figure = document.createElement("figure");
      figure.className = "cvo-figure";
      const img = document.createElement("img");
      img.src = String(overlay.image);
      img.alt = overlay.title || overlay.id || "架构图";
      img.loading = "lazy";
      const caption = document.createElement("figcaption");
      caption.textContent = (overlay.title || "") + (overlay.image ? " · " + overlay.image : "");
      figure.appendChild(img);
      figure.appendChild(caption);
      body.appendChild(figure);

      img.addEventListener("click", () => img.classList.toggle("zoomed"));
      img.addEventListener("error", () => {
        figure.innerHTML = "";
        const note = document.createElement("div");
        note.className = "cvo-empty";
        const h3 = document.createElement("h3");
        h3.textContent = "图片加载失败";
        const span = document.createElement("span");
        span.textContent = "找不到 " + overlay.image + "。请确认构建时已把该图片拷贝到输出目录（overlays[].image 为输出目录内的相对路径）。";
        note.appendChild(h3);
        note.appendChild(span);
        figure.appendChild(note);
      });
    }

    function lookup(id) {
      if (!id) return null;
      if (byId.has(id)) return byId.get(id);
      try {
        const decoded = decodeURIComponent(id);
        if (decoded !== id && byId.has(decoded)) return byId.get(decoded);
      } catch (e) { /* 非法转义，按原样处理 */ }
      return null;
    }

    function render(id) {
      const overlay = lookup(id);
      if (!overlays.length) {
        renderEmpty("没有配置覆盖层", "当前项目（或者说这份 codeviz/v1 数据）没有 overlays。可在目标项目的 codeviz.json 中追加 overlays 配置后重新构建。");
        return;
      }
      if (!id) {
        // 没带 id 时展示第一个，保持与顶部 tab 行为一致。
        const first = overlays.find(o => o && o.id);
        if (first) {
          render(first.id);
        } else {
          renderEmpty("覆盖层缺少 id", "data.overlays 里没有带 id 的覆盖层，无法生成深链。");
        }
        return;
      }
      if (!overlay) {
        renderEmpty(
          "覆盖层「" + id + "」不存在",
          "可用的覆盖层如下，点击可跳转：",
          overlays.filter(o => o && o.id).map(overlayChip)
        );
        return;
      }

      titleEl.textContent = overlay.title || overlay.id || "覆盖层";
      subEl.textContent = overlay.subtitle || "";
      const type = String(overlay.type || "layers");
      kicker.textContent = "覆盖层 · " + type + (overlay.id ? " · " + overlay.id : "");

      if (type === "layers") renderLayers(overlay);
      else if (type === "image") renderImage(overlay);
      else renderEmpty(overlay.title || overlay.id || "覆盖层", "不支持的覆盖层类型：" + type + "（仅支持 layers / image）。");
    }

    if (!overlays.length) {
      renderEmpty("没有配置覆盖层", "当前项目（或者说这份 codeviz/v1 数据）没有 overlays。");
    }

    root.scrollTop = 0;

    function activate(params) {
      visible = true;
      const id = resolveId(params);
      render(id);
      root.scrollTop = 0;
    }

    function deactivate() {
      visible = false;
    }

    return { activate, deactivate };
  });
})();
