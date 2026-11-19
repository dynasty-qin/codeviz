/*
 * codeviz shared helpers, light-theme tokens and the early view registry.
 *
 * Loaded right after assets/data.js and before every view.  Views must use
 * these helpers instead of re-implementing esc()/clamp()/rgba()/roundRect().
 * Keep the palette in sync with the CSS custom properties in styles.css.
 */
(function () {
  "use strict";

  const theme = {
    bg0: "#f7f8f4",
    bg1: "#eef2ea",
    bg2: "#e6ece2",
    grid: "rgba(36, 48, 44, 0.10)",
    ink: "#24302c",
    sub: "#5f6f69",
    accent: "#2f7a68",
    accentSoft: "rgba(47, 122, 104, 0.12)",
    panel: "#ffffff",
    line: "rgba(36, 48, 44, 0.12)",
    tipBg: "rgba(255, 255, 255, 0.98)",
    shadow: "rgba(31, 42, 38, 0.14)",
    node: "#5f6f69",
    palette: [
      "#2f7a68", "#3b6ea5", "#b45309", "#7c5cbf", "#b3496b",
      "#0e7490", "#4d7c0f", "#8a5a2b", "#475569", "#7a6a53",
    ],
    scale: ["#4d7c0f", "#c2830a", "#b3261e"],
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      }[char];
    });
  }

  function clamp(value, min, max) {
    return value < min ? min : (value > max ? max : value);
  }

  function num(value, fallback) {
    const parsed = Number(value);
    if (!isFinite(parsed)) return fallback == null ? 0 : fallback;
    return parsed;
  }

  const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  function parseHex(color) {
    const match = HEX.exec(String(color == null ? "" : color).trim());
    if (!match) return null;
    let body = match[1];
    if (body.length === 3) {
      body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
    }
    return parseInt(body, 16);
  }

  function rgba(color, alpha) {
    const value = parseHex(color);
    if (value == null) return "rgba(95, 111, 105, " + alpha + ")";
    return "rgba(" + ((value >> 16) & 255) + ", " + ((value >> 8) & 255) + ", " +
      (value & 255) + ", " + alpha + ")";
  }

  function mix(colorA, colorB, amount) {
    const a = parseHex(colorA);
    const b = parseHex(colorB);
    if (a == null || b == null) return colorA;
    const t = clamp(Number(amount) || 0, 0, 1);
    const channel = function (shift) {
      const left = (a >> shift) & 255;
      const right = (b >> shift) & 255;
      return Math.round(left + (right - left) * t);
    };
    return "#" + [16, 8, 0].map(function (shift) {
      return channel(shift).toString(16).padStart(2, "0");
    }).join("");
  }

  function tint(color, amount) {
    return mix(color, "#ffffff", amount);
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function basename(path) {
    const text = String(path == null ? "" : path);
    const parts = text.split(/[\\/]/);
    return parts[parts.length - 1] || text;
  }

  function shortPath(path, keep) {
    const count = keep || 3;
    const text = String(path == null ? "" : path).replace(/\\/g, "/");
    const parts = text.split("/");
    return parts.length > count + 1 ? "…/" + parts.slice(-count).join("/") : text;
  }

  function hashStr(value) {
    let hash = 5381;
    const text = String(value);
    for (let i = 0; i < text.length; i++) hash = (hash * 33 + text.charCodeAt(i)) | 0;
    return Math.abs(hash);
  }

  function ellipsize(ctx, text, maxWidth) {
    const value = String(text == null ? "" : text);
    if (ctx.measureText(value).width <= maxWidth) return value;
    let cut = value;
    while (cut.length > 1 && ctx.measureText(cut + "…").width > maxWidth) {
      cut = cut.slice(0, -1);
    }
    return cut + "…";
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  window.CV = {
    theme: theme,
    FONT: '"Microsoft YaHei","PingFang SC",system-ui,-apple-system,"Segoe UI",sans-serif',
    MONO: 'Consolas,"Cascadia Code","Courier New",monospace',
    esc: esc,
    clamp: clamp,
    num: num,
    toNum: num,
    rgba: rgba,
    mix: mix,
    tint: tint,
    roundRect: roundRect,
    basename: basename,
    shortPath: shortPath,
    hashStr: hashStr,
    ellipsize: ellipsize,
    prefersReducedMotion: prefersReducedMotion,
  };
  window.CVTheme = theme;

  // Early registry: views load before app.js, which adopts this queue.
  const registry = window.CodeViz || {};
  if (!Array.isArray(registry._pending)) registry._pending = [];
  if (typeof registry.registerView !== "function") {
    registry.registerView = function (name, factory) {
      registry._pending.push([name, factory]);
    };
  }
  window.CodeViz = registry;
})();
