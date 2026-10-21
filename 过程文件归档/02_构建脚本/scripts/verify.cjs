const { chromium } = require("playwright");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../../.."),
  scratch =
    process.env.SHISHENG_VALIDATION_DIR ||
    path.resolve(root, "过程文件归档/01_验收预览");
(async () => {
  await fs.mkdir(scratch, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = "file://" + path.join(root, "shisheng.html");
  await page.goto(url);
  await page.locator("[data-action=start-learn]").waitFor();
  await page.screenshot({
    path: path.join(scratch, "首页.png"),
    fullPage: true,
  });
  await page.click("[data-action=start-learn]");
  for (let i = 0; i < 6; i++) {
    await page.locator("[data-action=study-next]").waitFor();
    assert.equal(await page.locator(".datum").count(), 5);
    await page.click("[data-action=study-next]");
  }
  assert.equal(await page.evaluate(() => session().stage), "recall");
  await page.click("[data-action=reveal]");
  await page.check("[data-missed=hometown]");
  await page.click("[data-action=grade]");
  assert.equal(await page.evaluate(() => session().queue.length), 7);
  assert.equal(
    await page.evaluate(
      () =>
        session().queue[3] === session().ids[0] ||
        session().results[0].id === session().queue[3],
    ),
    true,
  );
  await page.locator("[data-action=reveal]").waitFor();
  await page.reload();
  await page.locator("[data-action=reveal]").waitFor();
  assert.equal(await page.evaluate(() => session().index), 1);
  await page.screenshot({
    path: path.join(scratch, "回忆.png"),
    fullPage: true,
  });
  while (await page.evaluate(() => session().stage !== "done")) {
    await page.click("[data-action=reveal]");
    await page.click("[data-action=grade]");
  }
  await page.click("[data-action=start-learn]");
  assert.equal(
    await page.evaluate(() =>
      session().ids.every((id) => !progress()[id]?.viewed),
    ),
    true,
  );
  await page.locator("[data-action=study-next]").waitFor();
  await page.evaluate(() => {
    setSession(null);
    app.demoProgress = {};
    app.settings.scope = "name";
  });
  await page.goto(url + "#exam");
  await page.click("[data-action=start-exam]");
  assert.equal(await page.evaluate(() => session().queue.length), 5);
  for (let i = 0; i < 5; i++) {
    await page.click("[data-action=reveal]");
    assert.equal(await page.locator(".datum").count(), 1);
    await page.click("[data-action=grade]");
  }
  assert.equal(
    await page.evaluate(() => Object.values(progress()).some((p) => p.full)),
    false,
  );
  await page.click("[data-action=start-exam]");
  assert.equal(await page.evaluate(() => session().stage), "recall");
  console.log(
    "PASS 六人完整学习、隔题回收、断点恢复、新人覆盖、姓名成绩隔离、再来一组",
  );
  const folder = path.join(scratch, "虚构300人");
  await fs.mkdir(folder, { recursive: true });
  const image = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = 320;
    const x = c.getContext("2d");
    x.fillStyle = "#dce9dc";
    x.fillRect(0, 0, 240, 320);
    x.fillStyle = "#245a43";
    x.font = "32px sans-serif";
    x.fillText("DEMO", 65, 165);
    return c.toDataURL("image/png").split(",")[1];
  });
  for (let i = 0; i < 300; i++) {
    await fs.writeFile(
      path.join(
        folder,
        `${i % 2 ? "二班" : "一班"}_测试${String(i).padStart(3, "0")}_${2026000000 + i}_否_否_山东省_.png`,
      ),
      Buffer.from(image, "base64"),
    );
  }
  await fs.writeFile(path.join(folder, "损坏照片.jpg"), "broken");
  await page.goto(url + "#library");
  await page.setInputFiles("#folder", folder);
  await page.waitForFunction(
    () => !busy && lib()?.rows.length === 300,
    {},
    { timeout: 90000 },
  );
  assert.equal(await page.evaluate(() => pending().length), 0);
  assert.equal(
    await page.evaluate(() => lib().report.some((x) => x.includes("损坏照片"))),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => parseFilename("一班_张三_2026000001_否_否_山东省_.jpg").needyLabel,
    ),
    "否",
  );
  await page.goto(url + "#roster");
  assert.equal(await page.locator(".student").count(), 300);
  await page.fill("#search", "测试299");
  await page.click("[data-edit]");
  await page.fill("[name=hometown]", "山东省济南市");
  await page.click("#edit-form button[type=submit]");
  assert.equal(
    await page.evaluate(
      () => rows().find((s) => s.name === "测试299").hometown,
    ),
    "山东省济南市",
  );
  await page.goto(url + "#home");
  await page.click("[data-action=start-learn]");
  await page.click("[data-action=study-next]");
  await page.goto(url + "#library");
  const downloadP = page.waitForEvent("download");
  await page.click("[data-export]");
  const download = await downloadP;
  const backup = path.join(scratch, "backup.json");
  await download.saveAs(backup);
  const saved = JSON.parse(await fs.readFile(backup, "utf8"));
  assert.equal(saved.library.rows.length, 300);
  await page.setInputFiles("#backup", backup);
  await page.waitForFunction(
    () => !busy && app.libraries.length === 2,
    {},
    { timeout: 60000 },
  );
  assert.equal(await page.evaluate(() => session().index), 1);
  await page.reload();
  await page.locator("[data-action=continue]").waitFor();
  assert.equal(await page.evaluate(() => rows().length), 300);
  assert.equal(await page.evaluate(() => session().index), 1);
  console.log(
    "PASS 300人导入、否字段、损坏照片报告、第300条编辑、含照片备份恢复、多库隔离",
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(url + "#home");
  await page.screenshot({
    path: path.join(scratch, "电脑1024.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.click("[data-action=continue]");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("main img")].every(
      (i) => i.complete && i.naturalWidth > 0,
    ),
  );
  await page.screenshot({
    path: path.join(scratch, "完整学习.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log("PASS 1024px布局、浏览器无异常");
  await context.close();
  const legacyContext = await browser.newContext();
  const legacy = await legacyContext.newPage();
  await legacy.goto(url);
  await legacy.waitForFunction(() => dbase !== null);
  await legacy.evaluate(async () => {
    dbase.close();
    await new Promise((resolve, reject) => {
      const r = indexedDB.deleteDatabase("shisheng-v2");
      r.onsuccess = resolve;
      r.onerror = reject;
    });
    const old = await new Promise((resolve, reject) => {
      const r = indexedDB.open("shisheng-folder", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("kv");
        r.result.createObjectStore("photos");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = reject;
    });
    const photo = await (await fetch(SEED[0].photo)).blob();
    await new Promise((resolve, reject) => {
      const t = old.transaction(["kv", "photos"], "readwrite");
      t.objectStore("kv").put(
        {
          name: "旧版名册",
          files: [
            {
              rel: "测试.jpg",
              name: "测试学生",
              className: "一班",
              studentNo: "2026000001",
              hometown: "山东省",
              sure: true,
              needy: false,
              psychFocus: false,
            },
          ],
        },
        "meta",
      );
      t.objectStore("photos").put(photo, "测试.jpg");
      t.oncomplete = resolve;
      t.onerror = reject;
    });
    old.close();
  });
  await legacy.reload();
  await legacy.waitForFunction(() => lib()?.name === "旧版名册");
  assert.equal(await legacy.evaluate(() => rows().length), 1);
  assert.equal(await legacy.evaluate(() => Object.keys(progress()).length), 0);
  console.log("PASS 旧版照片与词条迁移，不虚增新版成绩");
  await legacyContext.close();
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
