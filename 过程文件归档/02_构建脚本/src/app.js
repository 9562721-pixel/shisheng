"use strict";
const SEED = JSON.parse(document.getElementById("seed").textContent);
const FIELDS = [
  ["name", "姓名"],
  ["className", "班级"],
  ["hometown", "籍贯"],
  ["needyLabel", "贫困情况"],
  ["psychLabel", "心理关注"],
];
const SCOPES = { full: "完整信息", name: "只报姓名", className: "只报班级" };
const fresh = () => ({
  version: 2,
  active: "demo",
  libraries: [],
  demoProgress: {},
  demoSession: null,
  settings: { className: "", order: "random", scope: "full" },
});
let interacting = false,
  pendingSaves = 0;
let app = fresh(),
  dbase = null,
  urls = new Map(),
  view = "home",
  query = "",
  rosterFilter = "all",
  editing = null,
  importTarget = null,
  saving = Promise.resolve(),
  storageError = "",
  busy = false;
const $ = (s) => document.querySelector(s);
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const uid = () =>
  crypto.randomUUID?.() ||
  Date.now().toString(36) + Math.random().toString(36).slice(2);
const shuffle = (a) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};
const lib = () => app.libraries.find((x) => x.id === app.active) || null;
const rows = () =>
  lib()?.rows ||
  SEED.map((s) => ({
    ...s,
    id: "demo:" + s.id,
    needyLabel: s.needy ? "贫困" : "非困难",
    psychLabel: s.psychFocus ? "心理关注" : "无关注",
    sure: true,
    issues: [],
    rel: "演示名册",
    photo: s.photo,
  }));
const progress = () => lib()?.progress || app.demoProgress;
const session = () => lib()?.session || (!lib() ? app.demoSession : null);
function setSession(s) {
  if (lib()) lib().session = s;
  else app.demoSession = s;
}
const pending = () => rows().filter((s) => !s.sure);
const eligible = () =>
  rows().filter(
    (s) =>
      s.sure &&
      (!app.settings.className || s.className === app.settings.className),
  );
const fieldSet = (scope) =>
  scope === "full" ? FIELDS : FIELDS.filter(([key]) => key === scope);
const caption = (s) =>
  FIELDS.map(([k]) => s[k])
    .filter(Boolean)
    .join(" · ");
const signature = (s) => JSON.stringify(FIELDS.map(([k]) => s[k]));
const photoKey = (libraryId, rowId) => libraryId + ":" + rowId;
const photoURL = (s) => s.photo || urls.get(photoKey(app.active, s.id)) || "";
const picture = (s, lazy = false) =>
  `<div class="portrait"><img src="${esc(photoURL(s))}" alt="学生照片" loading="${lazy ? "lazy" : "eager"}"></div>`;
