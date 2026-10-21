const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  path = require("node:path");
(async () => {
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const p = await b.newPage();
  p.on("dialog", (d) => d.accept());
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("file://" + path.resolve(__dirname, "../../../shisheng.html"));
  await p.waitForSelector("[data-action=start-learn]");
  const result = await p.evaluate(async () => {
    const checks = [];
    const image = await (await fetch(SEED[0].photo)).blob();
    const make = (name, stamp = 100) =>
      new File([image], name, { type: "image/jpeg", lastModified: stamp });
    const a = "一班_甲乙_2026000001___山东省_.jpg",
      dup = "一班_乙甲_2026000001___山东省_.jpg",
      c = "二班_丙丁_2026000002_否_否_山东省_.jpg";
    await importFiles([make(a), make(dup), make(c)]);
    checks.push([
      "重复学号不出题",
      eligible().length === 1 && pending().length === 2,
    ]);
    const fixed = lib().rows.find((s) => s.rel === dup);
    fixed.studentNo = "2026000003";
    fixed.confirmed = true;
    checkDuplicates(lib().rows);
    checks.push(["重复问题修正后两条均恢复", eligible().length === 3]);
    const r = lib().rows.find((s) => s.rel === a);
    lib().progress[r.id] = {
      name: { at: 1, last: "miss", missed: ["name"] },
      full: { at: 2, last: "good", missed: [] },
      viewed: true,
      rounds: 1,
    };
    checks.push(["全项答出解除旧姓名漏项", !needsReview(r)]);
    const oldId = r.id,
      libraryId = lib().id;
    importTarget = libraryId;
    await importFiles([make(a), make(c)]);
    checks.push([
      "更新保留未变信息与进度",
      lib().rows.find((s) => s.rel === a).id === oldId &&
        lib().progress[oldId]?.viewed === true,
    ]);
    importTarget = libraryId;
    const changed = "一班_甲乙_2026000001___北京市_.jpg";
    await importFiles([make(changed), make(c)]);
    checks.push([
      "答案变化清除旧进度",
      lib().rows.find((s) => s.rel === changed).id === oldId &&
        !lib().progress[oldId],
    ]);
    importTarget = libraryId;
    await importFiles([
      new File(["bad"], changed, { type: "image/jpeg" }),
      make(c),
    ]);
    checks.push([
      "坏图更新保留旧照片并报告",
      lib().rows.some((s) => s.rel === changed) &&
        lib().report.some((s) => s.includes("保留旧照片")),
    ]);
    importTarget = null;
    await importFiles([make(a)]);
    checks.push([
      "同文件新名册进度隔离",
      lib().id !== libraryId && Object.keys(progress()).length === 0,
    ]);
    const count = app.libraries.length;
    try {
      await restoreBackup(
        new File(
          [
            JSON.stringify({
              format: "shisheng-backup",
              version: 2,
              library: {
                rows: [{ id: "1", image: "data:image/jpeg;base64,YmFk" }],
              },
            }),
          ],
          "bad.json",
        ),
      );
    } catch {}
    checks.push(["损坏备份不替换现有名册", app.libraries.length === count]);
    lib().rows.forEach((s) => {
      s.sure = false;
      s.confirmed = false;
      s.issues = ["待核对"];
    });
    setSession(null);
    checks.push(["全待核对队列为空", newQueue(false).length === 0]);
    await startLearn();
    checks.push(["空名册不会启动空题", session() === null]);
    app.active = "demo";
    app.settings.className = SEED[0].className;
    const pool = eligible();
    checks.push([
      "班级筛选生效",
      pool.length > 0 && pool.every((s) => s.className === SEED[0].className),
    ]);
    app.settings.scope = "className";
    await startExam();
    for (let i = 0; i < session().ids.length; i++) await grade([]);
    checks.push([
      "班级模考不会产生全项成绩",
      !Object.values(progress()).some((x) => x.full),
    ]);
    await saving;
    const beforeImport = app.libraries.length;
    await importFiles(Array.from({ length: 2001 }, () => make(a)));
    checks.push(["超量导入不会改动名册", app.libraries.length === beforeImport]);
    const savedDB = dbase;
    dbase = null;
    const failed = await persist();
    checks.push(["存储失败明确返回失败并提示", failed === false && storageError.includes("未保存")]);
    dbase = savedDB;
    checks.push(["存储恢复后可以重试", (await persist()) === true && storageError === ""]);
    return checks;
  });
  for (const [label, passed] of result) {
    assert.equal(passed, true, label);
    console.log("PASS " + label);
  }
  assert.deepEqual(errors, []);
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
