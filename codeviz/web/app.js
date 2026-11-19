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

  // common.js creates window.CodeViz early and queues view registrations in
  // _pending; app.js adopts the same object instead of replacing it.
  const api = window.CodeViz || {};
  const pending = Array.isArray(api._pending) ? api._pending.slice() : [];

  const views = new Map();
  const instances = new Map();
  const roots = new Map();
  const tabButtons = new Map();
  let current = null;
  let toastTimer = null;
  let lastHash = null;
  let initialized = false;
  let activationScheduled = false;

  const viewRoot = document.getElementById("view-root");
  const tabsEl = document.getElementById("tabs");
  const toastEl = document.getElementById("toast");
  const hintEl = document.getElementById("global-hint");

  function registerView(name, factory) {
    if (name == null || typeof factory !== "function") return;
    const key = String(name);
    views.set(key, factory);
    // Late registration (after init): wire the view up right away instead of
    // leaving a cached "missing view" placeholder behind.
    if (current && current.name === key && !instances.has(key)) {
      activate(current.route, current.params);
    }
  }

  // Flush views that were queued before app.js ran.
  for (const entry of pending) {
    if (Array.isArray(entry)) registerView(entry[0], entry[1]);
  }

  function toast(text) {
    if (!toastEl) return;
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2200);
  }

  function overlayList() {
    return Array.isArray(DATA.overlays) ? DATA.overlays.filter(Boolean) : [];
  }

  const OVERLAY_PREFIX = "overlay/";

  // Overlay ids may contain "/", which must travel as ONE encoded segment.
  function overlayRoute(id) {
    return OVERLAY_PREFIX + encodeURIComponent(String(id));
  }

  function overlayIdFromRoute(route) {
    if (route.indexOf(OVERLAY_PREFIX) !== 0) return null;
    const raw = route.slice(OVERLAY_PREFIX.length);
    if (!raw) return "";
    try {
      return decodeURIComponent(raw);
    } catch (e) {
      return raw;
    }
  }

  function routeName(route) {
    return route.indexOf(OVERLAY_PREFIX) === 0 ? "overlay" : route;
  }

  function buildTabs() {
    if (!tabsEl) return;
    const fixed = [
      ["deps", "系统依赖"],
      ["calls", "调用链"],
      ["complexity", "复杂度"],
    ];
    const overlays = overlayList();
    const all = [...fixed, ...(overlays.length ? [["__sep__", ""]] : []),
      ...overlays.map(function (o) { return [overlayRoute(o.id), o.title || o.id]; })];

    tabsEl.innerHTML = "";
    tabButtons.clear();
    tabsEl.setAttribute("role", "tablist");
    tabsEl.setAttribute("aria-label", "视图切换");
    let index = 0;
    for (const [route, label] of all) {
      if (route === "__sep__") {
        const sep = document.createElement("span");
        sep.className = "sep";
        sep.setAttribute("role", "presentation");
        sep.setAttribute("aria-hidden", "true");
        tabsEl.appendChild(sep);
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tab";
      btn.id = "cv-tab-" + index;
      index += 1;
      btn.dataset.route = route;
      btn.textContent = label;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", "false");
      btn.setAttribute("aria-controls", "view-" + routeName(route));
      // Roving tabindex: only the selected tab is in the Tab order; the rest
      // are reached with the arrow keys (see the keydown handler below).
      btn.tabIndex = -1;
      btn.addEventListener("click", function () {
        router.go(route);
      });
      tabsEl.appendChild(btn);
      tabButtons.set(route, btn);
    }
    // Keep the tablist reachable before the first activation lands (the
    // activation pass re-applies the roving tabindex).
    const firstTab = tabsEl.querySelector(".tab");
    if (firstTab) firstTab.tabIndex = 0;
  }

  // ARIA tabs pattern: Left/Right/Home/End move selection and focus.
  function tabKeydown(event) {
    const key = event.key;
    if (!key) return;
    const buttons = Array.prototype.slice.call(tabsEl.querySelectorAll(".tab"));
    if (!buttons.length) return;
    let index = buttons.indexOf(document.activeElement);
    if (index < 0) {
      index = buttons.findIndex(function (btn) {
        return btn.getAttribute("aria-selected") === "true";
      });
    }
    if (index < 0) index = 0;
    let next = null;
    if (key === "ArrowRight" || key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (key === "ArrowLeft" || key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = buttons.length - 1;
    if (next == null) return;
    event.preventDefault();
    const target = buttons[next];
    if (!target) return;
    const route = target.dataset.route;
    try {
      target.focus({ preventScroll: true });
    } catch (e) {
      target.focus();
    }
    if (target.getAttribute("aria-selected") !== "true") router.go(route);
  }

  function parseHash() {
    const raw = (location.hash || "").replace(/^#/, "");
    if (!raw) return { route: "deps", params: new URLSearchParams() };
    const qIndex = raw.indexOf("?");
    const route = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
    const qs = qIndex >= 0 ? raw.slice(qIndex + 1) : "";
    return { route, params: new URLSearchParams(qs) };
  }

  function ensureRoot(name) {
    if (roots.has(name)) return roots.get(name);
    const el = document.createElement("section");
    el.className = "view-root";
    el.id = "view-" + name;
    el.dataset.view = name;
    el.setAttribute("role", "tabpanel");
    el.setAttribute("aria-hidden", "true");
    viewRoot.appendChild(el);
    roots.set(name, el);
    return el;
  }

  function ensureInstance(name, params) {
    if (instances.has(name)) return instances.get(name);
    const factory = views.get(name);
    const container = ensureRoot(name);
    if (!factory) {
      // textContent only: the route name comes from the URL hash and must
      // never be interpolated as HTML.
      container.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "view-empty";
      empty.textContent = "视图「" + name + "」尚未加载，请检查 assets/views/ 下的脚本";
      container.appendChild(empty);
      // Do not cache the placeholder: a late registerView() should recover it.
      return { activate: function () {}, deactivate: function () {} };
    }
    let instance = null;
    try {
      instance = factory({
        container: container,
        data: DATA,
        app: api,
        source: window.CodeVizSource,
        router: router,
      });
    } catch (e) {
      // A broken factory must not take the router down with it.
      console.error(e);
      container.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "view-empty";
      empty.textContent = "视图「" + name + "」初始化失败：" + (e && e.message ? e.message : String(e));
      container.appendChild(empty);
      toast("视图初始化失败：" + (e && e.message ? e.message : String(e)));
      return { activate: function () {}, deactivate: function () {} };
    }
    if (!instance || typeof instance !== "object") {
      instance = { activate: function () {}, deactivate: function () {} };
    }
    instances.set(name, instance);
    return instance;
  }

  function activate(route, params) {
    const name = routeName(route);
    const qs = params || new URLSearchParams();

    // Make the target container visible first: canvas views measure size in
    // their factory / activate().
    ensureRoot(name);
    if (current && current.route !== route) {
      const prev = instances.get(current.name);
      if (prev && typeof prev.deactivate === "function") {
        try { prev.deactivate(); } catch (e) { console.error(e); }
      }
    }
    for (const [key, el] of roots) {
      const on = key === name;
      el.classList.toggle("active", on);
      el.setAttribute("aria-hidden", on ? "false" : "true");
    }
    for (const [key, btn] of tabButtons) {
      const on = key === route;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
    }
    const activeBtn = tabButtons.get(route);
    const activeRoot = roots.get(name);
    if (activeBtn && activeRoot) {
      activeRoot.setAttribute("aria-labelledby", activeBtn.id);
    } else if (!activeBtn && tabButtons.size) {
      // Unknown overlay id (e.g. #overlay/typo): keep the tablist reachable.
      const fallback = tabButtons.values().next().value;
      if (fallback) fallback.tabIndex = 0;
    }

    const target = ensureInstance(name, qs);
    current = { route: route, name: name, params: qs };
    if (target && typeof target.activate === "function") {
      try {
        target.activate(qs);
      } catch (e) {
        console.error(e);
        toast("视图加载失败：" + e.message);
      }
    }
  }

  function handleHash(force) {
    const raw = location.hash || "";
    if (!force && raw === lastHash) return;
    lastHash = raw;
    const { route, params } = parseHash();
    let normalized = route;
    let overlayId = overlayIdFromRoute(route);

    if (route === "overlay") {
      // Legacy form: #overlay?id=<id>
      const fromParams = params.get("id");
      overlayId = fromParams || (overlayList()[0] ? String(overlayList()[0].id) : null);
      normalized = overlayId ? overlayRoute(overlayId) : "deps";
    } else if (overlayId !== null) {
      normalized = overlayId ? overlayRoute(overlayId) : "deps";
    }

    if (!tabButtons.has(normalized) && normalized.indexOf(OVERLAY_PREFIX) !== 0) {
      normalized = "deps";
    }
    if (normalized.indexOf(OVERLAY_PREFIX) === 0) {
      const id = overlayIdFromRoute(normalized);
      if (id) params.set("id", id);
      else normalized = "deps";
    }
    activate(normalized, params);
  }

  function scheduleActivation() {
    if (activationScheduled) return;
    activationScheduled = true;
    const run = function () {
      activationScheduled = false;
      handleHash();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  const router = {
    go(route, qs) {
      const suffix = qs ? "?" + String(qs).replace(/^\?/, "") : "";
      const next = "#" + route + suffix;
      if (location.hash === next) {
        handleHash(true);
      } else {
        location.hash = next;
      }
    },
    current() {
      return current ? current.route : null;
    },
  };

  function init() {
    if (initialized) return;
    initialized = true;

    const project = DATA.project || {};
    const name = project.name || "codeviz";
    const brandTitle = document.getElementById("brand-title");
    const brandSub = document.getElementById("brand-sub");
    if (brandTitle) brandTitle.textContent = name;
    if (brandSub) {
      brandSub.textContent = DATA.schema === "codeviz/v1"
        ? "CodeGraph · 架构 / 调用 / 复杂度"
        : "数据格式不匹配";
    }
    document.title = name + " · codeviz";
    if (project.description && hintEl) {
      hintEl.textContent = project.description;
      hintEl.title = project.description;
    }

    buildTabs();
    if (tabsEl) tabsEl.addEventListener("keydown", tabKeydown);
    window.addEventListener("hashchange", function () {
      scheduleActivation();
    });

    // Setting the hash fires hashchange; handleHash()'s lastHash guard makes
    // the init call and that event collapse into one activation.
    if (!location.hash) location.hash = "#deps";
    scheduleActivation();
  }

  // Real API on the SAME object common.js created (views may still reference it).
  Object.assign(api, {
    data: DATA,
    registerView: registerView,
    router: router,
    source: window.CodeVizSource,
    toast: toast,
  });
  try { delete api._pending; } catch (e) { api._pending = undefined; }
  window.CodeViz = api;

  init();
})();
