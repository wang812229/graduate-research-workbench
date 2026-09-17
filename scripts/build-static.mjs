import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'dist-static');
const files=['index.html','styles.css','app.mjs','core.mjs','offline.mjs','catalog.json','sw.js','favicon.svg','manifest.webmanifest','cloud-config.json'];
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const file of files)await cp(resolve(root,file),resolve(out,file));
const cloudBundle=await rollup({input:resolve(root,'cloud-client.mjs'),plugins:[nodeResolve({browser:true})]});
await cloudBundle.write({file:resolve(out,'cloud-client.bundle.mjs'),format:'es'});
await cloudBundle.close();
await writeFile(resolve(out,'runtime.mjs'),'export const STATIC_MODE=true;\n');
const html=(await readFile(resolve(out,'index.html'),'utf8')).replace('多人部署、账号数据独立、支持离线实验记录与文献管理的开源研究工作台。','公开文献索引与保存在当前浏览器的个人研究工作台。');
await writeFile(resolve(out,'index.html'),html);
await writeFile(resolve(out,'.nojekyll'),'');
console.log(`静态站点已生成：${out}（不含服务端、数据库或私人记录）`);
