import { resolve } from 'node:path';
import { openDatabase } from '../db.mjs';

if(process.env.DEPLOY_MODE!=='lan')throw new Error('仅局域网模式允许从服务器终端重置管理员密码。');
const origin=new URL(process.env.APP_ORIGIN||'http://127.0.0.1:4173').origin;
if(!origin.startsWith('https://')&&!['127.0.0.1','localhost','::1'].includes(new URL(origin).hostname))throw new Error('跨设备访问必须使用局域网 HTTPS 地址。');
const store=await openDatabase(resolve(process.env.DATA_DIR||'data','workbench.sqlite'));
try{
  const admin=(await store.listUsers()).find(user=>user.role==='admin');
  if(!admin)throw new Error('尚未创建管理员账号。');
  const token=await store.issueToken(admin.id,'reset',15*60_000);
  console.log(`管理员 ${admin.username} 的一次性密码重置链接（15 分钟有效）：`);
  console.log(`${origin}/#reset=${encodeURIComponent(token)}`);
  console.log('请仅在主机终端使用，并避免把链接保存在共享聊天或截图中。');
}finally{await store.close();}
