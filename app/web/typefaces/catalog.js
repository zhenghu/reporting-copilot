(() => {
  "use strict";
  const options = [
    {id: "xingkai", name: "华文行楷", detail: "流畅行笔 · 本机字库"},
    {id: "zhimang", name: "志莽行书", detail: "洒脱笔意 · 魏志莽"},
    {id: "wangxizhi", name: "王羲之行书", detail: "使用自己的授权字库", custom: true},
    {id: "shoujin", name: "赵佶瘦金书", detail: "宋徽宗风格 · 导入字库", custom: true},
    {id: "rounded", name: "柔和圆体", detail: "圆润舒展 · 温柔耐看"},
    {id: "lanting", name: "兰亭黑体", detail: "清爽轻盈 · 日常工作"},
    {id: "fangsong", name: "雅致仿宋", detail: "修长疏朗 · 文艺书卷"},
    {id: "humanist", name: "人文楷体", detail: "自然笔意 · 从容表达"},
    {id: "editorial", name: "经典宋体", detail: "纸本文气 · 沉静阅读"},
    {id: "hiragino", name: "冬青黑体", detail: "匀净利落 · 结构清晰"},
    {id: "heiti", name: "华文细黑", detail: "轻柔简净 · 留白感"},
    {id: "modern", name: "现代黑体", detail: "稳健清晰 · 熟悉易读"}
  ];
  const imported = new Map(), faces = new Map(), fontBytes = new Map();
  const bundledURL = new URL("ZhiMangXing-Regular.ttf", document.currentScript.src).href;
  let bundledBytes;
  const family = id => id === "wangxizhi" ? "QinfangWangXizhi" : "QinfangShouJin";
  const isCustom = id => options.some(f => f.id === id && f.custom);
  function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("qinfang-personal-fonts", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("fonts", {keyPath: "id"});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function records() {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("fonts").objectStore("fonts").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }
  async function save(record) {
    const db = await database();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("fonts", "readwrite");
        tx.objectStore("fonts").put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  function use(record, face) {
    if (faces.has(record.id)) document.fonts.delete(faces.get(record.id));
    document.fonts.add(face);
    faces.set(record.id, face);
    imported.set(record.id, record.name);
    fontBytes.set(record.id, record.bytes);
  }
  const ready = records().then(async saved => {
    for (const record of saved) {
      if (!isCustom(record.id)) continue;
      try { use(record, await new FontFace(family(record.id), record.bytes).load()); } catch {}
    }
  }).catch(() => {});
  function render() {
    return options.map(f => {
      const missing = f.custom && !imported.has(f.id);
      return `<button type="button" data-font-pick="${f.id}" data-font-missing="${missing}" aria-label="${f.name}${missing ? '，导入字体文件' : ''}" aria-pressed="false"><b>${missing ? '导入自己的字库' : '把思考写清楚'}</b><span>${f.name}</span><small>${missing ? 'TTF / OTF / WOFF / WOFF2' : f.detail}</small></button>`;
    }).join("");
  }
  async function requestImport(id) {
    if (!isCustom(id)) throw new Error("请选择字体槽位");
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ttf,.otf,.woff,.woff2";
    const file = await new Promise(resolve => {
      input.addEventListener("change", () => resolve(input.files[0] || null), {once: true});
      input.addEventListener("cancel", () => resolve(null), {once: true});
      input.click();
    });
    if (!file) return false;
    if (file.size > 20 * 1024 * 1024) throw new Error("请选择不超过 20 MB 的字体文件");
    const bytes = await file.arrayBuffer();
    let face;
    try { face = await new FontFace(family(id), bytes).load(); }
    catch { throw new Error("无法读取该字体，请选择有效的 TTF、OTF、WOFF 或 WOFF2 文件"); }
    const record = {id, name: file.name, bytes};
    try { await save(record); }
    catch { throw new Error("浏览器未能保存字体，请检查可用存储空间后重试"); }
    use(record, face);
    return true;
  }
  async function payload(id) {
    await ready;
    if (!id) return {family: ""};
    if (!options.some(f => f.id === id)) throw new Error("未知字体");
    const result = {family: getComputedStyle(document.documentElement).getPropertyValue("--display").trim()};
    if (id === "zhimang") {
      if (!bundledBytes) bundledBytes = fetch(bundledURL).then(response => {
        if (!response.ok) throw new Error("字体文件加载失败");
        return response.arrayBuffer();
      }).catch(error => { bundledBytes = null; throw error; });
      result.face = "QinfangZhiMang";
      result.bytes = await bundledBytes;
    } else if (isCustom(id)) {
      if (!fontBytes.has(id)) throw new Error("请先导入字体");
      result.face = family(id);
      result.bytes = fontBytes.get(id);
    }
    return result;
  }
  window.QinfangFonts = {options, ready, render, requestImport, payload,
    available: id => !isCustom(id) || imported.has(id),
    importedName: id => imported.get(id) || ""};
})();