const finished = (s) => !s || s.stage === "done";
const record = (s) => progress()[s.id] || {};
function needsReview(s) {
  const p = record(s);
  return FIELDS.some(([key]) => {
    const latest = [p.full, p[key]]
      .filter(Boolean)
      .sort((a, b) => b.at - a.at)[0];
    return latest?.missed?.includes(key);
  });
}
function showToast(msg) {
  $("#toast").textContent = msg;
  $("#toast").classList.remove("hidden");
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => $("#toast").classList.add("hidden"), 4500);
}
function busyUI(message) {
  busy = !!message;
  $("#busy").classList.toggle("hidden", !busy);
  $("#busytext").textContent = message || "";
}
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("shisheng-v2", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("app");
      r.result.createObjectStore("photos");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function readStore(store, key) {
  return new Promise((resolve, reject) => {
    const r = dbase.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function transaction(state, photoWrites = [], photoDeletes = []) {
  return new Promise((resolve, reject) => {
    if (!dbase) return reject(new Error("浏览器未提供本机存储"));
    const tx = dbase.transaction(["app", "photos"], "readwrite");
    tx.objectStore("app").put(state, "current");
    const p = tx.objectStore("photos");
    photoWrites.forEach(([k, b]) => p.put(b, k));
    photoDeletes.forEach((k) => p.delete(k));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("保存被中断"));
  });
}
function persist() {
  pendingSaves++;
  paintSave();
  const snapshot = structuredClone(app);
  saving = saving
    .catch(() => {})
    .then(() => transaction(snapshot))
    .then(() => {
      storageError = "";
      paintSave();
      return true;
    })
    .catch((e) => {
      storageError =
        "本次更改未保存：" + e.message + "。请导出备份后再关闭页面。";
      paintSave();
      showToast(storageError);
      return false;
    })
    .finally(() => {
      pendingSaves--;
      paintSave();
    });
  return saving;
}
function paintSave() {
  const box = $("#save-status");
  if (box) {
    box.textContent =
      storageError ||
      (pendingSaves
        ? "正在保存本次进度…"
        : "照片与进度保存在当前浏览器 · 无需重复选择文件夹");
    box.classList.toggle("error", !!storageError);
  }
}
async function install(next, writes = [], deletes = []) {
  await saving;
  await transaction(next, writes, deletes);
  app = next;
  storageError = "";
}
async function loadPhotos() {
  urls.forEach(URL.revokeObjectURL);
  urls.clear();
  const current = lib();
  if (!current) return;
  for (const s of current.rows) {
    const b = await readStore("photos", photoKey(current.id, s.id));
    if (b) urls.set(photoKey(current.id, s.id), URL.createObjectURL(b));
    else {
      s.sure = false;
      s.issues = ["照片副本缺失，请更新此名册"];
    }
  }
}
function move(route) {
  if (location.hash === "#" + route) {
    view = route;
    render();
  } else location.hash = route;
}
function selectors() {
  const classes = [
    ...new Set(
      rows()
        .filter((s) => s.sure)
        .map((s) => s.className),
    ),
  ].sort((a, b) => a.localeCompare(b, "zh"));
  return `<div class="controls"><label class="field">练习范围<select id="class-filter"><option value="">全部班级</option>${classes.map((c) => `<option ${c === app.settings.className ? "selected" : ""} value="${esc(c)}">${esc(c)}</option>`).join("")}</select></label><label class="field">出场顺序<select id="order"><option value="random" ${app.settings.order === "random" ? "selected" : ""}>打乱顺序</option><option value="sequence" ${app.settings.order === "sequence" ? "selected" : ""}>按文件顺序</option></select></label></div>`;
}
function source() {
  return lib() ? esc(lib().name) : "演示名册 · 24 人";
}
function warning() {
  return pending().length
    ? `<div class="notice">${pending().length} 条待核对，暂不进入学习和模考。<a href="#roster" data-pending>去核对</a></div>`
    : "";
}
function home() {
  const all = rows().filter((s) => s.sure),
    seen = all.filter((s) => record(s).viewed).length,
    good = all.filter((s) => record(s).full?.last === "good").length,
    weak = all.filter(needsReview).length;
  const run = session();
  return `<div class="top"><span class="eyebrow">每次六人 · 完整认识 · 按需自测</span><span class="source">${source()}</span></div>${warning()}<section class="hero"><div><h1>先记住这一组。</h1><p class="muted">把照片和完整信息一起记。<br>会的先往前走，卡住的稍后再看。</p><div class="actions">${!finished(run) ? `<button class="btn" data-action="continue">继续${run.kind === "exam" ? "这轮模考" : "上次速记"} →</button>` : `<button class="btn" data-action="start-learn" ${!eligible().length ? "disabled" : ""}>开始速记 · 6 人 →</button>`}<button class="btn secondary" data-action="review" ${!weak ? "disabled" : ""}>再看没记住的${weak ? " · " + weak : ""}</button></div>${!finished(run) ? `<button class="link" data-action="start-learn">重新开始一组</button>` : ""}${selectors()}</div><div class="heroart"><span class="eyebrow">识生速记</span><h2 style="margin:20px 0">先建立完整联系，<br>再把答案说出来。</h2><p class="muted" style="font-size:14px">姓名、班级、籍贯、贫困情况、心理关注。学号不参与背诵。</p><div class="steps"><div class="step active">01<b>完整看</b></div><div class="step">02<b>自己说</b></div><div class="step">03<b>补漏项</b></div></div></div></section><div class="metrics"><div class="metric"><b>${seen}<small> / ${all.length}</small></b><span>已看完整信息</span></div><div class="metric"><b>${good}</b><span>最近一次完整答出</span></div><div class="metric"><b>${weak}</b><span>有信息待再看</span></div></div><div class="panel row between"><div><h3>${lib() ? "名册已经备好" : "换成你自己的学生"}</h3><p class="muted" style="font-size:14px">${lib() ? "继续练即可。学生信息变化时，再主动更新照片。" : "第一次导入照片文件夹，以后在这台电脑上直接继续。"}</p></div><a class="btn secondary" href="#library">${lib() ? "照片与备份" : "导入照片"}</a></div>`;
}
function newQueue(reviewOnly) {
  let pool = eligible();
  if (reviewOnly) pool = pool.filter(needsReview);
  const order =
    app.settings.order === "random"
      ? shuffle(pool)
      : [...pool].sort((a, b) =>
          (a.rel || a.name).localeCompare(b.rel || b.name, "zh"),
        );
  order.sort((a, b) => {
    const pa = record(a),
      pb = record(b);
    return (
      Number(!!pa.viewed) - Number(!!pb.viewed) ||
      (pa.rounds || 0) - (pb.rounds || 0)
    );
  });
  return order.slice(0, 6).map((s) => s.id);
}
async function startLearn(reviewOnly = false) {
  if (
    !finished(session()) &&
    !confirm("开始新一组会结束当前未完成的练习，已记录的结果会保留。继续吗？")
  )
    return;
  const ids = newQueue(reviewOnly);
  if (!ids.length) {
    showToast("当前范围没有可练习的学生。");
    return;
  }
  setSession({
    kind: "learn",
    scope: "full",
    stage: "study",
    ids,
    queue: [],
    index: 0,
    revealed: false,
    missed: [],
    results: [],
    retries: {},
    reviewOnly,
  });
  await persist();
  move("learn");
}
async function startExam() {
  if (
    !finished(session()) &&
    !confirm("开始模考会结束当前未完成的练习，已记录的结果会保留。继续吗？")
  )
    return;
  const ids = shuffle(eligible())
    .slice(0, 5)
    .map((s) => s.id);
  if (!ids.length) return;
  setSession({
    kind: "exam",
    scope: app.settings.scope,
    stage: "recall",
    ids,
    queue: ids,
    index: 0,
    revealed: false,
    missed: [],
    results: [],
    retries: {},
  });
  await persist();
  move("learn");
}
async function studyNext() {
  const run = session(),
    id = run.ids[run.index];
  const p = progress()[id] || (progress()[id] = {});
  p.viewed = true;
  p.rounds = (p.rounds || 0) + 1;
  run.index++;
  if (run.index >= run.ids.length) {
    run.stage = "recall";
    run.queue = shuffle(run.ids);
    run.index = 0;
  }
  await persist();
  render();
}
function answers(s, scope, interactive = false, missed = []) {
  return `<div class="answer">${fieldSet(scope)
    .map(([k, label]) =>
      interactive
        ? `<label class="datum ${k === "name" ? "name" : ""} ${missed.includes(k) ? "miss" : ""}"><small><input type="checkbox" data-missed="${k}" ${missed.includes(k) ? "checked" : ""}>${label} · 点选未答出的项</small><b>${esc(s[k])}</b></label>`
        : `<div class="datum ${k === "name" ? "name" : ""}"><small>${label}</small><b>${esc(s[k])}</b></div>`,
    )
    .join("")}</div>`;
}
function learnView() {
  const run = session();
  if (!run)
    return `<div class="empty"><h2>从一组六人开始</h2><a class="btn" href="#home">回到速记首页</a></div>`;
  if (run.stage === "done") return resultsView(run);
  const id = (run.stage === "study" ? run.ids : run.queue)[run.index],
    s = rows().find((s) => s.id === id);
  if (!s)
    return `<div class="empty"><h2>这名学生已不在当前名册中</h2><a href="#home">返回首页</a></div>`;
  const studying = run.stage === "study";
  return `<div class="top"><div><span class="eyebrow">${run.kind === "exam" ? "五人模考 · " + SCOPES[run.scope] : studying ? "第一步 · 完整认识这一组" : "第二步 · 遮住信息，自己回忆"}</span><p class="muted" style="font-size:13px;margin-top:8px">${studying ? `${run.index + 1} / ${run.ids.length} 人` : run.kind === "exam" ? `${run.index + 1} / ${run.queue.length} 人` : `${run.index + 1} / ${run.queue.length} 次回忆 · 含稍后再看`}</p></div><a class="btn secondary small" href="#home">稍后继续</a></div><div class="progress"><span style="width:${(run.index / (studying ? run.ids.length : run.queue.length)) * 100}%"></span></div><div class="learn"><div>${picture(s)}<p class="photo-label">${studying ? "看照片，把下面的信息连在一起记。" : "看着照片，先把答案说出来。"}</p></div><div>${
    studying
      ? `<h2>认识这一位</h2><p class="muted" style="margin-top:8px">完整看一遍，也可以轻声念出来。</p>${answers(s, "full")}<div class="actions"><button class="btn" data-action="study-next">${run.index + 1 === run.ids.length ? "这一组看完，开始回忆" : "看过了，下一位"} <kbd>空格</kbd></button></div>`
      : !run.revealed
        ? `<div class="recallhint"><h2>先说出来。</h2><p class="muted">${run.scope === "full" ? "尽量把信息说完整。想不起的，揭晓后标出来。" : "这轮只检查" + (run.scope === "name" ? "姓名" : "班级") + "。"}</p><div class="pills">${fieldSet(
            run.scope,
          )
            .map(([, label]) => `<span class="pill">${label}</span>`)
            .join(
              "",
            )}</div></div><div class="actions"><button class="btn" data-action="reveal">揭晓答案 <kbd>空格</kbd></button><button class="link" data-action="skip">先放一放</button></div>`
        : `<h2>对照一下</h2><p class="muted" style="margin-top:8px">点选漏答或答错的项，再继续。</p>${answers(s, run.scope, true, run.missed)}<div class="actions"><button class="btn" data-action="grade" id="grade-btn">${run.missed.length ? "记下漏项，继续" : "都答出来了，继续"} <kbd>回车</kbd></button><button class="btn secondary" data-action="forgot">还没认出来</button></div>`
  }</div></div>`;
}
async function grade(missed, skip = false) {
  const run = session();
  if (!run || run.stage !== "recall") return;
  const id = run.queue[run.index];
  const p = progress()[id] || (progress()[id] = {});
  p[run.scope] = {
    attempts: (p[run.scope]?.attempts || 0) + 1,
    last: missed.length ? "miss" : "good",
    missed: [...missed],
    at: Date.now(),
  };
  run.results.push({ id, missed: [...missed], skip });
  if (
    run.kind === "learn" &&
    missed.length &&
    !skip &&
    !run.retries[id] &&
    run.queue.length - run.index - 1 >= 2
  ) {
    run.retries[id] = 1;
    run.queue.splice(run.index + 3, 0, id);
  }
  run.index++;
  run.revealed = false;
  run.missed = [];
  if (run.index >= run.queue.length) {
    run.stage = "done";
    if (run.kind === "exam") {
      const history = lib()
        ? lib().exams || (lib().exams = [])
        : app.demoExams || (app.demoExams = []);
      history.unshift({
        at: Date.now(),
        scope: run.scope,
        results: structuredClone(run.results),
      });
      history.splice(20);
    }
  }
  await persist();
  render();
}
function resultsView(run) {
  const final = new Map(run.results.map((r) => [r.id, r]));
  const good = [...final.values()].filter((r) => !r.missed.length).length;
  return `<div class="result"><span class="eyebrow">${run.kind === "exam" ? "模考结束 · " + SCOPES[run.scope] : "这一组，记住了一些"}</span><h1 style="margin-top:18px">${good} / ${run.ids.length} 人${run.scope === "full" ? "完整答出" : "答对"}</h1><p class="muted">${good === run.ids.length ? "这一轮都答出来了，可以继续认识下一组。" : "没记住的已经留下。现在可以继续，也可以回头再看。"}${run.kind === "exam" ? " 这是本轮自评结果，不换算正式考核分数。" : ""}</p><ul class="resultlist">${run.ids
    .map((id) => {
      const s = rows().find((x) => x.id === id),
        r = final.get(id);
      return `<li><b>${esc(s?.name || "学生")}</b><span class="${r?.missed.length ? "error" : "muted"}">${r?.missed.length ? "待再看：" + r.missed.map((k) => FIELDS.find((x) => x[0] === k)?.[1]).join("、") : "本轮答出"}</span></li>`;
    })
    .join(
      "",
    )}</ul><div class="actions">${run.kind === "exam" ? `<button class="btn" data-action="start-exam">再抽一组</button><a class="btn secondary" href="#exam">换回答范围</a>` : `<button class="btn" data-action="start-learn">继续下一组 →</button><button class="btn secondary" data-action="review">再看没记住的</button>`}<a class="link" href="#home">回首页</a></div></div>`;
}
function examView() {
  const history = lib()?.exams || (!lib() ? app.demoExams : []) || [];
  return `<div class="top"><h1>五人模考</h1><span class="source">${source()}</span></div><p class="muted">随机抽人，逐一口答。选择这次想检查的信息。</p>${warning()}<div class="modegrid">${Object.entries(
    SCOPES,
  )
    .map(
      ([key, label]) =>
        `<button class="mode ${app.settings.scope === key ? "on" : ""}" data-scope="${key}"><b>${label}</b><p>${key === "full" ? "姓名、班级、籍贯、贫困、心理" : "只记录这一项的回答结果"}</p></button>`,
    )
    .join(
      "",
    )}</div><label class="field" style="max-width:280px">抽取范围<select id="class-filter"><option value="">全部班级</option>${[
    ...new Set(
      rows()
        .filter((s) => s.sure)
        .map((s) => s.className),
    ),
  ]
    .map(
      (c) =>
        `<option value="${esc(c)}" ${app.settings.className === c ? "selected" : ""}>${esc(c)}</option>`,
    )
    .join(
      "",
    )}</select></label><div class="actions"><button class="btn" data-action="start-exam" ${!eligible().length ? "disabled" : ""}>抽取 ${Math.min(5, eligible().length)} 人，开始口答 →</button></div>${eligible().length < 5 ? '<p class="muted" style="margin-top:15px">当前范围不足 5 人，将抽取全部可用学生。</p>' : ""}<h2 style="margin-top:42px">最近的模考</h2>${
    history.length
      ? `<ul class="resultlist">${history
          .slice(0, 6)
          .map(
            (h) =>
              `<li><span>${new Date(h.at).toLocaleDateString("zh-CN")} · ${SCOPES[h.scope]}</span><span>${h.results.filter((r) => !r.missed.length).length} / ${h.results.length} 人答对</span></li>`,
          )
          .join("")}</ul>`
      : '<p class="muted" style="margin-top:16px">完成一轮后，结果会保存在这里。</p>'
  }`;
}
function rosterView() {
  const list = rows().filter(
    (s) =>
      (rosterFilter !== "pending" || !s.sure) &&
      (!query || [caption(s), s.studentNo, s.rel].join(" ").includes(query)),
  );
  return `<div class="top"><h1>我的名册</h1><span class="source">${rows().length} 人 · ${source()}</span></div><div class="row"><input type="search" id="search" aria-label="搜索名册" placeholder="搜索姓名、班级或原文件名" value="${esc(query)}"><button class="btn small ${rosterFilter === "all" ? "soft" : "secondary"}" data-filter="all">全部</button><button class="btn small ${rosterFilter === "pending" ? "warn" : "secondary"}" data-filter="pending">待核对 · ${pending().length}</button></div>${warning()}<div class="roster">${list.map((s) => `<article class="student">${picture(s, true)}<div class="info"><h3>${esc(s.name || "待确认姓名")}</h3><p>${esc(s.className)} · ${esc(s.hometown)}</p><p>${esc(s.needyLabel)} · ${esc(s.psychLabel)}</p><p class="${s.sure ? "muted" : "error"}">${s.sure ? (record(s).full?.last === "good" ? "最近一次完整答出" : record(s).viewed ? "看过完整信息" : "尚未学习") : esc(s.issues.join("；"))}</p>${lib() ? `<button class="btn secondary small" data-edit="${esc(s.id)}">${s.sure ? "查看 / 更正" : "核对这一条"}</button>` : ""}</div></article>`).join("")}</div>${!list.length ? '<div class="empty">没有符合条件的学生。</div>' : ""}`;
}
function libraryView() {
  return `<div class="top"><h1>照片与备份</h1><span class="source">本机保存</span></div><p class="muted">每个照片库独立保存学习进度。导入一次，以后直接打开继续。</p><div class="actions"><button class="btn" data-action="import-new">导入新的照片库</button><button class="btn secondary" data-action="restore">恢复备份</button></div><div class="librarylist">${app.libraries.map((l) => `<div class="panel row between"><div><h3>${esc(l.name)} ${app.active === l.id ? "<small>· 当前名册</small>" : ""}</h3><p class="muted" style="font-size:13px">${l.rows.length} 人 · ${l.rows.filter((r) => !r.sure).length} 条待核对 · ${new Date(l.updated).toLocaleDateString("zh-CN")} 更新</p></div><div class="row"><button class="btn ${app.active === l.id ? "soft" : "secondary"} small" data-use="${esc(l.id)}">${app.active === l.id ? "继续练习" : "切换到此名册"}</button><button class="btn secondary small" data-update="${esc(l.id)}">更新照片</button><button class="btn secondary small" data-export="${esc(l.id)}">导出备份</button></div></div>`).join("")}</div>${!app.libraries.length ? '<div class="empty"><h2>先带上你的学生</h2><p class="muted">选择包含学生照片的文件夹，子文件夹也会一起读取。</p></div>' : ""}${
    lib()?.report?.length
      ? `<div class="notice"><b>上次导入报告</b><ul>${lib()
          .report.map((m) => `<li>${esc(m)}</li>`)
          .join("")}</ul></div>`
      : ""
  }<div class="panel" style="margin-top:24px"><h3>命名规则</h3><p style="font-size:14px;margin-top:10px">班级_姓名_学号_贫困_心理_籍贯_.jpg</p><p class="muted" style="font-size:13px;margin-top:8px">学号只用于区分记录。贫困、心理两格为空表示“非困难、无关注”。其他格式或不确定的词条会先进入核对。</p></div><p style="margin-top:22px"><button class="link" data-action="demo">使用演示名册</button></p>`;
}
function helpView() {
  return `<article class="help"><span class="eyebrow">识生 · 使用说明</span><h1 style="margin-top:16px">从完整认识，到自己说出。</h1><h2>一组六人的速记</h2><p>先逐人看照片和完整信息，再遮住答案回忆。揭晓后，勾选漏答或答错的项。忘记的学生会在本轮还有足够间隔时稍后重现，每人最多追加一次；其余留在“再看没记住的”。选择“先放一放”会留下记录，不强迫反复作答。</p><p>学习以尚未看过、看过轮次较少的学生优先，避免少数难点占住整轮。退出或刷新后，可从首页继续。</p><h2>背哪些内容</h2><p>姓名、班级、籍贯、贫困情况、心理关注从第一次学习就完整呈现。学号不参与背诵。贫困、心理字段空白按原约定记为“非困难、无关注”。文件名里的原有表述会保留。</p><h2>五人模考</h2><p>从所选班级范围随机抽取五人，不足五人时抽全部。可选只报姓名、只报班级或完整信息。不计时、不换算正式考核分数。三种范围分别记录；姓名答对不会被当作完整答出。</p><h2>照片导入与更新</h2><p>用 Chrome 或 Edge 打开。先导入文件夹；以后使用本机副本，无需重新授权原文件夹。新的一届或另一位老师的照片用“导入新的照片库”；当前名册有变化才使用该库的“更新照片”。</p><p>导入完成会展示成功、失败和待核对数量。重复学号、未知格式或缺少信息先核对再练。更新时保留未变化学生的进度；答案或照片变化的记录重新学习。读取失败的旧照片会暂时保留并列在报告中。</p><h2>备份与换电脑</h2><p>照片和进度保存在当前浏览器中。清理浏览器数据、换浏览器或改变打开地址可能无法找回原数据。请在“照片与备份”导出名册备份，备份包含照片、词条和学习进度；在另一台设备上恢复即可继续，设备间不会自动同步。</p><h2>旧版本</h2><p>在原有地址使用新版时，会尝试读取旧版的本机照片与词条。旧版综合熟练度不转换为新版完整口答成绩，旧记录随迁移名册保留。迁移失败会提示，可重新导入照片；原数据库保持不变。</p><h2>快捷键</h2><p>空格：学习下一位或揭晓答案。回车：揭晓后提交当前勾选结果。输入和编辑时快捷键不生效。</p></article>`;
}
function render() {
  const content =
    view === "home"
      ? home()
      : view === "exam"
        ? examView()
        : view === "learn"
          ? learnView()
          : view === "roster"
            ? rosterView()
            : view === "library"
              ? libraryView()
              : helpView();
  $("#main").innerHTML =
    content + '<p id="save-status" class="status" aria-live="polite"></p>';
  document
    .querySelectorAll("[data-nav]")
    .forEach((a) =>
      a.classList.toggle(
        "on",
        a.dataset.nav === (view === "learn" ? "home" : view),
      ),
    );
  paintSave();
}
function parseFilename(rel) {
  const base = rel
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "");
  const parts = base.split("_").map((x) => x.trim());
  if (parts.length === 7 && parts[6] === "") parts.pop();
  let s = {
    name: "",
    className: "",
    studentNo: "",
    hometown: "",
    needyLabel: "非困难",
    psychLabel: "无关注",
    issues: [],
    confirmed: false,
  };
  if (parts.length === 6) {
    [s.className, s.name, s.studentNo] = parts;
    s.needyLabel = parts[3] || "非困难";
    s.psychLabel = parts[4] || "无关注";
    s.hometown = parts[5];
    if (!/^[0-9]{8,12}$/.test(s.studentNo)) s.issues.push("学号格式需核对");
    if (
      !["", "贫困", "困难", "非困难", "非贫困", "否", "无"].includes(parts[3])
    )
      s.issues.push("请核对贫困字段原文");
    if (
      !["", "心理重点关注", "心理关注", "无关注", "无", "否"].includes(parts[4])
    )
      s.issues.push("请核对心理字段原文");
  } else {
    s.name = /^[\u3400-\u9fff·]{2,12}$/.test(base) ? base : "";
    s.issues.push("文件名不是六段格式，请对照原文件核对");
  }
  if (!s.name) s.issues.push("姓名为空");
  if (!s.className) s.issues.push("班级为空");
  if (!s.hometown) s.issues.push("籍贯为空");
  s.confirmed = !s.issues.length;
  s.sure = s.confirmed;
  return s;
}
function checkDuplicates(list) {
  const counts = new Map();
  list.forEach((s) => {
    if (s.studentNo)
      counts.set(s.studentNo, (counts.get(s.studentNo) || 0) + 1);
  });
  for (const s of list) {
    s.issues = (s.issues || []).filter((x) => !x.startsWith("重复学号"));
    if (s.studentNo && counts.get(s.studentNo) > 1)
      s.issues.push("重复学号：" + s.studentNo + "，请保留正确记录或更正学号");
    s.sure = !!s.confirmed && !s.issues.length;
  }
}
function compress(file) {
  return new Promise((resolve, reject) => {
    const image = new Image(),
      url = URL.createObjectURL(file);
    image.onload = () => {
      try {
        const scale = Math.min(1, 720 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas
          .getContext("2d")
          .drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            blob ? resolve(blob) : reject(new Error("压缩失败"));
          },
          "image/jpeg",
          0.82,
        );
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("照片无法读取"));
    };
    image.src = url;
  });
}
async function importFiles(files) {
  if (!files.length) return;
  const usable = files.filter((f) => {
    const p = f.webkitRelativePath || f.name;
    return (
      !p.split("/").some((x) => x.startsWith(".") || x === "__MACOSX") &&
      /\.(jpe?g|png|webp|gif|bmp)$/i.test(p)
    );
  });
  if (!usable.length) {
    showToast("没有找到可用照片，支持 JPG、PNG、WebP、GIF、BMP。");
    return;
  }
  if (usable.length > 2000) {
    showToast("单个名册最多支持 2000 张照片，请分成多个名册导入。");
    return;
  }
  const current = app.libraries.find((l) => l.id === importTarget),
    libraryId = current?.id || uid();
  const root = (files[0].webkitRelativePath || "照片库/" + files[0].name).split(
    "/",
  )[0];
  const oldByRel = new Map((current?.rows || []).map((s) => [s.rel, s]));
  const oldByNo = new Map();
  for (const s of current?.rows || []) {
    if (s.studentNo) {
      if (oldByNo.has(s.studentNo)) oldByNo.set(s.studentNo, null);
      else oldByNo.set(s.studentNo, s);
    }
  }
  const imported = [],
    writes = [],
    report = [],
    nextProgress = {},
    used = new Set();
  busyUI("正在读取 0 / " + usable.length);
  try {
    await saving;
    for (let i = 0; i < usable.length; i++) {
      const f = usable[i],
        path = f.webkitRelativePath || f.name,
        rel = path.includes("/") ? path.split("/").slice(1).join("/") : path;
      try {
        const blob = await compress(f);
        let parsed = parseFilename(rel);
        const old = oldByRel.get(rel) || oldByNo.get(parsed.studentNo);
        if (old?.manual && old.rel === rel)
          parsed = {
            ...parsed,
            ...Object.fromEntries([
              ...FIELDS.map(([k]) => [k, old[k]]),
              ["studentNo", old.studentNo],
            ]),
            confirmed: true,
            issues: [],
            manual: true,
          };
        const reuse = old && !used.has(old.id),
          id = reuse ? old.id : uid();
        used.add(id);
        const stamp = f.size + ":" + f.lastModified;
        const s = { ...parsed, id, rel, stamp };
        imported.push(s);
        writes.push([photoKey(libraryId, id), blob]);
        if (reuse && signature(old) === signature(s) && old.stamp === stamp)
          nextProgress[id] = current.progress[old.id] || {};
      } catch (e) {
        const old = oldByRel.get(rel);
        if (old && !used.has(old.id)) {
          imported.push(old);
          used.add(old.id);
          nextProgress[old.id] = current.progress[old.id] || {};
        }
        report.push(rel + "：读取失败" + (old ? "，保留旧照片" : ""));
      }
      if (i % 10 === 0 || i === usable.length - 1)
        busyUI(`正在读取 ${i + 1} / ${usable.length}`);
    }
    if (!writes.length) {
      showToast("本次照片均未读取成功，原名册保持不变。");
      alert(report.join("\n"));
      return;
    }
    imported.sort((a, b) => a.rel.localeCompare(b.rel, "zh"));
    checkDuplicates(imported);
    const removed = (current?.rows || []).filter((s) => !used.has(s.id));
    const changed = imported.filter(
      (s) => current?.progress[s.id] && !nextProgress[s.id],
    ).length;
    report.unshift(
      `读取成功 ${writes.length} 张；待核对 ${imported.filter((s) => !s.sure).length} 条。`,
    );
    if (current)
      report.push(
        `移出 ${removed.length} 条；${changed} 条因照片或答案变化需重新学习。`,
      );
    const next = structuredClone(app);
    const l = {
      id: libraryId,
      name: current?.name || root,
      rows: imported,
      progress: nextProgress,
      session: null,
      exams: current?.exams || [],
      updated: Date.now(),
      report,
      legacy: current?.legacy,
    };
    next.libraries = next.libraries.filter((x) => x.id !== libraryId).concat(l);
    next.active = libraryId;
    next.settings.className = "";
    if (
      current &&
      !confirm(
        `更新“${current.name}”：\n${report.join("\n")}\n\n确认替换当前名册吗？`,
      )
    )
      return;
    await install(
      next,
      writes,
      removed.map((s) => photoKey(libraryId, s.id)),
    );
    await loadPhotos();
    rosterFilter = imported.some((s) => !s.sure) ? "pending" : "all";
    query = "";
    move(rosterFilter === "pending" ? "roster" : "home");
    showToast(report[0]);
  } finally {
    busyUI("");
    importTarget = null;
  }
}
function editStudent(id) {
  const s = rows().find((s) => s.id === id);
  if (!s || !lib()) return;
  editing = id;
  const dialog = $("#editor");
  dialog.innerHTML = `<h2>核对词条</h2><p style="font-size:13px;overflow-wrap:anywhere;margin:12px 0">原文件：${esc(s.rel)}</p><p class="muted" style="font-size:13px">按文件名原文核对，贫困、心理留空会按“无”处理。</p><form id="edit-form"><div class="editgrid">${[...FIELDS, ["studentNo", "学号（仅用于区分记录，不背）"]].map(([k, label]) => `<label class="field">${label}<input type="text" name="${k}" value="${esc(s[k])}" ${["name", "className", "hometown"].includes(k) ? "required" : ""}></label>`).join("")}</div><div class="actions"><button class="btn" type="submit">确认并保存</button><button class="btn secondary" type="button" data-action="close-edit">取消</button></div></form>`;
  dialog.showModal();
}
async function saveEdit(form) {
  const s = lib().rows.find((x) => x.id === editing),
    before = signature(s);
  const data = new FormData(form);
  const changes = {};
  for (const [k] of [...FIELDS, ["studentNo"]])
    changes[k] = String(data.get(k) || "").trim();
  if (!changes.name || !changes.className || !changes.hometown) {
    showToast("姓名、班级和籍贯需要填写。");
    return;
  }
  Object.assign(s, changes);
  s.needyLabel = s.needyLabel || "非困难";
  s.psychLabel = s.psychLabel || "无关注";
  s.confirmed = true;
  s.manual = true;
  s.issues = [];
  checkDuplicates(lib().rows);
  if (before !== signature(s)) {
    delete lib().progress[s.id];
    lib().session = null;
  }
  if (!(await persist())) return;
  $("#editor").close();
  render();
  showToast(
    s.sure ? "词条已保存，可以开始学习。" : "已保存，仍需处理重复学号。",
  );
}
async function toDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function exportLibrary(id) {
  busyUI("正在打包本机名册");
  try {
    await saving;
    const l = app.libraries.find((x) => x.id === id);
    const data = structuredClone(l);
    for (const row of data.rows) {
      const blob = await readStore("photos", photoKey(id, row.id));
      if (!blob) throw new Error("照片缺失：" + row.rel);
      row.image = await toDataURL(blob);
    }
    const blob = new Blob(
      [
        JSON.stringify({
          format: "shisheng-backup",
          version: 2,
          library: data,
        }),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = l.name.replace(/[\\/:*?"<>|]/g, "_") + "-识生备份.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast("备份已导出，内含照片与学习进度。");
  } finally {
    busyUI("");
  }
}
async function restoreBackup(file) {
  if (!file) return;
  busyUI("正在检查备份");
  try {
    if (file.size > 250 * 1024 * 1024)
      throw new Error("备份超过 250 MB，请拆分名册后恢复");
    const data = JSON.parse(await file.text());
    if (
      data.format !== "shisheng-backup" ||
      data.version !== 2 ||
      !data.library ||
      !Array.isArray(data.library.rows) ||
      !data.library.rows.length ||
      data.library.rows.length > 2000
    )
      throw new Error("不是受支持的识生备份");
    const raw = data.library;
    const id = uid(),
      list = [],
      writes = [],
      ids = new Set();
    for (const r of raw.rows) {
      if (
        typeof r.id !== "string" ||
        ids.has(r.id) ||
        typeof r.image !== "string" ||
        !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.image)
      )
        throw new Error("备份中的照片或记录格式无效");
      ids.add(r.id);
      const binary = atob(r.image.split(",")[1]),
        bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0)),
        b = new Blob([bytes], { type: r.image.slice(5, r.image.indexOf(";")) });
      const clean = {
        id: r.id,
        rel: String(r.rel || ""),
        studentNo: String(r.studentNo || ""),
        confirmed: !!r.confirmed,
        manual: !!r.manual,
        issues: Array.isArray(r.issues) ? r.issues.map(String) : [],
        stamp: String(r.stamp || ""),
      };
      FIELDS.forEach(([k]) => (clean[k] = String(r[k] || "")));
      if (!clean.name || !clean.className || !clean.hometown) {
        clean.confirmed = false;
        clean.issues.push("备份词条不完整");
      }
      list.push(clean);
      const bitmap = await createImageBitmap(b);
      bitmap.close();
      writes.push([photoKey(id, r.id), b]);
    }
    checkDuplicates(list);
    const restoredProgress = {};
    for (const row of list) {
      const p = raw.progress?.[row.id];
      if (!p || typeof p !== "object") continue;
      const clean = {
        viewed: !!p.viewed,
        rounds: Number.isFinite(p.rounds) ? Math.max(0, p.rounds) : 0,
      };
      for (const scope of Object.keys(SCOPES)) {
        const r = p[scope];
        if (r && ["good", "miss"].includes(r.last))
          clean[scope] = {
            last: r.last,
            attempts: Number.isFinite(r.attempts) ? Math.max(0, r.attempts) : 0,
            at: Number.isFinite(r.at) ? r.at : 0,
            missed: Array.isArray(r.missed)
              ? r.missed.filter((k) =>
                  fieldSet(scope).some(([key]) => key === k),
                )
              : [],
          };
      }
      restoredProgress[row.id] = clean;
    }
    const name = String(raw.name || "恢复的名册");
    const next = structuredClone(app);
    let restoredSession = null;
    const rs = raw.session;
    if (
      rs &&
      ["learn", "exam"].includes(rs.kind) &&
      ["study", "recall", "done"].includes(rs.stage) &&
      Object.keys(SCOPES).includes(rs.scope) &&
      Array.isArray(rs.ids) &&
      rs.ids.length <= 6 &&
      rs.ids.every((x) => ids.has(x)) &&
      Array.isArray(rs.queue) &&
      rs.queue.length <= 12 &&
      rs.queue.every((x) => ids.has(x)) &&
      Number.isInteger(rs.index) &&
      rs.index >= 0 &&
      rs.index <= (rs.stage === "study" ? rs.ids.length : rs.queue.length) &&
      Array.isArray(rs.results)
    ) {
      restoredSession = {
        ...rs,
        missed: Array.isArray(rs.missed)
          ? rs.missed.filter((k) => FIELDS.some(([key]) => key === k))
          : [],
        retries: rs.retries && typeof rs.retries === "object" ? rs.retries : {},
        results: rs.results
          .filter((r) => r && ids.has(r.id) && Array.isArray(r.missed))
          .map((r) => ({
            id: r.id,
            missed: r.missed.filter((k) => FIELDS.some(([key]) => key === k)),
            skip: !!r.skip,
          })),
      };
      if (
        rs.stage !== "done" &&
        rs.index === (rs.stage === "study" ? rs.ids.length : rs.queue.length)
      )
        restoredSession = null;
    }
    const exams = (Array.isArray(raw.exams) ? raw.exams : [])
      .slice(0, 20)
      .filter(
        (h) =>
          h &&
          Number.isFinite(h.at) &&
          Object.keys(SCOPES).includes(h.scope) &&
          Array.isArray(h.results),
      )
      .map((h) => ({
        at: h.at,
        scope: h.scope,
        results: h.results
          .filter(
            (r) => r && typeof r.id === "string" && Array.isArray(r.missed),
          )
          .slice(0, 5)
          .map((r) => ({
            id: r.id,
            missed: r.missed.filter((k) =>
              fieldSet(h.scope).some(([key]) => key === k),
            ),
            skip: !!r.skip,
          })),
      }));
    next.libraries.push({
      id,
      name,
      rows: list,
      progress: restoredProgress,
      legacy:
        raw.legacy && typeof raw.legacy === "object" ? raw.legacy : undefined,
      session: restoredSession,
      exams,
      updated: Date.now(),
      report: ["从备份恢复为独立名册，原有名册未覆盖。"],
    });
    next.active = id;
    next.settings.className = "";
    await install(next, writes);
    await loadPhotos();
    move("home");
    showToast("备份已恢复，照片和学习进度已载入。");
  } finally {
    busyUI("");
  }
}
async function migrateLegacy() {
  if (app.legacyChecked) return;
  let old;
  try {
    old = await new Promise((resolve, reject) => {
      const r = indexedDB.open("shisheng-folder");
      r.onupgradeneeded = () => {
        r.transaction.abort();
        resolve(null);
      };
      r.onerror = () =>
        r.error?.name === "AbortError" ? resolve(null) : reject(r.error);
      r.onsuccess = () => resolve(r.result);
    });
    if (
      old?.objectStoreNames.contains("kv") &&
      old.objectStoreNames.contains("photos")
    ) {
      const get = (store, key) =>
        new Promise((resolve, reject) => {
          const r = old.transaction(store).objectStore(store).get(key);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      const meta = await get("kv", "meta");
      if (meta?.files?.length) {
        const id = uid(),
          migrated = [],
          writes = [];
        for (const f of meta.files) {
          const blob = await get("photos", f.rel);
          if (!blob) continue;
          const row = {
            ...f,
            id: uid(),
            needyLabel: f.needyLabel || (f.needy ? "贫困" : "非困难"),
            psychLabel: f.psychLabel || (f.psychFocus ? "心理关注" : "无关注"),
            confirmed: !!f.sure,
            manual: !!f.fixed,
            issues: f.issues || [],
            stamp: "",
          };
          migrated.push(row);
          writes.push([photoKey(id, row.id), blob]);
        }
        if (migrated.length) {
          checkDuplicates(migrated);
          let legacy = {};
          try {
            legacy = JSON.parse(
              localStorage.getItem("shisheng-html-v1") || "{}",
            );
          } catch {}
          const next = structuredClone(app);
          next.libraries.push({
            id,
            name: meta.name || "旧版名册",
            rows: migrated,
            progress: {},
            exams: [],
            session: null,
            updated: Date.now(),
            legacy,
            report: [
              "已读取旧版照片和词条；旧熟练度已保留为历史，不计入新版成绩。",
            ],
          });
          next.active = id;
          next.legacyChecked = true;
          await install(next, writes);
          return;
        }
      }
    }
    app.legacyChecked = true;
    await persist();
  } finally {
    old?.close();
  }
}
async function useLibrary(id) {
  await saving;
  app.active = id;
  app.settings.className = "";
  await loadPhotos();
  await persist();
  query = "";
  rosterFilter = "all";
  move("home");
}
const actions = {
  "start-learn": () => startLearn(false),
  review: () => startLearn(true),
  continue: () => move("learn"),
  "start-exam": startExam,
  "study-next": studyNext,
  reveal: () => {
    const s = session();
    if (s?.stage === "recall") {
      s.revealed = true;
      persist();
      render();
    }
  },
  grade: () => {
    if (session()?.revealed) return grade(session().missed);
  },
  forgot: () => grade(fieldSet(session().scope).map(([k]) => k)),
  skip: () =>
    grade(
      fieldSet(session().scope).map(([k]) => k),
      true,
    ),
  "import-new": () => {
    importTarget = null;
    $("#folder").value = "";
    $("#folder").click();
  },
  restore: () => {
    $("#backup").value = "";
    $("#backup").click();
  },
  demo: () => useLibrary("demo"),
  "close-edit": () => $("#editor").close(),
};
async function handleClick(event) {
  if (busy) return;
  const action = event.target.closest("[data-action]");
  if (action) {
    await actions[action.dataset.action]?.();
    return;
  }
  const scope = event.target.closest("[data-scope]");
  if (scope) {
    app.settings.scope = scope.dataset.scope;
    persist();
    render();
    return;
  }
  const filter = event.target.closest("[data-filter]");
  if (filter) {
    rosterFilter = filter.dataset.filter;
    render();
    return;
  }
  if (event.target.closest("[data-pending]")) {
    rosterFilter = "pending";
    if (view === "roster") render();
  }
  const edit = event.target.closest("[data-edit]");
  if (edit) {
    editStudent(edit.dataset.edit);
    return;
  }
  const use = event.target.closest("[data-use]");
  if (use) {
    await useLibrary(use.dataset.use);
    return;
  }
  const update = event.target.closest("[data-update]");
  if (update) {
    importTarget = update.dataset.update;
    $("#folder").value = "";
    $("#folder").click();
    return;
  }
  const exp = event.target.closest("[data-export]");
  if (exp) await exportLibrary(exp.dataset.export);
}
function reportError(e) {
  console.error(e);
  showToast("操作没有完成：" + e.message);
}
document.addEventListener("click", async (event) => {
  if (interacting) return;
  interacting = true;
  try {
    await handleClick(event);
  } catch (e) {
    reportError(e);
  } finally {
    interacting = false;
  }
});
document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.id === "class-filter") {
    app.settings.className = el.value;
    persist();
    render();
  }
  if (el.id === "order") {
    app.settings.order = el.value;
    persist();
  }
  if (el.dataset.missed) {
    const run = session();
    if (!run || !run.revealed) return;
    run.missed = [...document.querySelectorAll("[data-missed]:checked")].map(
      (x) => x.dataset.missed,
    );
    el.closest(".datum").classList.toggle("miss", el.checked);
    $("#grade-btn").innerHTML =
      (run.missed.length ? "记下漏项，继续" : "都答出来了，继续") +
      " <kbd>回车</kbd>";
    persist();
  }
  if (el.id === "folder") importFiles([...el.files]).catch(reportError);
  if (el.id === "backup") restoreBackup(el.files[0]).catch(reportError);
});
document.addEventListener("input", (event) => {
  if (event.target.id === "search") {
    query = event.target.value;
    const position = event.target.selectionStart;
    render();
    $("#search").focus();
    $("#search").setSelectionRange(position, position);
  }
});
document.addEventListener("submit", (event) => {
  if (event.target.id === "edit-form") {
    event.preventDefault();
    saveEdit(event.target).catch(reportError);
  }
});
document.addEventListener("keydown", async (event) => {
  if (
    interacting ||
    busy ||
    event.repeat ||
    $("#editor").open ||
    event.target.closest(
      "input,textarea,select,button,a,[contenteditable=true]",
    ) ||
    view !== "learn"
  )
    return;
  const run = session();
  if (!run || run.stage === "done") return;
  if (event.code === "Space") {
    event.preventDefault();
    if (run.stage === "study") {
      interacting = true;
      try {
        await studyNext();
      } finally {
        interacting = false;
      }
    } else if (!run.revealed) actions.reveal();
  }
  if (event.key === "Enter" && run.stage === "recall" && run.revealed) {
    event.preventDefault();
    interacting = true;
    try {
      await grade(run.missed);
    } finally {
      interacting = false;
    }
  }
});
window.addEventListener("beforeunload", (event) => {
  if (pendingSaves || busy) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("hashchange", () => {
  const requested = location.hash.replace(/^#\/?/, "");
  view = ["home", "exam", "learn", "roster", "library", "help"].includes(
    requested,
  )
    ? requested
    : "home";
  render();
  window.scrollTo(0, 0);
});
async function boot() {
  try {
    dbase = await openDB();
    const saved = await readStore("app", "current");
    if (saved?.version === 2) {
      app = saved;
      app.settings = {
        className: "",
        order: "random",
        scope: "full",
        ...saved.settings,
      };
    }
    await migrateLegacy();
    await loadPhotos();
  } catch (e) {
    storageError =
      "本机数据未能完整读取：" +
      e.message +
      "。可先体验演示名册，请勿清理原浏览器数据。";
  }
  const requested = location.hash.replace(/^#\/?/, "");
  view = ["home", "exam", "learn", "roster", "library", "help"].includes(
    requested,
  )
    ? requested
    : "home";
  render();
}
boot();
