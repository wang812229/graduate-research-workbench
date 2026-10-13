import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'dist-static');
const files=['index.html','styles.css','app.mjs','core.mjs','processing-workspace.mjs','offline.mjs','research-package.mjs','experiment-journal.mjs','experiment-journal-ui.mjs','qrcode-vendor.mjs','QR-CODE-LICENSE.txt','catalog.json','sw.js','favicon.svg','manifest.webmanifest','cloud-config.json','xrd-refinement.html','xrd-refinement.css','xrd-refinement.mjs'];
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const file of files)await cp(resolve(root,file),resolve(out,file));
await mkdir(resolve(out,'xrd-refinement'),{recursive:true});
for(const file of ['rigaku-ultima-iv-185.json','skill-integration.md'])await cp(resolve(root,'xrd-refinement',file),resolve(out,'xrd-refinement',file));
const cloudBundle=await rollup({input:resolve(root,'cloud-client.mjs'),plugins:[nodeResolve({browser:true})]});
await cloudBundle.write({file:resolve(out,'cloud-client.bundle.mjs'),format:'es'});
await cloudBundle.close();
await writeFile(resolve(out,'runtime.mjs'),'export const STATIC_MODE=true;\n');
const versionedAssets=['app.mjs','core.mjs','processing-workspace.mjs','offline.mjs','research-package.mjs','experiment-journal.mjs','experiment-journal-ui.mjs','qrcode-vendor.mjs','runtime.mjs','cloud-client.bundle.mjs','styles.css','xrd-refinement.mjs','xrd-refinement.css'];
const hash=createHash('sha256');
for(const file of versionedAssets)hash.update(await readFile(resolve(out,file)));
const version=hash.digest('hex').slice(0,12);
let app=await readFile(resolve(out,'app.mjs'),'utf8');
for(const file of ['core.mjs','processing-workspace.mjs','offline.mjs','research-package.mjs','experiment-journal.mjs','experiment-journal-ui.mjs','qrcode-vendor.mjs','runtime.mjs','cloud-client.bundle.mjs'])app=app.replaceAll(`'./${file}'`,`'./${file}?v=${version}'`);
await writeFile(resolve(out,'app.mjs'),app);
for(const file of ['core.mjs','experiment-journal-ui.mjs','processing-workspace.mjs']){let content=await readFile(resolve(out,file),'utf8');content=content.replaceAll("'./experiment-journal.mjs'",`'./experiment-journal.mjs?v=${version}'`).replaceAll("'./core.mjs'",`'./core.mjs?v=${version}'`);await writeFile(resolve(out,file),content);}
const html=(await readFile(resolve(out,'index.html'),'utf8'))
  .replace('多人部署、账号数据独立、支持离线实验记录与文献管理的开源研究工作台。','公开文献索引与保存在当前浏览器的个人研究工作台。')
  .replace('href="./styles.css"',`href="./styles.css?v=${version}"`)
  .replace('src="./app.mjs"',`src="./app.mjs?v=${version}"`);
await writeFile(resolve(out,'index.html'),html);
const xrdHtml=(await readFile(resolve(out,'xrd-refinement.html'),'utf8'))
  .replace('href="./xrd-refinement.css"',`href="./xrd-refinement.css?v=${version}"`)
  .replace('src="./xrd-refinement.mjs"',`src="./xrd-refinement.mjs?v=${version}"`);
await writeFile(resolve(out,'xrd-refinement.html'),xrdHtml);
const worker=(await readFile(resolve(out,'sw.js'),'utf8')).replace(/\bv8\b/,`v8-${version}`);
await writeFile(resolve(out,'sw.js'),worker);
await writeFile(resolve(out,'.nojekyll'),'');
console.log(`静态站点已生成：${out}（不含服务端、数据库或私人记录）`);
