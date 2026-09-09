(() => {
  "use strict";
  const themes = [
    {id: "ink", name: "墨橙", mood: "纸白 · 墨色 · 柑橘"},
    {id: "sky", name: "晴蓝", mood: "清爽专注"},
    {id: "peach", name: "杏桃", mood: "温暖明快"},
    {id: "jade", name: "青竹", mood: "舒展安静"},
    {id: "violet", name: "暮紫", mood: "柔和灵感"},
    {id: "night", name: "夜航", mood: "深色陪伴"}
  ];
  const fontOptions = window.QinfangFonts.options;
  const fonts = fontOptions.map(f => f.id);
  const root = document.documentElement;
  function read(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
  function save(key, value) { try { localStorage.setItem(key, value); } catch {} }
  root.dataset.theme = themes.some(t => t.id === read("standalone-studio-theme-v2", "ink")) ? read("standalone-studio-theme-v2", "ink") : "ink";
  root.dataset.font = fonts.includes(read("standalone-studio-font", "modern")) ? read("standalone-studio-font", "modern") : "modern";
  root.dataset.fontScope = read("standalone-studio-font-scope", "titles");
  function sync() {
    const scope=document.querySelector("#font-scope");if(scope)scope.value=root.dataset.fontScope;
    document.querySelectorAll("[data-theme-pick]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themePick === root.dataset.theme)));
    document.querySelectorAll("[data-font-pick]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.fontPick === root.dataset.font)));
    document.querySelectorAll(".current-theme").forEach(s => s.textContent = themes.find(t => t.id === root.dataset.theme).name);
    const selectedFont = fontOptions.find(f => f.id === root.dataset.font);
    document.querySelectorAll(".current-font").forEach(s => s.textContent = selectedFont.name);
    document.querySelectorAll(".font-description").forEach(s => s.textContent = selectedFont.detail);
    const filename = window.QinfangFonts.importedName(root.dataset.font);
    document.querySelectorAll(".font-import-file").forEach(s => s.textContent = filename ? `已导入：${filename}` : "");
    document.querySelectorAll(".font-import-change").forEach(b => b.hidden = !filename);
  }
  function apply(theme, font, persist = true) {
    if (themes.some(t => t.id === theme)) root.dataset.theme = theme;
    if (fonts.includes(font)) root.dataset.font = font;
    if (persist) { save("standalone-studio-theme-v2", root.dataset.theme); save("standalone-studio-font", root.dataset.font); }
    sync();
  }
  document.addEventListener("DOMContentLoaded", () => {
    const grid = document.querySelector("#font-options");
    if (grid) grid.innerHTML = window.QinfangFonts.render();
    document.querySelector("#font-scope").onchange=e=>{root.dataset.fontScope=e.target.value;save("standalone-studio-font-scope",e.target.value)};
    sync();
    window.QinfangFonts.ready.then(() => {
      if (grid) grid.innerHTML = window.QinfangFonts.render();
      if (!window.QinfangFonts.available(root.dataset.font)) apply(null, "humanist"); else sync();
    });
  });
  document.addEventListener("click", async e => {
    const theme = e.target.closest("[data-theme-pick]"), font = e.target.closest("[data-font-pick]");
    if (theme) apply(theme.dataset.themePick);
    const reimport = e.target.closest(".font-import-change");
    if (font || reimport) {
      const id = reimport ? root.dataset.font : font.dataset.fontPick;
      const status = document.querySelector(".font-import-status");
      if (status) status.textContent = "";
      try {
        if (reimport || !window.QinfangFonts.available(id)) {
          if (!await window.QinfangFonts.requestImport(id)) return;
          document.querySelector("#font-options").innerHTML = window.QinfangFonts.render();
          if (status) status.textContent = "字体已导入并保存在当前浏览器。";
        }
        apply(null, id);
      } catch (error) { if (status) status.textContent = error.message; }
    }
    const pane = e.target.closest("[data-appearance-pane-pick]");
    if (pane) {
      document.querySelectorAll("[data-appearance-pane-pick]").forEach(b => b.setAttribute("aria-pressed", String(b === pane)));
      document.querySelectorAll("[data-appearance-pane]").forEach(p => p.hidden = p.dataset.appearancePane !== pane.dataset.appearancePanePick);
    }
    const panel = document.querySelector("#appearance-control");
    if (panel?.open && !panel.contains(e.target)) panel.open = false;
  });
  document.addEventListener("keydown", e => {
    const panel = document.querySelector("#appearance-control");
    if (e.key === "Escape" && panel?.open) { panel.open = false; panel.querySelector("summary").focus(); }
  });
  window.addEventListener("storage", e => {
    if (e.key === "standalone-studio-theme-v2" || e.key === "standalone-studio-font") apply(read("standalone-studio-theme-v2", "ink"), read("standalone-studio-font", "modern"), false);
  });
  window.StudioAppearance = {themes, sync};
})();
