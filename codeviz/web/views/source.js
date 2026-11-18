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

  function absPath(file) {
    const root = (DATA.project && DATA.project.root) || "";
    if (!file) return "";
    if (/^[A-Za-z]:[\\/]/.test(file) || file.startsWith("/")) return file;
    return root.replace(/[\\/]+$/, "") + "/" + file.replace(/^[\\/]+/, "");
  }

  function showSymbol(sym) {
    if (!sym) return;
    currentSymbol = sym;
    titleEl.textContent = sym.qualified || sym.name || sym.id;
    metaEl.textContent = `${sym.file}:${sym.line} · ${sym.lines || "?"} 行 · ${sym.branches || 0} 分支`;
    const source = sym.source || "";
    codeEl.textContent = source || "（该符号没有内嵌源码；可能是非 Python 文件或超出源码截断限制）";
    const path = absPath(sym.file);
    vscodeLink.href = "vscode://file/" + encodeURI(path.replace(/\\/g, "/")) + ":" + (sym.line || 1);
    copyBtn.dataset.copy = `${sym.file}:${sym.line}`;
    panel.classList.add("show");
  }

  function show(symbolId) {
    showSymbol(byId.get(symbolId));
  }

  function showFile(file, line) {
    currentSymbol = null;
    titleEl.textContent = (file || "").split("/").pop() || "文件";
    metaEl.textContent = `${file || ""}${line ? ":" + line : ""}`;
    codeEl.textContent = "（没有选中具体函数；可在依赖/调用/复杂度视图中点击函数查看源码）";
    const path = absPath(file || "");
    vscodeLink.href = "vscode://file/" + encodeURI(path.replace(/\\/g, "/")) + ":" + (line || 1);
    copyBtn.dataset.copy = `${file || ""}${line ? ":" + line : ""}`;
    panel.classList.add("show");
  }

  function hide() {
    panel.classList.remove("show");
  }

  copyBtn.addEventListener("click", async () => {
    const text = copyBtn.dataset.copy || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "已复制";
      setTimeout(() => { copyBtn.textContent = "复制"; }, 1200);
    } catch (e) {
      window.CodeViz && window.CodeViz.toast ? window.CodeViz.toast("复制失败，请手动选择") : null;
    }
  });
  closeBtn.addEventListener("click", hide);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") hide();
  });

  window.CodeVizSource = { show, showFile, hide };
})();
