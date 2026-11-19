(function () {
  "use strict";

  const DATA = window.CODEVIZ_DATA || { project: {}, symbols: [] };
  const symbols = Array.isArray(DATA.symbols) ? DATA.symbols : [];
  const byId = new Map(symbols.map(s => [s.id, s]));
  const panel = document.getElementById("source-panel");
  const titleEl = document.getElementById("source-title");
  const metaEl = document.getElementById("source-meta");
  const codeEl = document.getElementById("source-code");
  const copyBtn = document.getElementById("source-copy");
  const vscodeLink = document.getElementById("source-vscode");
  const closeBtn = document.getElementById("source-close");
  let currentSymbol = null;
  let lastFocused = null;

  function absPath(file) {
    const root = (DATA.project && DATA.project.root) || "";
    if (!file) return "";
    if (/^[A-Za-z]:[\\/]/.test(file) || file.startsWith("/")) return file;
    return root.replace(/[\\/]+$/, "") + "/" + file.replace(/^[\\/]+/, "");
  }

  function basename(file) {
    const parts = String(file || "").replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || "";
  }

  function openPanel() {
    const wasOpen = panel.classList.contains("show");
    if (!wasOpen) {
      const active = document.activeElement;
      if (active && active !== document.body && !panel.contains(active)) {
        lastFocused = active;
      }
    }
    panel.classList.add("show");
    panel.setAttribute("aria-hidden", "false");
    if (!wasOpen && closeBtn && typeof closeBtn.focus === "function") {
      try { closeBtn.focus({ preventScroll: true }); } catch (e) { closeBtn.focus(); }
    }
  }

  function showSymbol(sym) {
    if (!sym) return;
    currentSymbol = sym;
    titleEl.textContent = sym.name || sym.qualified || sym.id;
    metaEl.textContent = `${sym.file}:${sym.line} · ${sym.lines || "?"} 行 · ${sym.branches || 0} 分支`;
    const source = sym.source || "";
    codeEl.textContent = source ||
      "（该符号没有内嵌源码：可能不是 Python 文件，或源码超出了构建时的截断限制。）";
    const path = absPath(sym.file);
    vscodeLink.href = "vscode://file/" + encodeURI(path.replace(/\\/g, "/")) + ":" + (sym.line || 1);
    copyBtn.dataset.copy = `${sym.file}:${sym.line}`;
    openPanel();
  }

  function show(symbolId) {
    showSymbol(byId.get(symbolId));
  }

  function showFile(file, line) {
    currentSymbol = null;
    titleEl.textContent = basename(file) || "文件";
    metaEl.textContent = `${file || ""}${line ? ":" + line : ""}`;
    // 依赖视图点击的是文件节点的“入口位置”，本来就没有函数源码可展示。
    codeEl.textContent =
      "（这是文件级入口，没有对应的函数源码。\n" +
      "  可在调用链 / 复杂度视图中点击具体函数，或在画布上选中函数节点查看源码。）";
    const path = absPath(file || "");
    vscodeLink.href = "vscode://file/" + encodeURI(path.replace(/\\/g, "/")) + ":" + (line || 1);
    copyBtn.dataset.copy = `${file || ""}${line ? ":" + line : ""}`;
    openPanel();
  }

  function hide() {
    if (!panel.classList.contains("show")) return;
    const back = lastFocused;
    lastFocused = null;
    panel.classList.remove("show");
    // Move focus out BEFORE hiding from the a11y tree.
    if (back && document.contains(back) && typeof back.focus === "function") {
      try { back.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ }
    }
    panel.setAttribute("aria-hidden", "true");
  }

  function fallbackCopy(text) {
    let area = null;
    try {
      area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand && document.execCommand("copy");
      return !!ok;
    } catch (e) {
      return false;
    } finally {
      if (area && area.parentNode) area.parentNode.removeChild(area);
    }
  }

  function notify(message) {
    if (window.CodeViz && typeof window.CodeViz.toast === "function") {
      window.CodeViz.toast(message);
    }
  }

  copyBtn.addEventListener("click", async () => {
    const text = copyBtn.dataset.copy || "";
    if (!text) return;
    let copied = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (e) {
      copied = false;
    }
    if (!copied) copied = fallbackCopy(text);
    if (copied) {
      copyBtn.textContent = "已复制";
      setTimeout(() => { copyBtn.textContent = "复制"; }, 1200);
    } else {
      notify("复制失败，请手动选择");
    }
  });

  closeBtn.addEventListener("click", hide);

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    // 输入框 / 搜索框里的 Esc 属于视图自己的“清空/取消”，不要顺手关掉源码面板。
    const target = e.target;
    const tag = target && target.tagName ? String(target.tagName).toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select" || (target && target.isContentEditable)) {
      return;
    }
    hide();
  });

  window.CodeVizSource = { show, showFile, hide };
})();
