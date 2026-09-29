import fs from "node:fs";
const source = new URL("../", import.meta.url);
const root = new URL("../../../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, source), "utf8");
const html = read("src/shell.html")
  .replace("/* STYLE */", () => read("src/style.css"))
  .replace("/* SEED */", () => read("src/demo.json").replace(/</g, "\\u003c"))
  .replace("/* APP */", () => read("src/app.js"));
for (const name of ["index.html", "shisheng.html"])
  fs.writeFileSync(new URL(name, root), html);
console.log("已生成 index.html / shisheng.html");
