(function () {
  "use strict";

  const DATA = window.CODEVIZ_DATA || {
    schema: "codeviz/v1",
    project: { name: "codeviz" },
    modules: [],
    moduleEdges: [],
    files: [],
    fileEdges: [],
    symbols: [],
    calls: [],
    entries: [],
    overlays: [],
  };

  const views = new Map();
  const instances = new Map();
  const roots = new Map();
  const tabButtons = new Map();
  let current = null;
  let toastTimer = null;

  const viewRoot = document.getElementById("view-root");
  const tabsEl = document.getElementById("tabs");
  const toastEl = document.getElementById("toast");
  const hintEl = document.getElementById("global-hint");

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  function overlayList() {
    return Array.isArray(DATA.overlays) ? DATA.overlays : [];
  }

  function buildTabs() {
    const fixed = [
      ["deps", "系统依赖"],
      ["calls", "调用链"],
      ["complexity", "复杂度"],
    ];
    const overlays = overlayList();
    const all = [...fixed, ...(overlays.length ? [["__sep__", ""]] : []),
      ...overlays.map(o => ["overlay/" + o.id, o.title || o.id])];

    tabsEl.innerHTML = "";
    for (const [route, label] of all) {
      if (route === "__sep__") {
        const sep = document.createElement("span");
        sep.className = "sep";
        tabsEl.appendChild(sep);
        continue;
      }
      const btn = document.createElement("button");
      btn.className = "tab";
      btn.dataset.route = route;
      btn.textContent = label;
      btn.addEventListener("click", () => router.go(route));
      tabsEl.appendChild(btn);
      tabButtons.set(route, btn);
    }
  }

  function parseHash() {
    const raw = (location.hash || "").replace(/^#/, "");
    if (!raw) return { route: "deps", params: new URLSearchParams() };
    const qIndex = raw.indexOf("?");
    const route = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
    const qs = qIndex >= 0 ? raw.slice(qIndex + 1) : "";
    return { route, params: new URLSearchParams(qs) };
  }

  function routeName(route) {
    return route.startsWith("overlay/") ? "overlay" : route;
  }

  function ensureRoot(name) {
    if (roots.has(name)) return roots.get(name);
    const el = document.createElement("section");
    el.className = "view-root";
    el.dataset.view = name;
    viewRoot.appendChild(el);
    roots.set(name, el);
    return el;
  }

  function ensureInstance(name, params) {
    if (instances.has(name)) return instances.get(name);
    const factory = views.get(name);
    const container = ensureRoot(name);
    if (!factory) {
      container.innerHTML = `<div class="view-empty">视图「${name}」尚未实现</div>`;
      const empty = { activate() {}, deactivate() {} };
      instances.set(name, empty);
      return empty;
    }
    const instance = factory({
      container,
      data: DATA,
      app: window.CodeViz,
      source: window.CodeVizSource,
      router: window.CodeViz.router,
    }) || { activate() {}, deactivate() {} };
    instances.set(name, instance);
    return instance;
  }

  function activate(route, params) {
    const name = routeName(route);

    // 先让目标容器可见，视图工厂（Canvas）才能拿到正确的宽高
    ensureRoot(name);
    if (current && current.route !== route) {
      const prev = instances.get(current.name);
      if (prev && typeof prev.deactivate === "function") {
        try { prev.deactivate(); } catch (e) { console.error(e); }
      }
    }
    for (const [key, el] of roots) {
      el.classList.toggle("active", key === name);
    }
    for (const [key, btn] of tabButtons) {
      btn.classList.toggle("active", key === route);
    }

    const target = ensureInstance(name, params);
    current = { route, name };
    if (target && typeof target.activate === "function") {
      try {
        target.activate(params || new URLSearchParams());
      } catch (e) {
        console.error(e);
        toast("视图加载失败：" + e.message);
      }
    }
  }

  function handleHash() {
    const { route, params } = parseHash();
    let normalized = route;
    if (route === "overlay") {
      const id = params.get("id");
      normalized = id ? "overlay/" + id : (overlayList()[0] ? "overlay/" + overlayList()[0].id : "deps");
    }
    if (!tabButtons.has(normalized) && !normalized.startsWith("overlay/")) {
      normalized = "deps";
    }
    if (normalized.startsWith("overlay/")) {
      const id = normalized.split("/")[1];
      params.set("id", id);
    }
    activate(normalized, params);
  }

  const router = {
    go(route, qs) {
      const suffix = qs ? "?" + String(qs).replace(/^\?/, "") : "";
      const next = "#" + route + suffix;
      if (location.hash === next) {
        handleHash();
      } else {
        location.hash = next;
      }
    },
    current() {
      return current ? current.route : null;
    },
  };

  window.CodeViz = {
    data: DATA,
    registerView(name, factory) {
      views.set(name, factory);
    },
    router,
    source: window.CodeVizSource,
    toast,
  };

  function init() {
    const project = DATA.project || {};
    const name = project.name || "codeviz";
    document.getElementById("brand-title").textContent = name;
    document.getElementById("brand-sub").textContent =
      DATA.schema === "codeviz/v1"
        ? "CodeGraph · 架构 / 调用 / 复杂度"
        : "数据格式不匹配";
    document.title = name + " · codeviz";
    if (project.description && hintEl) {
      hintEl.textContent = project.description;
      hintEl.title = project.description;
    }
    buildTabs();
    if (!location.hash) {
      location.hash = "#deps";
    }
    window.addEventListener("hashchange", handleHash);
    handleHash();
  }

  // 视图模块已经先于 app.js 加载并注册
  init();
})();
