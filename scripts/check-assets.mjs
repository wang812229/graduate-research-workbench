import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
for (const file of ['index.html','styles.css','app.mjs','core.mjs','offline.mjs','runtime.mjs','catalog.json','sw.js','favicon.svg','manifest.webmanifest','server.mjs','server-v2.mjs','db-local.mjs','db-postgres.mjs','mailer.mjs','Caddyfile','Caddyfile.lan','compose.lan.yml','.env.lan.example','scripts/issue-admin-reset.mjs','scripts/build-static.mjs']) await access(resolve(root,file));
console.log('应用文件检查通过。服务端与前端由同一个 Node 进程提供，无需静态构建。');
