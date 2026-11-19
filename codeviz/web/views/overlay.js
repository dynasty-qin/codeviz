(function () {
  "use strict";

  // 覆盖层视图：渲染 data.overlays 中配置的 layers（分层卡片）或 image（架构图）。
  // 纯 DOM 实现，可深链：#overlay/<id> 或 #overlay?id=<id>。
  // 配色全部走 styles.css 的浅色 token，保证与站点其余部分一致。

  const STYLE = `
.cvo-root {
  position: absolute; inset: 0; overflow: auto;
  padding: 24px 26px 64px;
}
.cvo-inner { max-width: 1360px; margin: 0 auto; }
.cvo-head { margin: 0 0 18px; }
.cvo-kicker {
  font-size: 12px; letter-spacing: 1.4px; text-transform: uppercase;
  color: var(--accent, #2f7a68); font-weight: 600;
}
.cvo-head h2 {
  margin: 6px 0 0; font-size: 20px; line-height: 1.35;
  color: var(--ink, #24302c); letter-spacing: .2px;
}
.cvo-sub { margin: 6px 0 0; font-size: 12.5px; color: var(--sub, #5f6f69); line-height: 1.7; }
.cvo-desc {
  margin: 8px 0 0; font-size: 13px; color: var(--ink, #24302c);
  line-height: 1.75; max-width: 86ch;
}
.cvo-desc[hidden], .cvo-sub[hidden] { display: none; }
.cvo-layer {
  background: var(--panel, #ffffff); border: 1px solid var(--line, #e3e7e1);
  border-radius: 14px; padding: 15px 16px 17px;
  box-shadow: 0 8px 24px rgba(31, 42, 38, .06);
}
.cvo-layer-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 12px; }
.cvo-step {
  font-size: 12px; line-height: 1.5; color: var(--accent, #2f7a68);
  background: var(--accent-soft, rgba(47, 122, 104, .12));
  border: 1px solid rgba(47, 122, 104, .22); border-radius: 20px;
  padding: 1px 9px; letter-spacing: .5px; font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.cvo-layer-head h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--ink, #24302c); letter-spacing: .2px; }
.cvo-layer-sub { flex-basis: 100%; font-size: 12.5px; color: var(--sub, #5f6f69); line-height: 1.65; }
.cvo-count { margin-left: auto; font-size: 12px; color: var(--sub, #5f6f69); white-space: nowrap; }
.cvo-cards { display: grid; gap: 10px; grid-template-columns: repeat(var(--cvo-cols, 3), minmax(0, 1fr)); }
.cvo-card {
  background: var(--panel-2, #fbfcfa); border: 1px solid var(--line, #e3e7e1);
  border-left: 3px solid var(--cvo-item, var(--line, #e3e7e1));
  border-radius: 10px; padding: 11px 12px; min-height: 56px;
  display: flex; flex-direction: column; gap: 6px; min-width: 0;
  transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease;
}
.cvo-card:hover {
  border-color: rgba(47, 122, 104, .32);
  box-shadow: 0 4px 14px rgba(31, 42, 38, .08);
  transform: translateY(-1px);
}
.cvo-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.cvo-card b { font-size: 13px; font-weight: 600; color: var(--ink, #24302c); word-break: break-word; }
.cvo-card-desc { font-size: 12.5px; color: var(--sub, #5f6f69); line-height: 1.6; word-break: break-word; }
.cvo-tag {
  flex: none; font-size: 12px; line-height: 1.5; padding: 1px 8px;
  border-radius: 20px; white-space: nowrap;
  color: var(--cvo-item, var(--accent, #2f7a68));
  background: var(--cvo-item-soft, var(--accent-soft, rgba(47, 122, 104, .12)));
  border: 1px solid var(--cvo-item-line, rgba(47, 122, 104, .22));
}
.cvo-flow { display: flex; flex-direction: column; align-items: center; height: 32px; justify-content: center; }
.cvo-flow i {
  display: block; width: 2px; height: 14px;
  background: linear-gradient(180deg, rgba(47, 122, 104, .08), rgba(47, 122, 104, .45));
}
.cvo-flow u {
  display: block; width: 0; height: 0; margin-top: -1px;
  border-left: 6px solid transparent; border-right: 6px solid transparent;
  border-top: 8px solid rgba(47, 122, 104, .5);
}
.cvo-figure { margin: 0; display: flex; flex-direction: column; gap: 10px; }
.cvo-zoom {
  display: block; width: 100%; padding: 0; margin: 0;
  border: 1px solid var(--line, #e3e7e1); border-radius: 12px;
  background: var(--panel, #ffffff); cursor: zoom-in;
  overflow: hidden; box-shadow: 0 8px 24px rgba(31, 42, 38, .08);
  transition: box-shadow .15s ease, border-color .15s ease;
}
.cvo-zoom:hover { border-color: rgba(47, 122, 104, .35); }
.cvo-zoom img { display: block; width: 100%; max-width: 100%; height: auto; }
.cvo-zoom.zoomed {
  cursor: zoom-out; overflow: visible; border-color: transparent;
  background: transparent; box-shadow: none;
}
.cvo-zoom.zoomed img {
  width: auto; max-width: none; border: 1px solid var(--line, #e3e7e1);
  border-radius: 12px; background: var(--panel, #ffffff);
  box-shadow: 0 10px 30px rgba(31, 42, 38, .14);
}
.cvo-figure figcaption { font-size: 12px; color: var(--sub, #5f6f69); line-height: 1.7; word-break: break-word; }
.cvo-figure figcaption code {
  font-family: ${(window.CV && window.CV.MONO) || 'Consolas, "Cascadia Code", "Courier New", monospace'};
  font-size: 12px; color: var(--ink, #24302c);
}
.cvo-empty {
  display: flex; flex-direction: column; gap: 12px; align-items: flex-start;
  color: var(--sub, #5f6f69); font-size: 12.5px; padding: 22px;
  border: 1px dashed rgba(36, 48, 44, .18); border-radius: 14px;
  background: var(--panel-2, #fbfcfa); line-height: 1.7;
}
.cvo-empty h3 { margin: 0; font-size: 14px; color: var(--ink, #24302c); }
.cvo-empty .chips { flex-direction: row; flex-wrap: wrap; gap: 8px; }
.cvo-empty .chip { display: inline-flex; gap: 6px; padding: 6px 10px; }
@media (max-width: 980px) {
  .cvo-root { padding: 18px 16px 48px; }
  .cvo-cards { grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); }
  .cvo-head h2 { font-size: 18px; }
}
@media (prefers-reduced-motion: reduce) {
  .cvo-card, .cvo-zoom { transition: none; }
  .cvo-card:hover { transform: none; }
}
`;

  const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  function safeColor(value) {
    if (typeof value !== "string") return "";
    const color = value.trim();
    return COLOR_RE.test(color) ? color : "";
  }

  function clampInt(v, min, max, fallback) {
    const n = Math.floor(Number(v));
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function rgba(color, alpha) {
    if (window.CV && typeof window.CV.rgba === "function") return window.CV.rgba(color, alpha);
    return "rgba(47, 122, 104, " + alpha + ")";
  }

  function applyItemColor(el, color) {
    if (!color) return;
    el.style.setProperty("--cvo-item", color);
    el.style.setProperty("--cvo-item-soft", rgba(color, 0.10));
    el.style.setProperty("--cvo-item-line", rgba(color, 0.24));
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
    subEl.className = "cvo-sub";
    const descEl = document.createElement("p");
    descEl.className = "cvo-desc";
    descEl.hidden = true;
    head.appendChild(kicker);
    head.appendChild(titleEl);
    head.appendChild(subEl);
    head.appendChild(descEl);
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

    function setHead(title, subtitle, desc) {
      titleEl.textContent = title || "";
      subEl.textContent = subtitle || "";
      subEl.hidden = !subtitle;
      descEl.textContent = desc || "";
      descEl.hidden = !desc;
    }

    function renderEmpty(title, text, extraNodes) {
      setHead(title, "", "");
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
      btn.textContent = o.title || o.id;
      btn.addEventListener("click", () => {
        if (ctx.router && typeof ctx.router.go === "function") {
          ctx.router.go("overlay/" + encodeURIComponent(o.id));
        } else {
          location.hash = "#overlay/" + encodeURIComponent(o.id);
        }
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
        if (layer.subtitle) {
          const sub = document.createElement("div");
          sub.className = "cvo-layer-sub";
          sub.textContent = layer.subtitle;
          layerHead.appendChild(sub);
        }
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
            const color = safeColor(item.color);
            applyItemColor(card, color);

            const cardHead = document.createElement("div");
            cardHead.className = "cvo-card-head";
            const b = document.createElement("b");
            b.textContent = item.title || "未命名";
            cardHead.appendChild(b);
            if (item.tag) {
              const tag = document.createElement("span");
              tag.className = "cvo-tag";
              tag.textContent = item.tag;
              cardHead.appendChild(tag);
            }
            card.appendChild(cardHead);
            if (item.desc) {
              const span = document.createElement("span");
              span.className = "cvo-card-desc";
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

      const zoom = document.createElement("button");
      zoom.type = "button";
      zoom.className = "cvo-zoom";
      zoom.setAttribute("aria-pressed", "false");
      zoom.setAttribute("aria-label", "放大图片");

      const img = document.createElement("img");
      img.src = String(overlay.image);
      img.alt = overlay.title || overlay.id || "架构图";
      img.loading = "lazy";
      zoom.appendChild(img);

      const caption = document.createElement("figcaption");
      const code = document.createElement("code");
      code.textContent = String(overlay.image);
      caption.appendChild(code);
      caption.appendChild(document.createTextNode(" · 点击图片或按 Enter 放大 / 还原"));
      figure.appendChild(zoom);
      figure.appendChild(caption);
      body.appendChild(figure);

      function setZoomed(on) {
        zoom.classList.toggle("zoomed", on);
        zoom.setAttribute("aria-pressed", on ? "true" : "false");
        zoom.setAttribute("aria-label", on ? "还原图片" : "放大图片");
      }
      zoom.addEventListener("click", () => {
        setZoomed(!zoom.classList.contains("zoomed"));
      });

      img.addEventListener("error", () => {
        figure.innerHTML = "";
        const note = document.createElement("div");
        note.className = "cvo-empty";
        const h3 = document.createElement("h3");
        h3.textContent = "图片加载失败";
        const span = document.createElement("span");
        span.textContent = "找不到 " + overlay.image +
          "。请确认构建时已把该图片拷贝到输出目录（overlays[].image 为输出目录内的相对路径）。";
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

      const type = String(overlay.type || "layers");
      setHead(
        overlay.title || overlay.id || "覆盖层",
        overlay.subtitle || "",
        overlay.desc || ""
      );
      kicker.textContent = "覆盖层 · " + type + (overlay.id ? " · " + overlay.id : "");

      if (type === "layers") renderLayers(overlay);
      else if (type === "image") renderImage(overlay);
      else renderEmpty(overlay.title || overlay.id || "覆盖层", "不支持的覆盖层类型：" + type + "（仅支持 layers / image）。");
    }

    if (!overlays.length) {
      renderEmpty("没有配置覆盖层", "当前项目（或者说这份 codeviz/v1 数据）没有 overlays。");
    }

    function activate(params) {
      render(resolveId(params));
      root.scrollTop = 0;
    }

    function deactivate() {
      // 覆盖层没有画布/计时器，无需清理状态。
    }

    return { activate, deactivate };
  });
})();
