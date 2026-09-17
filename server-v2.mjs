import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.mjs';
import { createMailer } from './mailer.mjs';
import { validateEmail, normalizeEmail } from './auth-crypto.mjs';

const root=dirname(fileURLToPath(import.meta.url)),dataDir=resolve(process.env.DATA_DIR||resolve(root,'data'));
const port=Number(process.env.PORT||4173),host=process.env.HOST||'127.0.0.1';
const origin=new URL(process.env.APP_ORIGIN||`http://127.0.0.1:${port}`).origin;
const lanMode=process.env.DEPLOY_MODE==='lan';
if(process.env.NODE_ENV==='production'&&!process.env.DATABASE_URL&&!process.env.PGHOST)throw new Error('多用户部署需要 PostgreSQL 连接配置。');
if(lanMode&&!origin.startsWith('https://')&&!['127.0.0.1','localhost','::1'].includes(host))throw new Error('局域网多人访问必须通过 HTTPS；明文 HTTP 只允许本机试用。');
const store=await openDatabase(resolve(dataDir,'workbench.sqlite'));
const mailer=lanMode?{close:()=>{}}:createMailer({origin,dataDir});
if(process.env.NODE_ENV==='production'&&!lanMode)await mailer.verify();
let setupToken=await store.countUsers()?null:randomBytes(18).toString('base64url');
const attempts=new Map(),assets=new Set(['index.html','styles.css','app.mjs','core.mjs','offline.mjs','runtime.mjs','catalog.json','sw.js','favicon.svg','manifest.webmanifest']);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json; charset=utf-8'};
const send=(res,status,data,headers={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});res.end(JSON.stringify(data));};
const fail=(res,status,message)=>send(res,status,{error:message});
const cookie=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('yanxi_session='))?.slice(14)||'';
const sessionCookie=(token,maxAge)=>`yanxi_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin.startsWith('https://')?'; Secure':''}`;
const clientIp=req=>process.env.TRUST_PROXY==='1'&&req.headers['x-forwarded-for']?String(req.headers['x-forwarded-for']).split(',')[0].trim():req.socket.remoteAddress;
function limited(req,key,max=12){
  const id=`${clientIp(req)}:${key}`,now=Date.now(),recent=(attempts.get(id)||[]).filter(t=>now-t<60_000);recent.push(now);attempts.set(id,recent);
  if(attempts.size>5000)for(const [k,v] of attempts)if(!v.some(t=>now-t<60_000))attempts.delete(k);
  return recent.length>max;
}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>6_000_000)throw Object.assign(new Error('请求数据超过 6 MB。'),{status:413});}try{return JSON.parse(text||'{}');}catch{throw Object.assign(new Error('JSON 格式错误。'),{status:400});}}
function validVault(v){return v&&v.schema===1&&['experiments','papers','projects','tasks'].every(key=>Array.isArray(v[key])&&v[key].length<50000)&&v.profile&&typeof v.profile==='object';}
async function sendToken(user,purpose,ttl){
  const recent=await store.latestTokenAt(user.id,purpose);
  if(recent&&Date.now()-recent<60_000)return false;
  const token=await store.issueToken(user.id,purpose,ttl);
  await mailer.send({to:user.email,purpose,token});return true;
}
async function api(req,res,path){
  if(req.method!=='GET'&&req.method!=='HEAD'){
    const requestOrigin=req.headers.origin;
    if((process.env.NODE_ENV==='production'&&!requestOrigin)||requestOrigin&&new URL(requestOrigin).origin!==origin)return fail(res,403,'请求来源无效。');
  }
  if(path==='/api/health'&&req.method==='GET')return send(res,200,{ok:true});
  if(path==='/api/config'&&req.method==='GET')return send(res,200,{setupRequired:(await store.countUsers())===0,registrationOpen:await store.registrationOpen(),recoveryMode:lanMode?'admin':'email',version:'0.3.0'});
  if(path==='/api/register'&&req.method==='POST'){
    if(limited(req,'register',8))return fail(res,429,'注册请求过于频繁，请稍后再试。');
    const input=await body(req),first=(await store.countUsers())===0;
    if(first&&(!setupToken||input.setupToken!==setupToken))return fail(res,403,'管理员初始化口令不正确，请查看服务器终端。');
    if(!first&&!await store.registrationOpen())return fail(res,403,'管理员目前关闭了新用户注册。');
    let user;
    try{user=await store.createUser({username:input.username,displayName:input.displayName,email:lanMode?'':input.email,allowNoEmail:lanMode,password:input.password,role:first?'admin':'user',vault:{schema:1,profile:{updatedAt:new Date().toISOString(),materials:[],methods:[],measurements:[],journals:[],authors:[]},experiments:[],papers:[],projects:[],tasks:[]}});}
    catch(error){if(error.code==='23505'||error.code==='SQLITE_CONSTRAINT_UNIQUE'||/UNIQUE/.test(error.message))return fail(res,409,'用户名或邮箱已被使用。');return fail(res,400,error.message);}
    if(first||lanMode){if(first)setupToken=null;const {token}=await store.createSession(user.id);return send(res,200,{user,...await store.getVault(user.id)},{'set-cookie':sessionCookie(token,30*86400)});}
    try{await sendToken(user,'verify',30*60_000);}catch(error){console.error('Verification email failed:',error.message);return fail(res,503,'账号已创建，但验证邮件暂时发送失败。请稍后使用“重发验证邮件”。');}
    return send(res,202,{pendingVerification:true,message:'验证邮件已发送，请在 30 分钟内完成验证。'});
  }
  if(path==='/api/login'&&req.method==='POST'){
    if(limited(req,'login',15))return fail(res,429,'登录尝试过于频繁，请一分钟后再试。');
    const input=await body(req),user=await store.verifyLogin(input.username,input.password);
    if(!user)return fail(res,401,'用户名或密码错误、邮箱尚未验证，或账号已停用。');
    const {token}=await store.createSession(user.id);return send(res,200,{user,...await store.getVault(user.id)},{'set-cookie':sessionCookie(token,30*86400)});
  }
  if(path==='/api/resend-verification'&&req.method==='POST'){
    if(lanMode)return fail(res,404,'局域网模式不使用邮箱验证。');
    if(limited(req,'verify-mail',5))return fail(res,429,'请求过于频繁，请稍后再试。');
    const input=await body(req),user=validateEmail(input.email)?await store.findByEmail(input.email):null;
    if(user&&!user.emailVerified)try{await sendToken(user,'verify',30*60_000);}catch(error){console.error('Verification email failed:',error.message);}
    return send(res,200,{message:'如果邮箱对应尚未验证的账号，验证邮件会发送到该邮箱。'});
  }
  if(path==='/api/verify-email'&&req.method==='POST'){
    if(limited(req,'verify-token',10))return fail(res,429,'请求过于频繁。');
    const input=await body(req);return await store.consumeToken(input.token,'verify')?send(res,200,{ok:true}):fail(res,400,'链接无效或已过期，请重新获取验证邮件。');
  }
  if(path==='/api/request-reset'&&req.method==='POST'){
    if(lanMode)return send(res,200,{message:'请联系平台管理员，当面核实身份后索取一次性密码重置链接。'});
    if(limited(req,'reset-mail',5))return fail(res,429,'请求过于频繁，请稍后再试。');
    const input=await body(req),email=normalizeEmail(input.email),user=validateEmail(email)?await store.findByEmail(email):null;
    if(user?.emailVerified)try{await sendToken(user,'reset',15*60_000);}catch(error){console.error('Password reset email failed:',error.message);}
    return send(res,200,{message:'如果该邮箱已验证，重置链接会发送到邮箱。'});
  }
  if(path==='/api/reset-password'&&req.method==='POST'){
    if(limited(req,'reset-token',10))return fail(res,429,'请求过于频繁。');
    const input=await body(req);try{return await store.consumeToken(input.token,'reset',input.newPassword)?send(res,200,{ok:true}):fail(res,400,'链接无效或已过期，请重新申请。');}catch(error){return fail(res,400,error.message);}
  }
  const user=await store.getSession(cookie(req));if(!user)return fail(res,401,'请先登录。');
  if(path==='/api/me'&&req.method==='GET')return send(res,200,{user,...await store.getVault(user.id)});
  if(path==='/api/logout'&&req.method==='POST'){await store.removeSession(cookie(req));return send(res,200,{ok:true},{'set-cookie':sessionCookie('',0)});}
  if(path==='/api/vault'&&req.method==='PUT'){
    const input=await body(req);if(!Number.isInteger(input.revision)||!validVault(input.vault))return fail(res,400,'研究数据格式不正确。');
    const saved=await store.saveVault(user.id,input.revision,input.vault);
    return saved?send(res,200,saved):send(res,409,{error:'其他设备已更新数据，请合并后重试。',...await store.getVault(user.id)});
  }
  if(path==='/api/change-password'&&req.method==='POST'){
    const input=await body(req);try{if(!await store.changePassword(user.id,input.oldPassword,input.newPassword))return fail(res,400,'旧密码不正确。');}catch(error){return fail(res,400,error.message);}
    return send(res,200,{ok:true},{'set-cookie':sessionCookie('',0)});
  }
  if(path==='/api/email'&&req.method==='POST'){
    if(lanMode)return fail(res,404,'局域网模式不使用邮箱找回。');
    const input=await body(req);let updated;
    try{updated=await store.changeEmail(user.id,input.password,input.email);}catch(error){return fail(res,400,error.code==='23505'||/UNIQUE/.test(error.message)?'邮箱已被使用。':error.message);}
    if(!updated)return fail(res,400,'密码不正确。');
    try{await sendToken(updated,'verify',30*60_000);}catch(error){console.error('Verification email failed:',error.message);return fail(res,503,'邮箱已更新，但邮件暂时发送失败，请使用“重发验证邮件”。');}
    return send(res,200,{message:'验证邮件已发送，请在 30 分钟内完成验证。'});
  }
  if(path.startsWith('/api/admin/')){
    if(user.role!=='admin')return fail(res,403,'只有管理员可以管理账号。');
    if(path==='/api/admin/reset-link'&&req.method==='POST'){
      if(!lanMode)return fail(res,404,'邮箱模式请让用户自行申请重置邮件。');
      if(limited(req,'admin-reset',10))return fail(res,429,'请求过于频繁，请稍后再试。');
      const input=await body(req),target=(await store.listUsers()).find(candidate=>candidate.id===input.userId);
      if(!target||target.role==='admin'||target.disabled)return fail(res,400,'仅能为正常使用的普通账号生成重置链接。');
      const token=await store.issueToken(target.id,'reset',15*60_000);
      console.log(`管理员为账号 ${target.username} 创建了一次性重置链接。`);
      return send(res,200,{username:target.username,link:`${origin}/#reset=${encodeURIComponent(token)}`,expiresInMinutes:15});
    }
    if(path==='/api/admin/users'&&req.method==='GET')return send(res,200,{users:await store.listUsers()});
    if(path==='/api/admin/registration'&&req.method==='POST'){const input=await body(req);await store.setRegistrationOpen(Boolean(input.open));return send(res,200,{registrationOpen:await store.registrationOpen()});}
    if(path==='/api/admin/status'&&req.method==='POST'){const input=await body(req);try{await store.setDisabled(input.userId,Boolean(input.disabled));return send(res,200,{ok:true});}catch(error){return fail(res,400,error.message);}}
  }
  return fail(res,404,'接口不存在。');
}
const server=http.createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
    res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(origin.startsWith('https://'))res.setHeader('strict-transport-security','max-age=31536000; includeSubDomains');
    if(path.startsWith('/api/'))return await api(req,res,path);
    if(req.method!=='GET'&&req.method!=='HEAD')return fail(res,405,'不支持的请求。');
    const name=path==='/'?'index.html':decodeURIComponent(path).replace(/^\//,'');
    if(!assets.has(name))return fail(res,404,'文件不存在。');
    const file=resolve(root,name);if(!(await stat(file)).isFile())return fail(res,404,'文件不存在。');
    const bytes=await readFile(file);
    res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream','cache-control':name==='sw.js'?'no-cache':'public, max-age=300'});
    res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){console.error('Request error:',error);return fail(res,error.status||500,error.status?error.message:'服务器处理请求时出错。');}
});
server.listen(port,host,()=>{console.log(`研析研究工作台：http://${host}:${port}`);if(setupToken)console.log(`首次管理员初始化口令（仅服务器终端显示）：${setupToken}`);});
process.on('SIGTERM',async()=>{server.close();mailer.close();await store.close();process.exit(0);});
