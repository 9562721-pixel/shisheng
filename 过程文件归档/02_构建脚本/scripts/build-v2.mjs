import fs from "node:fs";
const source = new URL("../", import.meta.url);
const root = new URL("../../../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, source), "utf8");
const html = read("src/shell.html")
  .replace("/* STYLE */", () => read("src/style.css"))
  .replace("/* SEED */", () => read("src/demo.json").replace(/</g, "\\u003c"))
  .replace("/* APP */", () => read("src/app.js"));
fs.writeFileSync(new URL("src/v3/legacy-v2.html", source), html);
console.log("已生成旧版兼容程序 src/v3/legacy-v2.html");
