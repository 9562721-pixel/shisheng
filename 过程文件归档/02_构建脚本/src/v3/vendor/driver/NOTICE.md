# Driver.js 任务清单复用记录

上游：https://github.com/nilbuild/driver.js
版本：1.10.2，MIT（完整许可见同目录 LICENSE）。
官方 npm 分发：https://registry.npmjs.org/driver.js/-/driver.js-1.10.2.tgz

直接集成 checklist.mjs、checklist.css 与其驱动依赖 driver.js.mjs，任务项、完成条件及本产品配色在 game-element.js 中配置。唯一上游源码改动：将 checklist.mjs 的 driver.js 包导入改为同目录相对导入。
未采用重型 RPG 游戏底座，不增加新地图、美术或运行依赖。RPGUI 仅列为调研候选，未集成。

分发包 SHA-256：e621143a642685b5e22c9273897a121401a34de68b38baf7d0651f03a8e7ee98
