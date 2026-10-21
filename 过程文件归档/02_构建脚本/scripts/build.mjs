import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {build} from 'vite';
const base=fileURLToPath(new URL('../',import.meta.url)),root=fileURLToPath(new URL('../../../',import.meta.url));
const result=await build({configFile:false,root:base,build:{write:false,minify:true,lib:{entry:path.join(base,'src/v3/main.js'),formats:['iife'],name:'ShishengV3'}}});
const output=Array.isArray(result)?result[0].output:result.output;const chunks=output.filter(x=>x.type==='chunk');if(chunks.length!==1||output.some(x=>x.type!=='chunk'))throw Error('单文件构建出现外部资源，请检查。');
const code=chunks[0].code.replace(/<\/script/gi,'<\\/script');
const html=fs.readFileSync(path.join(base,'src/v3/shell.html'),'utf8').replace('/* APP */',()=>code);
if(/<script[^>]+src=|<link[^>]+(?:href=|rel=["']stylesheet)/i.test(html))throw Error('生成文件包含远程执行资源。');
for(const name of ['index.html','shisheng.html'])fs.writeFileSync(path.join(root,name),html);
console.log(`识生3.5：${Buffer.byteLength(html)}字节，index.html与shisheng.html一致。`);
