import { emptyVault, normalizeExperiment, normalizePaper, parseImport, mergeVault, experimentsCsv, formatSchedule, parseSchedule, temperatureSeries, PROFILE_KEYS, PAPER_GROUPS, escapeHtml as h, newId } from './core.mjs';
import { unlockOffline, createOfflineSession, saveOffline, registerLocalAccount, deleteLocalAccount, listLocalAccounts } from './offline.mjs';
import { STATIC_MODE } from './runtime.mjs';

const app=document.querySelector('#app');
let catalog=[], config={setupRequired:false,registrationOpen:true}, session=null, view=STATIC_MODE?'public':'dashboard', selectedExperiment=null, selectedPaper=null, selectedProject=null, notice='', importPreview=null, syncRunning=false, editVersion=0, paperQuery='', publicQuery='', publicPage=0, selectedPublic=null, localAccounts=[], localPersistence=null, lastBackupAt='', cloudClient=null, cloudConfigured=false, authBackend='local';
const day=()=>new Date().toISOString().slice(0,10);
const dateLabel=value=>value ? new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'short',day:'numeric'}) : '—';
const active = items => items.filter(x=>!x.archived);
const download=(name,text,type='application/json')=>{const url=URL.createObjectURL(new Blob([text],{type:`${type};charset=utf-8`}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),3000);};
const json=(name,data)=>download(name,JSON.stringify(data,null,2));
const backupKey=username=>`yanxi-backup:${location.pathname}:${username}`;
async function request(path,method='GET',bodyValue){
  const response=await fetch(path,{method,credentials:'same-origin',headers:bodyValue?{'content-type':'application/json'}:{},body:bodyValue?JSON.stringify(bodyValue):undefined});
  const data=await response.json().catch(()=>({error:'服务器响应无法解析。'}));
  if(!response.ok){const err=new Error(data.error||'请求失败。');err.status=response.status;err.payload=data;throw err;}return data;
}
function toast(message){notice=message;render();setTimeout(()=>{if(notice===message){notice='';document.querySelector('.toast')?.remove();}},6500);}
function syncLabel(){return session?.cloud?(session.offline?'云端离线 · 待同步':session.dirty?'云端同步中…':'已同步到云端'):STATIC_MODE?'仅保存在此设备':session.offline?'离线记录中 · 待同步':session.dirty?'正在同步…':'已同步';}
function updateStatus(){const el=document.querySelector('#sync-status');if(el&&session)el.textContent=syncLabel();}
async function cache(){if(session?.key) await saveOffline(session.user.username,session.key,{user:session.user,vault:session.vault,revision:session.revision,dirty:session.dirty});}
async function commit(next){session.vault=next;session.dirty=!STATIC_MODE||Boolean(session.cloud);editVersion++;await cache();render();if(!STATIC_MODE||session.cloud)void flush();}
async function flush(){
  if(STATIC_MODE&&!session?.cloud)return;
  if(!session||session.offline||syncRunning||!session.dirty)return;
  syncRunning=true;
  try{
    for(let tries=0;tries<4&&session.dirty;tries++){
      const version=editVersion, sent=structuredClone(session.vault);
      try{
        const saved=session.cloud?await cloudClient.write(session.user.id,session.revision,sent):await request('/api/vault','PUT',{revision:session.revision,vault:sent});
        if(saved.conflict){session.vault=mergeVault(saved.vault||emptyVault(),session.vault);session.revision=saved.revision;editVersion++;render();continue;}
        session.revision=saved.revision;
        if(version===editVersion)session.dirty=false;
      }catch(error){
        if(error.status===409){session.vault=mergeVault(error.payload.vault,session.vault);session.revision=error.payload.revision;editVersion++;render();continue;}
        if(error instanceof TypeError||error.code==='auth/network-request-failed'){session.offline=true;toast('网络已断开。更改保存在这台设备，重新联网后会尝试同步。');break;}
        toast(`同步失败：${error.message}`);break;
      }
    }
    await cache();updateStatus();
  }finally{syncRunning=false;}
}
async function login(username,password,registerValues){
  if(STATIC_MODE&&authBackend==='cloud'&&cloudConfigured){
    const email=String(username||'').trim().toLowerCase();
    try{
      const user=registerValues?await cloudClient.register(email,password,registerValues.displayName):await cloudClient.login(email,password);
      if(user.pendingVerification){authTab='login';toast('验证邮件已发送。请先点击邮件中的验证链接，再返回登录。');return;}
      const remote=await cloudClient.read(user.id);
      let vault=remote.vault||emptyVault(),dirty=Boolean(registerValues||!remote.vault);
      try{const previous=await unlockOffline(email,password);if(previous.dirty){vault=mergeVault(vault,previous.vault);dirty=true;}}catch{}
      const key=await createOfflineSession(email,password,{user,vault,revision:remote.revision,dirty});
      session={user,vault,revision:remote.revision,key,offline:false,dirty,cloud:true};
      view='dashboard';render();if(dirty)void flush();return;
    }catch(error){
      if(!registerValues&&(error instanceof TypeError||error.code==='auth/network-request-failed')){
        const saved=await unlockOffline(email,password);
        session={...saved,cloud:true,offline:true};view='dashboard';render();toast('已解锁本机缓存。重新联网并登录后会同步。');return;
      }
      throw error;
    }
  }
  if(STATIC_MODE){
    const local=registerValues?await registerLocalAccount(username,registerValues.displayName,password,emptyVault()):await unlockOffline(username,password);
    if(registerValues)localAccounts=await listLocalAccounts();
    session={...local,offline:false,dirty:false};view='dashboard';
    try{lastBackupAt=localStorage.getItem(backupKey(local.user.username))||'';}catch{lastBackupAt='';}
    try{localPersistence=await navigator.storage?.persisted?.()??null;}catch{localPersistence=null;}
    render();
    if(!registerValues&&local.vault.experiments.length+local.vault.papers.length+local.vault.projects.length>0&&(!lastBackupAt||Date.now()-Date.parse(lastBackupAt)>7*86400_000))toast('这份本机资料已有记录，建议现在导出一份完整 JSON 备份。');
    return;
  }
  try{
    const answer=await request(registerValues?'/api/register':'/api/login','POST',registerValues?{...registerValues,username,password}:{username,password});
    if(answer.pendingVerification){authTab='login';toast(answer.message||'请查收验证邮件后再登录。');return;}
    let vault=answer.vault,dirty=false;
    try{const previous=await unlockOffline(answer.user.username,password);if(previous.dirty){vault=mergeVault(answer.vault,previous.vault);dirty=true;}}catch{}
    const key=await createOfflineSession(answer.user.username,password,{user:answer.user,vault,revision:answer.revision,dirty});
    session={user:answer.user,vault,revision:answer.revision,key,offline:false,dirty};
    view='dashboard';render();if(dirty)void flush();
  }catch(error){
    if(error instanceof TypeError&&!registerValues){
      const saved=await unlockOffline(username,password);
      session={...saved,offline:true};view='dashboard';render();toast('已离线解锁。修改会保存在本机，恢复联网后同步。');return;
    }
    throw error;
  }
}
function field(label,name,value='',type='text',placeholder='',extra='') {return `<label class="field"><span>${h(label)}</span><input name="${h(name)}" type="${type}" value="${h(value)}" placeholder="${h(placeholder)}" ${extra}></label>`;}
function area(label,name,value='',placeholder='',rows=3){return `<label class="field wide"><span>${h(label)}</span><textarea name="${h(name)}" rows="${rows}" placeholder="${h(placeholder)}">${h(value)}</textarea></label>`;}
function options(values,current=''){return values.map(v=>`<option value="${h(v)}" ${v===current?'selected':''}>${h(v)}</option>`).join('');}
function blank(text,detail='',action=''){return `<div class="blank"><span class="blank-mark">✦</span><h3>${h(text)}</h3><p>${h(detail)}</p>${action}</div>`;}
let authTab='login';
function sidebar(){const links=[...(STATIC_MODE?[['public','公开文献','⌕']]:[]),['dashboard','总览','◫'],['experiments','实验记录','◩'],['literature','文献库','▤'],['projects','课题追踪','◇'],['settings','数据与设置','⚙']];if(session.user.role==='admin')links.push(['admin','账号管理','♧']);return `<aside class="sidebar"><div class="brand"><span class="brand-mark">研</span><span>研析<small>研究生工作平台</small></span></div><nav aria-label="主导航">${links.map(([id,label,icon])=>`<button type="button" class="nav-link ${view===id?'active':''}" data-view="${id}"><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}</nav><div class="side-bottom"><div class="identity"><span class="avatar">${h(session.user.displayName?.slice(0,1)||'研')}</span><span><b>${h(session.user.displayName)}</b><small>${session.cloud?'云端个人账号':STATIC_MODE?'此设备的个人资料':session.user.role==='admin'?'管理员':'研究成员'}</small></span></div><button type="button" class="quiet logout" data-action="logout">${session.cloud?'退出云账号':STATIC_MODE?'锁定个人资料':'退出账号'} ↗</button></div></aside>`;}
function shell(body){return `<div class="shell">${sidebar()}<div class="main-wrap"><header class="topbar"><button class="mobile-menu" data-action="menu" aria-label="打开导航">☰</button><span class="topbar-label">${({dashboard:'今日概览',experiments:'实验记录',literature:'文献管理',projects:'课题追踪',settings:'数据与设置',admin:'账号管理',public:'公开文献'})[view]}</span><div class="topbar-right"><span class="sync-dot ${session.offline?'offline':''}"></span><span id="sync-status">${syncLabel()}</span><span class="top-avatar">${h(session.user.displayName?.slice(0,1)||'研')}</span></div></header><main class="main-content">${body}</main></div></div>${toastHtml()}`;}
function toastHtml(){return notice?`<div class="toast" role="status">${h(notice)}<button data-action="dismiss" aria-label="关闭提示">×</button></div>`:'';}

let authToken='';
function cloudAuthView(){
  const title={login:'登录免费云账号',register:'创建免费云账号',forgot:'找回密码',resend:'重发验证邮件'}[authTab]||'登录免费云账号';
  const form=authTab==='forgot'?`<form data-form="forgot" class="stack">${field('注册邮箱','email','','email','name@example.com','required autocomplete="email"')}<button class="button primary full" type="submit">发送重置邮件</button></form><button class="text-button auth-secondary" data-action="auth-tab" data-tab="login">← 返回登录</button>`:authTab==='resend'?`<form data-form="cloud-resend" class="stack">${field('注册邮箱','email','','email','name@example.com','required autocomplete="email"')}${field('密码','password','','password','','required autocomplete="current-password"')}<button class="button primary full" type="submit">重发验证邮件</button></form><button class="text-button auth-secondary" data-action="auth-tab" data-tab="login">← 返回登录</button>`:`<div class="auth-tabs"><button type="button" data-action="auth-tab" data-tab="login" class="${authTab==='login'?'selected':''}">登录</button><button type="button" data-action="auth-tab" data-tab="register" class="${authTab==='register'?'selected':''}">注册</button></div><form data-form="auth" class="stack"><input type="hidden" name="mode" value="${authTab}">${authTab==='register'?field('显示名称','displayName','','text','你的姓名或昵称','required'):''}${field('邮箱地址','username','','email','name@example.com','required autocomplete="email"')}${field('密码','password','','password','至少 10 个字符',`required minlength="10" autocomplete="${authTab==='register'?'new-password':'current-password'}"`)}<button class="button primary full" type="submit">${authTab==='register'?'创建免费账号':'登录工作台'} →</button></form>${authTab==='login'?'<button class="text-button auth-secondary" data-action="auth-tab" data-tab="forgot">忘记密码？</button><button class="text-button auth-secondary" data-action="auth-tab" data-tab="resend">重发验证邮件</button>':''}`;
  return `<main class="auth-shell"><div class="auth-art"><div class="brand brand-large"><span class="brand-mark">研</span><span>研析<span class="brand-sub">RESEARCH WORKBENCH</span></span></div><div class="auth-story"><span class="eyebrow">A CALMER WAY TO RESEARCH</span><h1>把每一次实验，<br>都变成下一步的线索。</h1><p>公开文献自由检索；私人实验、文献与课题登录后跨设备同步。</p><div class="story-grid"><span><b>01</b> 记录每次尝试</span><span><b>02</b> 连接论文与实验</span><span><b>03</b> 复盘下一步</span></div></div><p class="auth-foot">开源 · Spark 免费方案 · 本地备份</p></div><section class="auth-panel"><div class="auth-card"><span class="eyebrow">CLOUD ACCOUNT</span><h2>${title}</h2><p>同一邮箱账号可在不同设备登录。云同步需联网，已有缓存可离线编辑。</p>${form}<div class="auth-hint">站点使用 Firebase Spark 免费方案，不接入付款功能。免费额度用尽时云同步可能暂停；请定期导出 JSON。邮箱重置无法解锁旧密码加密且未同步的缓存。</div><button class="text-button auth-secondary" data-action="switch-backend" data-backend="local">改用仅保存在本机的资料</button><button class="text-button auth-secondary" data-action="public-home">← 浏览公开文献</button></div></section></main>${toastHtml()}`;
}
function authViewV2(){
  if(STATIC_MODE&&cloudConfigured&&authBackend==='cloud')return cloudAuthView();
  const titles={login:'进入工作台',register:STATIC_MODE?'在此设备创建资料':config.setupRequired?'初始化管理员':'创建研究账号',forgot:'找回密码',resend:'重发验证邮件',reset:'设置新密码',verify:'验证邮箱'};
  const descriptions={login:STATIC_MODE?'请输入这台设备上的用户名和密码。':'已有账号请登录；离线登录时请使用用户名。',register:STATIC_MODE?'资料只保存在当前浏览器，不是跨设备通用账号。':config.setupRequired?'使用服务器终端显示的一次性口令创建管理员账号。':config.recoveryMode==='admin'?'注册后可以直接使用；忘记密码时请联系管理员。':'注册后请查收验证邮件，完成邮箱验证再登录。',forgot:STATIC_MODE?'本机资料没有邮件找回。忘记密码时，只有之前导出的备份可迁移到新资料。':config.recoveryMode==='admin'?'请联系管理员，当面核实身份后获取一次性重置链接。':'输入注册时验证过的邮箱，我们会发送一次性重置链接。',resend:'如果尚未完成邮箱验证，可重新发送验证链接。',reset:'设置新密码后，其他设备的登录状态会失效。',verify:'确认验证此邮箱，然后返回登录。'};
  let form='';
  const recoveryActions=authTab==='login'?'<button class="text-button auth-secondary" data-action="auth-tab" data-tab="forgot">忘记密码？</button>'+(config.recoveryMode==='email'?'<button class="text-button auth-secondary" data-action="auth-tab" data-tab="resend">重发验证邮件</button>':''):'';
  if(authTab==='login'||authTab==='register')form=`<div class="auth-tabs"><button type="button" data-action="auth-tab" data-tab="login" class="${authTab==='login'?'selected':''}">登录</button>${config.registrationOpen||config.setupRequired?`<button type="button" data-action="auth-tab" data-tab="register" class="${authTab==='register'?'selected':''}">注册</button>`:''}</div><form data-form="auth" class="stack"><input type="hidden" name="mode" value="${authTab}">${authTab==='register'?field('显示名称','displayName','','text','你的姓名或昵称','required'):''}${field(authTab==='login'?(config.recoveryMode==='email'?'用户名或邮箱':'用户名'):'用户名','username','','text',authTab==='login'?(config.recoveryMode==='email'?'用户名或已验证邮箱':'用户名'):'3–32 位字母、数字或 . _ -','required autocomplete="username"')}${authTab==='register'&&config.recoveryMode==='email'?field('邮箱地址','email','','email','用于验证和找回密码','required autocomplete="email"'):''}${field('密码','password','','password','至少 10 个字符',`required minlength="10" autocomplete="${authTab==='register'?'new-password':'current-password'}"`)}${config.setupRequired&&authTab==='register'?field('管理员初始化口令','setupToken','','text','查看运行服务的终端','required'):''}<button class="button primary full" type="submit">${authTab==='register'?'创建账号':'登录工作台'} →</button></form>${recoveryActions}`;
  else if(authTab==='forgot'&&STATIC_MODE)form='<p class="privacy-note">本机资料使用密码加密，没有服务器和邮箱找回。若已导出完整 JSON，可新建资料后导入；没有备份且忘记密码时，旧资料无法恢复。</p><button class="text-button auth-secondary" data-action="auth-tab" data-tab="login">← 返回解锁</button>';
  else if(authTab==='forgot'&&config.recoveryMode==='admin')form='<p class="privacy-note">局域网模式不发送邮件。请联系平台管理员，由管理员当面核实身份后生成 15 分钟有效的一次性重置链接。</p><button class="text-button auth-secondary" data-action="auth-tab" data-tab="login">← 返回登录</button>';
  else if(authTab==='forgot'||authTab==='resend')form=`<form data-form="${authTab}" class="stack">${field('注册邮箱','email','','email','name@example.com','required autocomplete="email"')}<button class="button primary full" type="submit">${authTab==='forgot'?'发送重置链接':'重发验证邮件'}</button></form><button class="text-button auth-secondary" data-action="auth-tab" data-tab="login">← 返回登录</button>`;
  else if(authTab==='reset')form=`<form data-form="reset" class="stack">${field('新密码','newPassword','','password','至少 10 个字符','required minlength="10" autocomplete="new-password"')}${field('确认新密码','confirmPassword','','password','再次输入新密码','required minlength="10" autocomplete="new-password"')}<button class="button primary full" type="submit">重置密码</button></form><p class="privacy-note">如果这台设备还有未同步的离线记录，重置后无法用新密码解开旧密码加密的缓存。若仍记得旧密码，请先离线登录并导出备份。</p>`;
  else if(authTab==='verify')form='<form data-form="verify" class="stack"><button class="button primary full" type="submit">验证邮箱</button></form>';
  return `<main class="auth-shell"><div class="auth-art"><div class="brand brand-large"><span class="brand-mark">研</span><span>研析<span class="brand-sub">RESEARCH WORKBENCH</span></span></div><div class="auth-story"><span class="eyebrow">A CALMER WAY TO RESEARCH</span><h1>把每一次实验，<br>都变成下一步的线索。</h1><p>实验记录、温度程序、文献与课题放在一个地方。每个人可在自己的设备记录；公开文献对所有人可见。</p><div class="story-grid"><span><b>01</b> 记录每次尝试</span><span><b>02</b> 连接论文与实验</span><span><b>03</b> 复盘下一步</span></div></div><p class="auth-foot">开源 · 公开文献 · 本机资料</p></div><section class="auth-panel"><div class="auth-card"><span class="eyebrow">WELCOME BACK</span><h2>${titles[authTab]||'进入工作台'}</h2><p>${descriptions[authTab]||'输入邮箱以继续。'}</p>${form}<div class="auth-hint">${STATIC_MODE?'此设备资料无法通过邮箱找回；请定期导出 JSON 备份。':config.recoveryMode==='admin'?'忘记密码时联系管理员；请定期导出研究数据备份。':'邮箱验证后可找回密码；请定期导出研究数据备份。'}</div>${STATIC_MODE?`${cloudConfigured?'<button class="text-button auth-secondary" data-action="switch-backend" data-backend="cloud">改用云账号跨设备同步</button>':''}<button class="text-button auth-secondary" data-action="public-home">← 浏览公开文献</button>`:''}</div></section></main>${toastHtml()}`;
}
function dashboard(){const v=session.vault,experiments=active(v.experiments),papers=active(v.papers),projects=active(v.projects),tasks=active(v.tasks),recent=[...experiments].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,4),due=tasks.filter(t=>t.status!=='完成').sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,4);return `<div class="page-intro"><div><span class="eyebrow">GOOD TO SEE YOU</span><h1>${h(session.user.displayName)}，继续推进你的研究。</h1><p>把今天的实验、阅读和课题进展，接到已经积累的线索上。</p></div><button class="button primary" data-view="experiments" data-action="new-experiment">＋ 新建实验记录</button></div><section class="stat-grid"><article class="stat-card"><span>实验记录</span><strong>${experiments.length}</strong><small>不同类型的实验都在这里</small></article><article class="stat-card"><span>我的文献</span><strong>${papers.length}</strong><small>已整理到私人文献库</small></article><article class="stat-card"><span>进行中课题</span><strong>${projects.filter(p=>p.status!=='已完成').length}</strong><small>下一步更清楚</small></article><article class="stat-card"><span>待办事项</span><strong>${tasks.filter(t=>t.status!=='完成').length}</strong><small>随时回顾关键节点</small></article></section><div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><span class="eyebrow">RECENT ACTIVITY</span><h2>最近实验</h2></div><button class="text-button" data-view="experiments">查看全部 →</button></div>${recent.length?recent.map(r=>`<button class="row-link" data-view="experiments" data-select-experiment="${h(r.id)}"><span class="row-icon">⌁</span><span><b>${h(r.sampleId||'未编号')} · ${h(r.material||'未标注对象')}</b><small>${h(r.method||'方法未填')} · ${h(r.project)}</small></span><time>${h(r.date)}</time></button>`).join(''):blank('从第一条实验开始','写下研究对象、条件和观察，往后每次复盘都会更轻松。','<button class="button subtle" data-view="experiments" data-action="new-experiment">记录实验</button>')}</section><section class="panel"><div class="panel-head"><div><span class="eyebrow">NEXT UP</span><h2>下一步</h2></div><button class="text-button" data-view="projects">课题看板 →</button></div>${due.length?due.map(t=>`<div class="task-row"><span class="task-dot"></span><span><b>${h(t.title)}</b><small>${h(t.project||'未关联课题')} · ${t.dueDate?h(t.dueDate):'未设截止日期'}</small></span></div>`).join(''):blank('今天还没有待办','可以在“课题追踪”里安排下次实验、测量或组会准备。')}</section></div><section class="panel hint-panel"><div><span class="eyebrow">RESEARCH PRACTICE</span><h2>研究笔记从不该只停留在一次实验里。</h2><p>把实验编号、关键条件、质量指标和关联文献放在一起，下一次实验的决策才有依据。</p></div><button class="button subtle" data-view="settings">导入旧研究面板 →</button></section>`;}

let experimentMode='detail';
function scheduleChart(stages){
  if(!stages?.length)return `<div class="chart-empty"><span>⌁</span><b>尚未记录温度程序</b><small>补充阶段、持续时间与温区后，这里会绘出时间—温度示意图。</small></div>`;
  const points=temperatureSeries(stages), all=points.flatMap(p=>[p.sourceC,p.growthC]).filter(Number.isFinite),lo=Math.floor(Math.min(...all,0)/100)*100,hi=Math.ceil(Math.max(...all,100)/100)*100||100,total=points.at(-1).t||1;
  const x=t=>58+t/total*596,y=v=>194-(v-lo)/(hi-lo||1)*150;
  const line=key=>{let chunks=[],part=[];for(const p of points){if(Number.isFinite(p[key]))part.push(`${part.length?'L':'M'}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`);else if(part.length){chunks.push(part.join(' '));part=[];}}if(part.length)chunks.push(part.join(' '));return chunks.map(c=>`<path d="${c}"/>`).join('');};
  const ticks=[0,.25,.5,.75,1].map(f=>`<line x1="${x(total*f)}" x2="${x(total*f)}" y1="42" y2="194"/><text x="${x(total*f)}" y="218">${(total*f).toFixed(total<10?1:0)} h</text>`).join('');
  const levels=[0,.5,1].map(f=>`<line x1="58" x2="654" y1="${y(lo+(hi-lo)*f)}" y2="${y(lo+(hi-lo)*f)}"/><text x="48" y="${y(lo+(hi-lo)*f)+4}" text-anchor="end">${Math.round(lo+(hi-lo)*f)}</text>`).join('');
  return `<div class="chart-wrap"><svg viewBox="0 0 700 240" role="img" aria-label="温度程序：横轴小时，纵轴摄氏度，蓝线为源区，紫线为生长区"><g class="grid-lines">${ticks}${levels}</g><g class="source-line">${line('sourceC')}</g><g class="growth-line">${line('growthC')}</g>${points.slice(1).map(p=>`<circle class="chart-point" cx="${x(p.t)}" cy="${y(p.growthC??p.sourceC)}" r="4"><title>${h(p.label)} · ${p.t} h · 源区 ${p.sourceC??'—'} °C · 生长区 ${p.growthC??'—'} °C</title></circle>`).join('')}</svg><div class="chart-legend"><span><i class="legend-source"></i>温区 A / 源区</span><span><i class="legend-growth"></i>温区 B / 生长区</span><span>总时长 ${total} h</span></div><p class="chart-note">阶段节点以直线连接，仅表示录入的程序节点，不代表实测曲线或未记录的升降温速率。</p></div>`;
}
const describe=(label,value)=>`<div class="detail-pair"><dt>${h(label)}</dt><dd>${h(value||'—')}</dd></div>`;
function experimentDetail(record){return `<div class="detail-head"><div><span class="eyebrow">EXPERIMENT RECORD</span><h2>${h(record.sampleId)} <span>· ${h(record.material)}</span></h2><p>${h(record.date)} · ${h(record.project)} · ${h(record.method||'方法未填')}</p></div><div class="button-group"><button class="button subtle" data-action="edit-experiment">编辑</button><button class="button subtle" data-action="export-experiment">导出</button></div></div><section class="section-block"><div class="section-title"><h3>温度程序</h3><span>TIME–TEMPERATURE</span></div>${scheduleChart(record.schedule)}</section><section class="section-block"><div class="section-title"><h3>研究对象与实验条件</h3><span>EXPERIMENT LOG</span></div><dl class="detail-grid">${[['批次 / 编号',record.batch],['配方 / 输入参数',record.ratio],['关键试剂 / 条件',record.agent],['容器 / 设备',record.vessel],['真空与气氛',record.atmosphere],['温区 A / 源区',record.sourceTemp],['温区 B / 生长区',record.growthTemp],['峰值温度',record.peakTemp],['保温时间',record.holdTime],['降温速率',record.coolingRate],['后处理',record.postTreatment],['产物 / 尺寸',record.crystalSize],['产率',record.yield]].map(([a,b])=>describe(a,b)).join('')}</dl></section><section class="section-block"><div class="section-title"><h3>测量与复盘</h3><span>MEASURE & LEARN</span></div><dl class="detail-stack">${[['测量项目与条件',record.measurements],['关键结果',record.results],['质量指标',record.quality],['问题与下一次实验',record.notes]].map(([a,b])=>describe(a,b)).join('')}</dl></section><div class="detail-footer"><button class="text-button danger" data-action="archive-experiment">归档这条记录</button></div>`;}
function experimentForm(record){const r=record||{date:day(),method:'',project:''},editing=Boolean(record);return `<div class="detail-head"><div><span class="eyebrow">${editing?'EDIT RECORD':'NEW RECORD'}</span><h2>${editing?'编辑实验':'记录一次实验'}</h2><p>从实验身份开始；尚未知晓的参数可以暂时留空，后续补充。</p></div><button class="button subtle" data-action="cancel-experiment">返回记录</button></div><form data-form="experiment" class="editor-form"><input type="hidden" name="id" value="${h(r.id||'')}"><section class="section-block"><div class="section-title"><h3>01 · 实验身份</h3></div><div class="form-grid">${field('实验编号 / 名称 *','sampleId',r.sampleId,'text','如 CVT-026 或 输运测量-01', 'required')}${field('研究对象 / 体系 *','material',r.material,'text','如 α-RuCl₃ 或 数据集名称','required')}${field('课题','project',r.project,'text','如 二维磁体晶体生长')}${field('日期','date',r.date,'date')}${field('批次 / 编号','batch',r.batch)}${field('实验方法 / 类型','method',r.method,'text','如 CVT、低温输运、光谱、计算')}</div></section><section class="section-block"><div class="section-title"><h3>02 · 实验条件</h3></div><div class="form-grid">${field('配方 / 输入参数','ratio',r.ratio,'text','原料与化学计量比')}${field('关键试剂 / 条件','agent',r.agent,'text','如 I₂，5 mg/mL')}${field('容器 / 设备','vessel',r.vessel)}${field('真空 / 气氛','atmosphere',r.atmosphere)}${field('温区 A / 源区','sourceTemp',r.sourceTemp,'text','°C')}${field('温区 B / 生长区','growthTemp',r.growthTemp,'text','°C')}${field('峰值温度','peakTemp',r.peakTemp,'text','°C')}${field('保温时间','holdTime',r.holdTime,'text','小时')}${field('降温速率','coolingRate',r.coolingRate,'text','°C/h')}${field('后处理','postTreatment',r.postTreatment)}${field('产物 / 尺寸','crystalSize',r.crystalSize)}${field('产率','yield',r.yield)}</div></section><section class="section-block"><div class="section-title"><h3>03 · 温度程序</h3><span>一行一个阶段</span></div>${area('阶段 | 持续小时 | 温区 A °C | 温区 B °C','scheduleText',formatSchedule(r.schedule||[]),'升温|10|850|800\n保温|48|850|800\n降温|24|700|650',5)}<p class="field-help">例如：保温|48|850|800。单温区实验可留空温区 B。图线仅连接你录入的节点。</p><div id="schedule-preview">${scheduleChart(r.schedule||[])}</div></section><section class="section-block"><div class="section-title"><h3>04 · 测量与下一步</h3></div><div class="form-grid">${area('测量项目与条件','measurements',r.measurements,'温度、磁场、接线方式、仪器等')}${area('关键结果','results',r.results,'定量数据、现象及误差')}${area('质量指标','quality',r.quality,'RRR、XRD、EDS、摇摆曲线等')}${area('问题与下一次实验','notes',r.notes,'失败原因、下次调整、样品放行标准')}</div></section><div class="form-actions"><button class="button primary" type="submit">保存实验记录</button><button class="button subtle" type="button" data-action="cancel-experiment">取消</button></div></form>`;}
function experimentsView(){const records=[...active(session.vault.experiments)].sort((a,b)=>(b.date||'').localeCompare(a.date||'')), selected=records.find(r=>r.id===selectedExperiment)||records[0], form=experimentMode==='new'?experimentForm(null):experimentMode==='edit'?experimentForm(selected):selected?experimentDetail(selected):blank('还没有实验记录','把第一次实验记下来，形成可复盘的实验链。','<button class="button primary" data-action="new-experiment">＋ 新建实验</button>');return `<div class="page-intro compact"><div><span class="eyebrow">LAB NOTEBOOK</span><h1>实验记录</h1><p>从实验条件、温度程序到测量结果，保留完整的实验脉络。</p></div><div class="button-group"><button class="button subtle" data-action="export-experiments-csv">导出 CSV</button><button class="button primary" data-action="new-experiment">＋ 新建实验</button></div></div><div class="workspace-grid"><aside class="list-panel"><div class="list-panel-title"><b>全部记录</b><span>${records.length}</span></div>${records.length?records.map(r=>`<button class="item-row ${selected?.id===r.id&&experimentMode==='detail'?'selected':''}" data-select-experiment="${h(r.id)}"><small>${h(r.date)} · ${h(r.method)}</small><strong>${h(r.sampleId||'未编号')}</strong><span>${h(r.material||'对象未标注')} · ${h(r.project)}</span></button>`).join(''):blank('暂无记录','新建后会出现在这里。')}</aside><article class="panel work-detail">${form}</article></div>`;}

let paperMode='detail';
function paperForm(p){const editing=Boolean(p),r=p||{};return `<div class="detail-head"><div><span class="eyebrow">${editing?'EDIT REFERENCE':'NEW REFERENCE'}</span><h2>${editing?'编辑文献':'收录一篇文献'}</h2><p>保存 DOI、阅读结论和研究用途，检索时能迅速找回。</p></div><button class="button subtle" data-action="cancel-paper">返回</button></div><form data-form="paper" class="editor-form"><input type="hidden" name="id" value="${h(r.id||'')}"><div class="form-grid">${field('论文标题 *','title',r.title,'text','完整题目','required')}${field('作者','authors',r.authors,'text','用分号分隔')}${field('期刊 / 来源','journal',r.journal)}${field('年份','year',r.year,'number','2026','min="1900" max="2100"')}${field('DOI','doi',r.doi,'text','10.**** / ****')}${field('原文链接','url',r.url,'url','https://...')}${field('材料体系','material',r.material)}${field('所属课题','project',r.project)}<label class="field"><span>研究用途</span><select name="group">${options(PAPER_GROUPS,r.group||PAPER_GROUPS[0])}</select></label>${field('关键词','tags',(r.tags||[]).join('，'),'text','逗号分隔')}${area('阅读笔记与结论','notes',r.notes,'这篇文章讲了什么故事？证据和局限在哪里？',6)}</div><div class="form-actions"><button class="button primary" type="submit">保存文献</button><button type="button" class="button subtle" data-action="cancel-paper">取消</button></div></form>`;}
function paperDetail(p){return `<div class="detail-head"><div><span class="eyebrow">${h(p.journal||'REFERENCE')} · ${h(p.year||'年份未填')}</span><h2>${h(p.title)}</h2><p>${h(p.authors||'作者未填')}</p></div><button class="button subtle" data-action="edit-paper">编辑</button></div><div class="paper-chips"><span>${h(p.group)}</span>${p.material?`<span>${h(p.material)}</span>`:''}${p.tags.map(t=>`<span>${h(t)}</span>`).join('')}</div><section class="section-block"><div class="section-title"><h3>书目信息</h3></div><dl class="detail-grid">${[['作者',p.authors],['期刊 / 来源',p.journal],['年份',p.year],['DOI',p.doi],['所属课题',p.project],['原文链接',p.url]].map(([a,b])=>describe(a,b)).join('')}</dl>${p.url?.startsWith('https://')?`<a class="button subtle outbound" href="${h(p.url)}" target="_blank" rel="noopener noreferrer">打开原文 ↗</a>`:''}</section><section class="section-block"><div class="section-title"><h3>我的阅读笔记</h3></div><p class="reading-note">${h(p.notes||'尚未写阅读笔记。可以补充一句 Conclusion、关键证据与待核对的问题。')}</p></section><div class="detail-footer"><button class="text-button danger" data-action="archive-paper">归档这篇文献</button></div>`;}
function literatureView(){const papers=active(session.vault.papers),filtered=papers.filter(p=>[p.title,p.authors,p.journal,p.doi,p.material,p.notes,...p.tags].join(' ').toLocaleLowerCase().includes(paperQuery.toLocaleLowerCase())).sort((a,b)=>(b.addedAt||'').localeCompare(a.addedAt||'')),selected=filtered.find(p=>p.id===selectedPaper)||filtered[0],detail=paperMode==='new'?paperForm(null):paperMode==='edit'?paperForm(selected):selected?paperDetail(selected):blank(paperQuery?'没有匹配的文献':'文献库还没有内容',paperQuery?'换个关键词或清空搜索框。':'手动收录 DOI 和阅读笔记，或从旧网站的研究面板导入收藏。','<button class="button primary" data-action="new-paper">＋ 添加文献</button>');return `<div class="page-intro compact"><div><span class="eyebrow">YOUR LIBRARY</span><h1>文献管理</h1><p>收藏、阅读结论与课题关联都归你自己所有。</p></div><button class="button primary" data-action="new-paper">＋ 添加文献</button></div><div class="workspace-grid"><aside class="list-panel"><div class="list-panel-title"><b>我的文献</b><span>${papers.length}</span></div><label class="search-line"><span aria-hidden="true">⌕</span><input id="paper-search" type="search" value="${h(paperQuery)}" placeholder="标题、作者、DOI…" aria-label="搜索我的文献"></label>${filtered.length?filtered.map(p=>`<button class="item-row ${selected?.id===p.id&&paperMode==='detail'?'selected':''}" data-select-paper="${h(p.id)}"><small>${h(p.journal||'期刊未填')} · ${h(p.year)}</small><strong>${h(p.title)}</strong><span>${h(p.group)} · ${h(p.material)}</span></button>`).join(''):blank(paperQuery?'没有找到匹配文献':'暂无文献',paperQuery?'尝试材料、作者、DOI 或清空关键词。':'从旧网站导入或手动添加。')}</aside><article class="panel work-detail">${detail}</article></div>`;}

let projectMode='detail';
function projectForm(p){const r=p||{},editing=Boolean(p);return `<div class="detail-head"><div><span class="eyebrow">${editing?'EDIT PROJECT':'NEW PROJECT'}</span><h2>${editing?'编辑课题':'建立研究课题'}</h2><p>写明研究问题和下一步，让实验与文献有明确归属。</p></div><button class="button subtle" data-action="cancel-project">返回</button></div><form data-form="project" class="editor-form"><input type="hidden" name="id" value="${h(r.id||'')}"><div class="form-grid">${field('课题名称 *','name',r.name,'text','如 α-RuCl₃ 晶体缺陷与磁性','required')}<label class="field"><span>进度状态</span><select name="status">${options(['计划中','进行中','分析中','已完成'],r.status||'计划中')}</select></label>${field('研究对象 / 体系','material',r.material)}${field('目标日期','dueDate',r.dueDate,'date')}${area('核心科学问题','question',r.question,'希望回答什么问题？')}${area('当前判断与证据','summary',r.summary,'目前最可靠的观察和不确定性')}${area('下一步行动','nextAction',r.nextAction,'下一次实验、下一项测量或需要精读的论文')}</div><div class="form-actions"><button class="button primary" type="submit">保存课题</button><button type="button" class="button subtle" data-action="cancel-project">取消</button></div></form>`;}
function projectDetail(p){const experiments=active(session.vault.experiments).filter(e=>e.project===p.name),papers=active(session.vault.papers).filter(x=>x.project===p.name),tasks=active(session.vault.tasks).filter(t=>t.project===p.name);return `<div class="detail-head"><div><span class="eyebrow">${h(p.status)} · ${h(p.material||'对象未标注')}</span><h2>${h(p.name)}</h2><p>${p.dueDate?`目标日期 ${h(p.dueDate)}`:'暂未设定目标日期'}</p></div><button class="button subtle" data-action="edit-project">编辑</button></div><section class="section-block"><div class="section-title"><h3>研究判断</h3></div><dl class="detail-stack">${describe('核心科学问题',p.question)}${describe('当前证据',p.summary)}${describe('下一步行动',p.nextAction)}</dl></section><div class="project-metrics"><span><b>${experiments.length}</b> 关联实验</span><span><b>${papers.length}</b> 关联文献</span><span><b>${tasks.length}</b> 计划任务</span></div><section class="section-block"><div class="section-title"><h3>关联实验</h3></div>${experiments.length?experiments.map(e=>`<button class="row-link" data-view="experiments" data-select-experiment="${h(e.id)}"><span class="row-icon">⌁</span><span><b>${h(e.sampleId)}</b><small>${h(e.material)} · ${h(e.results?.slice(0,60))}</small></span></button>`).join(''):'<p class="muted">实验记录的“课题”填写相同名称即可关联。</p>'}</section><section class="section-block"><div class="section-title"><h3>关联文献</h3></div>${papers.length?papers.map(x=>`<button class="row-link" data-view="literature" data-select-paper="${h(x.id)}"><span class="row-icon">▤</span><span><b>${h(x.title)}</b><small>${h(x.journal)}</small></span></button>`).join(''):'<p class="muted">文献记录的“所属课题”填写相同名称即可关联。</p>'}</section><div class="detail-footer"><button class="text-button danger" data-action="archive-project">归档课题</button></div>`;}
function projectsView(){const projects=active(session.vault.projects),selected=projects.find(p=>p.id===selectedProject)||projects[0],detail=projectMode==='new'?projectForm(null):projectMode==='edit'?projectForm(selected):selected?projectDetail(selected):blank('还没有课题','把研究问题、实验进度和下一步集中在一起。','<button class="button primary" data-action="new-project">＋ 新建课题</button>');return `<div class="page-intro compact"><div><span class="eyebrow">RESEARCH ROADMAP</span><h1>课题追踪</h1><p>一张清楚的路线图，比散落在各处的待办更有用。</p></div><button class="button primary" data-action="new-project">＋ 新建课题</button></div><div class="workspace-grid"><aside class="list-panel"><div class="list-panel-title"><b>我的课题</b><span>${projects.length}</span></div>${projects.length?projects.map(p=>`<button class="item-row ${selected?.id===p.id&&projectMode==='detail'?'selected':''}" data-select-project="${h(p.id)}"><small>${h(p.status)} · ${h(p.material)}</small><strong>${h(p.name)}</strong><span>${h(p.nextAction?.slice(0,60))}</span></button>`).join(''):blank('暂无课题','从一个清楚的问题开始。')}</aside><article class="panel work-detail">${detail}</article></div><section class="panel task-panel"><div class="panel-head"><div><span class="eyebrow">NEXT ACTIONS</span><h2>研究待办</h2></div><span class="count-pill">${active(session.vault.tasks).filter(t=>t.status!=='完成').length} 项未完成</span></div><form data-form="task" class="task-form"><input name="title" required placeholder="例如：复查第二次实验的测量结果" aria-label="新建待办"><select name="project" aria-label="关联课题"><option value="">不关联课题</option>${projects.map(p=>`<option value="${h(p.name)}">${h(p.name)}</option>`).join('')}</select><input name="dueDate" type="date" aria-label="截止日期"><button class="button primary" type="submit">添加</button></form><div class="task-list">${active(session.vault.tasks).sort((a,b)=>(a.status==='完成')-(b.status==='完成')||(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).map(t=>`<div class="task-line ${t.status==='完成'?'done':''}"><button data-action="toggle-task" data-id="${h(t.id)}" aria-label="${t.status==='完成'?'标为未完成':'完成待办'}">${t.status==='完成'?'✓':''}</button><span><b>${h(t.title)}</b><small>${h(t.project||'未关联课题')} ${t.dueDate?'· '+h(t.dueDate):''}</small></span><button class="text-button danger" data-action="archive-task" data-id="${h(t.id)}">归档</button></div>`).join('')||'<p class="muted">暂无待办。添加一个你下一步要做的具体动作。</p>'}</div></section>`;}

function settingsView(){const p=session.vault.profile;return `<div class="page-intro compact"><div><span class="eyebrow">YOUR DATA, YOUR WORK</span><h1>数据与设置</h1><p>关注领域、旧网站迁移、备份和账号安全都在这里。</p></div></div><div class="settings-grid"><section class="panel"><div class="panel-head"><div><span class="eyebrow">RESEARCH PROFILE</span><h2>我的研究关注</h2></div></div><form data-form="profile" class="stack">${PROFILE_KEYS.map(key=>field(({materials:'材料',methods:'方法',measurements:'测量技术',journals:'期刊',authors:'作者'})[key],key,(p[key]||[]).join('，'),'text','用逗号分隔多个关键词')).join('')}<button class="button primary" type="submit">保存关注方向</button></form></section><section class="panel"><div class="panel-head"><div><span class="eyebrow">TRANSFER & BACKUP</span><h2>迁移与备份</h2></div></div><p class="body-copy">从原文献网站的“我的研究工作台”导出完整迁移包，然后在此导入。也支持旧版 <code>experiment-records.json</code>、实验 CSV 和 <code>paper-projects.json</code>。</p><div class="button-group wrap"><button class="button primary" data-action="pick-import">导入旧网站或备份文件</button><button class="button subtle" data-action="export-all">导出完整 JSON</button><button class="button subtle" data-action="export-experiments-csv">导出实验 CSV</button></div><input id="import-file" type="file" accept=".json,.csv,application/json,text/csv" hidden><p class="field-help">导入采用按记录 ID 合并，不会先清空现有数据。正式导入前建议先导出一份完整备份。</p>${importPreview?`<div class="import-preview"><b>${h(importPreview.kind)}</b><p>${importPreview.experiments.length} 条实验 · ${importPreview.papers.length} 篇文献 · ${importPreview.projects.length} 个课题 · ${importPreview.tasks.length} 项待办${importPreview.profile?' · 研究关注项':''}</p><div class="button-group"><button class="button primary" data-action="confirm-import">确认合并导入</button><button class="button subtle" data-action="cancel-import">取消</button></div></div>`:''}</section><section class="panel"><div class="panel-head"><div><span class="eyebrow">ACCOUNT SECURITY</span><h2>账号与离线数据</h2></div></div><p class="body-copy">服务端按账号隔离研究记录。当前设备的离线副本使用登录密码加密；登录后可断网记录，联网后同步。管理员只能管理账号，不能从界面查看其他人的研究内容。</p><form data-form="password" class="stack">${field('旧密码','oldPassword','','password','','required autocomplete="current-password"')}${field('新密码（至少 10 位）','newPassword','','password','','required minlength="10" autocomplete="new-password"')}<button class="button subtle" type="submit" ${session.offline?'disabled':''}>修改密码</button></form><div class="privacy-note">更换浏览器、清理网站数据或换设备前，请先导出 JSON。邮箱验证后可通过邮件找回密码；未同步的离线缓存仍需原密码解锁。</div></section></div>`;}

function settingsViewV2(){
  const original=settingsView();
  if(STATIC_MODE&&session.cloud){
    const cloudCopy=original.replace('服务端按账号隔离研究记录。当前设备的离线副本使用登录密码加密；登录后可断网记录，联网后同步。管理员只能管理账号，不能从界面查看其他人的研究内容。','Firebase 账号规则仅允许本人读写自己的研究资料。本机离线副本使用登录密码加密；云同步需要联网。')
      .replace(/<form data-form="password"[\s\S]*?<\/form>/,'<button class="button subtle" data-action="cloud-reset">发送密码重置邮件</button>')
      .replace('邮箱验证后可通过邮件找回密码；未同步的离线缓存仍需原密码解锁。','邮箱重置后，旧密码加密且未同步的本机缓存不能用新密码解锁。云端已同步记录仍可恢复。');
    const panel=`<section class="panel"><div class="panel-head"><div><span class="eyebrow">CLOUD ACCOUNT</span><h2>云同步状态</h2></div><span class="count-pill">${session.offline?'离线':session.dirty?'待同步':'已同步'}</span></div><p class="body-copy">账号：<b>${h(session.user.email)}</b>。同步完成后，可在另一台设备用同一邮箱登录。云端仅保存文字记录；请勿把未经许可的敏感数据放在第三方服务。</p><div class="privacy-note">免费 Spark 有容量和并发上限；达到上限时不会自动扣款，可能无法继续同步。未同步的记录只在此设备的加密缓存中，请及时导出备份。</div><div class="button-group wrap"><button class="button subtle" data-action="retry-cloud">立即重试同步</button><button class="button primary" data-action="export-all">导出完整 JSON</button></div></section>`;
    return cloudCopy.replace(/<\/div>$/,`${panel}</div>`);
  }
  if(STATIC_MODE){
    const localCopy=original.replace('服务端按账号隔离研究记录。当前设备的离线副本使用登录密码加密；登录后可断网记录，联网后同步。管理员只能管理账号，不能从界面查看其他人的研究内容。','这份资料只保存在当前浏览器，并使用密码加密。没有服务器同步、跨设备登录或全站管理员。')
      .replace('邮箱验证后可通过邮件找回密码；未同步的离线缓存仍需原密码解锁。','本机资料不能通过邮箱找回。更换设备或清理浏览器数据前，请导出完整 JSON 备份。');
    const localPanel=`<section class="panel"><div class="panel-head"><div><span class="eyebrow">LOCAL PROFILES</span><h2>此设备资料</h2></div><span class="count-pill">${localAccounts.length} 份</span></div><p class="body-copy">当前资料：<b>${h(session.user.username)}</b>。不同资料各自加密，退出后可切换；同名资料在另一台设备上不会自动同步。</p><div class="privacy-note">浏览器存储：${localPersistence===true?'已获准持久保存':localPersistence===false?'普通保存（可能被浏览器清理）':'状态未知'}。上次发起完整备份导出：${lastBackupAt?h(dateLabel(lastBackupAt)):'尚未记录'}。即使获准持久保存，主动清理网站数据仍可能删除资料。</div><div class="button-group wrap"><button class="button subtle" data-action="persist-local">申请浏览器持久保存</button><button class="button primary" data-action="export-all">导出完整 JSON</button></div><form data-form="delete-local" class="stack">${field('当前密码','password','','password','确认删除此设备上的这份资料','required autocomplete="current-password"')}<button class="button subtle danger" type="submit">永久删除此设备的这份资料</button></form><p class="field-help">删除前请先导出备份；删除操作无法撤销，不影响其他设备上的资料。</p></section>`;
    return localCopy.replace(/<\/div>$/,`${localPanel}</div>`);
  }
  if(config.recoveryMode==='admin')return original.replace('邮箱验证后可通过邮件找回密码；未同步的离线缓存仍需原密码解锁。','忘记密码时请联系管理员签发一次性重置链接；未同步的离线缓存仍需原密码解锁。');
  const email=session.user.email||'尚未设置',verified=session.user.emailVerified;
  const panel=`<section class="panel"><div class="panel-head"><div><span class="eyebrow">RECOVERY EMAIL</span><h2>找回邮箱</h2></div><span class="count-pill">${verified?'已验证':'待验证'}</span></div><p class="body-copy">当前邮箱：<b>${h(email)}</b>。验证后可用它接收密码重置链接。</p><form data-form="email" class="stack">${field('新邮箱地址','email',session.user.email||'','email','name@example.com','required autocomplete="email"')}${field('当前密码','password','','password','确认是你本人修改','required autocomplete="current-password"')}<button class="button subtle" type="submit" ${session.offline?'disabled':''}>更新并发送验证邮件</button></form><p class="field-help">修改邮箱后须重新验证。若未收到邮件，可退出登录，在登录页点“重发验证邮件”。</p></section>`;
  return original.replace(/<\/div>$/,`${panel}</div>`);
}

let adminUsers=[],adminResetLink=null;
function adminView(){
  const registrationNote=config.recoveryMode==='admin'?'局域网开放注册后，同一局域网内的成员可以自行创建账号。请定期备份数据库。':'公开开放注册可能吸引自动化滥用。正式面向互联网时请配置 HTTPS、反向代理限流与定期数据库备份。';
  const members=adminUsers.length?adminUsers.map(u=>`<div class="member"><span class="avatar">${h(u.displayName?.slice(0,1)||'研')}</span><span><b>${h(u.displayName)}</b><small>@${h(u.username)} · ${h(u.role==='admin'?'管理员':'普通用户')} · ${dateLabel(u.createdAt)}</small></span>${u.role==='admin'?'<span class="count-pill">管理员</span>':`<button class="button subtle small" data-action="toggle-user" data-id="${h(u.id)}" data-disabled="${u.disabled?'false':'true'}">${u.disabled?'恢复账号':'停用账号'}</button>${config.recoveryMode==='admin'&&!u.disabled?`<button class="button subtle small" data-action="reset-user" data-id="${h(u.id)}">重置密码</button>`:''}`}</div>`).join(''):blank('正在读取账号列表','若一直未显示，请检查网络连接。');
  const recoveryPanel=adminResetLink?`<section class="panel"><h2>一次性重置链接 · ${h(adminResetLink.username)}</h2><p class="body-copy">15 分钟内有效，只能使用一次。请当面或通过可信渠道交给账号本人，不要发到公开群。</p><code>${h(adminResetLink.link)}</code><div class="button-group"><button class="button subtle" data-action="copy-reset">复制链接</button></div></section>`:'';
  return `<div class="page-intro compact"><div><span class="eyebrow">ADMINISTRATION</span><h1>账号管理</h1><p>只管理用户的注册与访问状态，不展示其他人的实验、文献或课题内容。</p></div></div><section class="panel"><div class="panel-head"><div><span class="eyebrow">REGISTRATION</span><h2>开放注册</h2></div><button class="button ${config.registrationOpen?'subtle':'primary'}" data-action="toggle-registration">${config.registrationOpen?'当前开放 · 点击关闭':'当前关闭 · 点击开放'}</button></div><p class="body-copy">${registrationNote}</p></section><section class="panel"><div class="panel-head"><div><span class="eyebrow">MEMBERS</span><h2>已注册用户</h2></div><button class="text-button" data-action="refresh-users">刷新</button></div>${adminUsers.length?`<div class="members">${members}</div>`:members}</section>${recoveryPanel}`;
}

function publicCatalogView(){
  const groups=publicQuery.trim().normalize('NFKC').toLocaleLowerCase().split(';').map(group=>group.trim().split(/[\s,，]+/).filter(Boolean)).filter(group=>group.length);
  const matches=groups.length?catalog.filter(p=>{
    const text=[p.title,p.authors,p.journal,p.material,p.doi,...(p.tags||[])].join(' ').normalize('NFKC').toLocaleLowerCase();
    return groups.some(group=>group.every(term=>text.includes(term)));
  }):catalog;
  const pageSize=12,totalPages=Math.max(1,Math.ceil(matches.length/pageSize));publicPage=Math.min(publicPage,totalPages-1);
  const page=matches.slice(publicPage*pageSize,(publicPage+1)*pageSize),selected=matches.find(p=>p.id===selectedPublic)||page[0];
  const detail=selected?`<div class="public-detail-meta">${h(selected.journal||'来源未填')} · ${h(selected.year||'年份未填')}</div><h2>${h(selected.title)}</h2><p>${h(selected.authors||'作者未填')}</p><dl class="detail-grid">${[['研究对象',selected.material],['DOI',selected.doi],['关键词',(selected.tags||[]).join(' · ')]].map(([label,value])=>describe(label,value)).join('')}</dl>${selected.url?.startsWith('https://')?`<a class="button primary" href="${h(selected.url)}" target="_blank" rel="noopener noreferrer">打开论文原文 ↗</a>`:''}`:blank('没有匹配的公开文献','试试作者、材料、期刊或 DOI。');
  return `<div class="public-shell"><header class="public-top"><div class="brand"><span class="brand-mark">研</span><span>研析<small>公开文献 · 私人研究</small></span></div><nav aria-label="公开导航"><button class="button subtle" data-action="public-home">公开文献</button><button class="button primary" data-action="open-local">${session?'返回我的工作台':cloudConfigured?'登录免费云账号':'创建或解锁本机资料'}</button></nav></header><main class="public-main"><section class="public-hero"><span class="eyebrow">OPEN RESEARCH LIBRARY</span><h1>公开探索文献，<br>私下记录自己的研究。</h1><p>公开书目对所有访客可见。${cloudConfigured?'登录云账号后，实验、阅读笔记与课题可跨设备同步；也能选择纯本机资料。':'实验、阅读笔记与课题只写入这台设备的浏览器；不需要服务器账号。'}</p><a class="button subtle" href="https://wang812229.github.io/crystal-growth-property-control/" target="_blank" rel="noopener noreferrer">阅读每日文献简报 ↗</a><div class="public-facts"><span><b>${catalog.length}</b> 条公开书目</span><span>${cloudConfigured?'个人资料按账号隔离，支持云同步':'<b>0</b> 项私人内容上传'}</span></div></section><section class="public-library"><div class="panel-head"><div><span class="eyebrow">LITERATURE INDEX</span><h2>公开文献索引</h2></div><span class="count-pill">找到 ${matches.length} 条</span></div><label class="field"><span>按标题、作者、研究对象、期刊、DOI 或关键词检索</span><input id="public-search" type="search" value="${h(publicQuery)}" placeholder="例如：UTe₂ Flux；量子振荡 PRL" aria-label="检索公开文献"></label><div class="public-results"><div class="public-list">${page.map(p=>`<button class="item-row ${selected?.id===p.id?'selected':''}" data-public-paper="${h(p.id)}"><small>${h(p.journal||'来源未填')} · ${h(p.year||'—')}</small><strong>${h(p.title)}</strong><span>${h(p.authors||'作者未填')}</span></button>`).join('')||blank('没有找到相关文献','更换关键词或清空搜索框。')}<div class="public-pages"><button class="button subtle small" data-action="public-prev" ${publicPage===0?'disabled':''}>上一页</button><span>${publicPage+1} / ${totalPages}</span><button class="button subtle small" data-action="public-next" ${publicPage>=totalPages-1?'disabled':''}>下一页</button></div></div><article class="panel public-detail">${detail}</article></div></section><p class="public-foot">书目信息属于公开内容；个人输入不会自动发布。${cloudConfigured?'云账号内容按账号隔离，并建议定期导出备份。':'请定期导出本机资料备份。'}</p></main></div>${toastHtml()}`;
}
function render(){
  if(STATIC_MODE&&view==='public'){app.innerHTML=publicCatalogView();return;}
  if(!session){app.innerHTML=authViewV2();return;}
  const content=({dashboard,experiments:experimentsView,literature:literatureView,projects:projectsView,settings:settingsViewV2,admin:adminView})[view]?.()||dashboard();
  app.innerHTML=shell(content);
}
function changedItem(list,id,changes){return list.map(item=>item.id===id?{...item,...changes,updatedAt:new Date().toISOString()}:item);}
function markedVault(key,id,changes){const next=structuredClone(session.vault);next[key]=changedItem(next[key],id,changes);return next;}
function selectedRecord(key,id){return active(session.vault[key]).find(x=>x.id===id)||active(session.vault[key])[0];}
async function loadUsers(){if(!session||session.user.role!=='admin'||session.offline)return;try{adminUsers=(await request('/api/admin/users')).users;render();}catch(e){toast(e.message);}}

document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-view],[data-action],[data-public-paper],[data-select-experiment],[data-select-paper],[data-select-project]');if(!button)return;
  if(STATIC_MODE&&button.dataset.publicPaper){selectedPublic=button.dataset.publicPaper;render();return;}
  if(button.dataset.view){view=button.dataset.view;if(view!=='admin')adminResetLink=null;document.body.classList.remove('menu-open');if(view==='admin')void loadUsers();}
  if(button.dataset.selectExperiment){selectedExperiment=button.dataset.selectExperiment;experimentMode='detail';view='experiments';}
  if(button.dataset.selectPaper){selectedPaper=button.dataset.selectPaper;paperMode='detail';view='literature';}
  if(button.dataset.selectProject){selectedProject=button.dataset.selectProject;projectMode='detail';view='projects';}
  const action=button.dataset.action;
  try{
    if(STATIC_MODE&&action==='public-home'){view='public';render();return;}
    if(STATIC_MODE&&action==='open-local'){view=session?'dashboard':'auth';render();return;}
    if(STATIC_MODE&&action==='switch-backend'){authBackend=button.dataset.backend;authTab='login';render();return;}
    if(STATIC_MODE&&(action==='public-prev'||action==='public-next')){publicPage+=action==='public-next'?1:-1;selectedPublic=null;render();return;}
    if(action==='auth-tab'){authTab=button.dataset.tab;render();return;}
    if(action==='dismiss'){notice='';render();return;}
    if(action==='menu'){document.body.classList.toggle('menu-open');return;}
    if(action==='logout'){if(session?.cloud)await cloudClient.logout().catch(()=>{});else if(!STATIC_MODE&&!session.offline)await request('/api/logout','POST').catch(()=>{});adminResetLink=null;session=null;view=STATIC_MODE?'public':'dashboard';render();return;}
    if(!session){render();return;}
    if(action==='cloud-reset'&&session.cloud){await cloudClient.reset(session.user.email);toast('如果邮箱可用，密码重置邮件已发出。请注意：未同步的旧密码缓存无法凭新密码恢复。');return;}
    if(action==='retry-cloud'&&session.cloud){if(!navigator.onLine)throw new Error('当前设备没有网络连接。');if(session.offline){toast('请先退出，再联网登录云账号以恢复同步。');return;}await flush();toast(session.dirty?'同步仍未完成，请查看错误提示并先导出备份。':'云端同步已完成。');return;}
    if(action==='new-experiment'){view='experiments';experimentMode='new';}
    if(action==='edit-experiment')experimentMode='edit';
    if(action==='cancel-experiment')experimentMode='detail';
    if(action==='export-experiment'){const r=selectedRecord('experiments',selectedExperiment);if(r)json(`experiment-${r.sampleId||r.id}.json`,r);}
    if(action==='archive-experiment'){const r=selectedRecord('experiments',selectedExperiment);if(r&&confirm(`归档 ${r.sampleId}？记录仍保留在备份中。`)){await commit(markedVault('experiments',r.id,{archived:true}));selectedExperiment=null;}}
    if(action==='new-paper'){view='literature';paperMode='new';}
    if(action==='edit-paper')paperMode='edit';
    if(action==='cancel-paper')paperMode='detail';
    if(action==='archive-paper'){const p=selectedRecord('papers',selectedPaper);if(p&&confirm('归档这篇文献？')){await commit(markedVault('papers',p.id,{archived:true}));selectedPaper=null;}}
    if(action==='new-project'){view='projects';projectMode='new';}
    if(action==='edit-project')projectMode='edit';
    if(action==='cancel-project')projectMode='detail';
    if(action==='archive-project'){const p=selectedRecord('projects',selectedProject);if(p&&confirm('归档这个课题？关联记录不会删除。')){await commit(markedVault('projects',p.id,{archived:true}));selectedProject=null;}}
    if(action==='toggle-task'||action==='archive-task'){const t=session.vault.tasks.find(x=>x.id===button.dataset.id);if(t)await commit(markedVault('tasks',t.id,action==='toggle-task'?{status:t.status==='完成'?'待办':'完成'}:{archived:true}));}
    if(action==='persist-local'&&STATIC_MODE){
      if(!navigator.storage?.persist)throw new Error('此浏览器不支持持久存储申请，请定期导出 JSON。');
      localPersistence=await navigator.storage.persist();toast(localPersistence?'浏览器已允许持久保存。仍请保留独立备份。':'浏览器未授予持久保存。请定期导出 JSON。');return;
    }
    if(action==='export-experiments-csv')download(`experiments-${day()}.csv`,experimentsCsv(active(session.vault.experiments)),'text/csv');
    if(action==='export-all'){
      json(`yanxi-backup-${session.user.username}-${day()}.json`,{format:'yanxi-workbench',version:1,exportedAt:new Date().toISOString(),vault:session.vault});
      if(STATIC_MODE){lastBackupAt=new Date().toISOString();try{localStorage.setItem(backupKey(session.user.username),lastBackupAt);}catch{}toast('已发起完整备份下载；请确认文件确实保存到了安全位置。');return;}
    }
    if(action==='pick-import'){document.querySelector('#import-file')?.click();return;}
    if(action==='cancel-import')importPreview=null;
    if(action==='confirm-import'&&importPreview){await commit(mergeVault(session.vault,importPreview));const count=importPreview.experiments.length+importPreview.papers.length+importPreview.projects.length;importPreview=null;toast(`导入完成，处理了 ${count} 条记录。`);return;}
    if(action==='toggle-registration'){const result=await request('/api/admin/registration','POST',{open:!config.registrationOpen});config.registrationOpen=result.registrationOpen;toast(`新用户注册已${config.registrationOpen?'开放':'关闭'}。`);return;}
    if(action==='refresh-users'){await loadUsers();return;}
    if(action==='toggle-user'){await request('/api/admin/status','POST',{userId:button.dataset.id,disabled:button.dataset.disabled==='true'});await loadUsers();toast('账号状态已更新。');return;}
    if(action==='reset-user'){adminResetLink=await request('/api/admin/reset-link','POST',{userId:button.dataset.id});render();return;}
    if(action==='copy-reset'&&adminResetLink){await navigator.clipboard.writeText(adminResetLink.link);toast('一次性链接已复制。');return;}
    render();
  }catch(error){toast(error.message);}
});

document.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();
  const values=Object.fromEntries(new FormData(form));
  try{
    if(form.dataset.form==='auth'){await login(values.username,values.password,values.mode==='register'?{displayName:values.displayName,email:values.email,setupToken:values.setupToken}:null);return;}
    if(form.dataset.form==='forgot'&&STATIC_MODE&&cloudConfigured&&authBackend==='cloud'){
      await cloudClient.reset(values.email);authTab='login';toast('如果该邮箱对应云账号，密码重置邮件会发送到邮箱。');return;
    }
    if(form.dataset.form==='cloud-resend'&&STATIC_MODE&&cloudConfigured){
      await cloudClient.resendVerification(values.email,values.password);authTab='login';toast('如邮箱尚未验证，新验证邮件已发送。');return;
    }
    if(form.dataset.form==='forgot'||form.dataset.form==='resend'){
      const response=await request(form.dataset.form==='forgot'?'/api/request-reset':'/api/resend-verification','POST',{email:values.email});
      authTab='login';toast(response.message);return;
    }
    if(form.dataset.form==='verify'){
      await request('/api/verify-email','POST',{token:authToken});authToken='';history.replaceState(null,'',location.pathname);authTab='login';toast('邮箱验证成功，请登录。');return;
    }
    if(form.dataset.form==='reset'){
      if(values.newPassword!==values.confirmPassword)throw new Error('两次输入的密码不一致。');
      await request('/api/reset-password','POST',{token:authToken,newPassword:values.newPassword});authToken='';history.replaceState(null,'',location.pathname);authTab='login';toast('密码已重置，请重新登录。');return;
    }
    if(!session)return;
    if(form.dataset.form==='experiment'){
      const existing=session.vault.experiments.find(x=>x.id===values.id),schedule=parseSchedule(values.scheduleText),record=normalizeExperiment({...existing,...values,id:existing?.id||newId('exp'),schedule,createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()});
      const next=structuredClone(session.vault);next.experiments=existing?next.experiments.map(x=>x.id===record.id?record:x):[record,...next.experiments];selectedExperiment=record.id;experimentMode='detail';await commit(next);toast('实验记录已保存。');return;
    }
    if(form.dataset.form==='paper'){
      const existing=session.vault.papers.find(x=>x.id===values.id),paper=normalizePaper({...existing,...values,id:existing?.id||undefined,tags:String(values.tags||'').split(/[，,;；]/).map(x=>x.trim()).filter(Boolean),updatedAt:new Date().toISOString()},catalog);
      const next=structuredClone(session.vault);next.papers=existing?next.papers.map(x=>x.id===paper.id?paper:x):[paper,...next.papers];selectedPaper=paper.id;paperMode='detail';await commit(next);toast('文献已保存。');return;
    }
    if(form.dataset.form==='project'){
      const existing=session.vault.projects.find(x=>x.id===values.id),record={...existing,...values,id:existing?.id||newId('project'),createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),archived:false};
      const next=structuredClone(session.vault);next.projects=existing?next.projects.map(x=>x.id===record.id?record:x):[record,...next.projects];selectedProject=record.id;projectMode='detail';await commit(next);toast('课题已保存。');return;
    }
    if(form.dataset.form==='task'){
      const next=structuredClone(session.vault);next.tasks.unshift({id:newId('task'),title:String(values.title).trim(),project:values.project||'',dueDate:values.dueDate||'',status:'待办',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),archived:false});await commit(next);toast('待办已添加。');return;
    }
    if(form.dataset.form==='profile'){
      const next=structuredClone(session.vault);next.profile.updatedAt=new Date().toISOString();for(const key of PROFILE_KEYS)next.profile[key]=String(values[key]||'').split(/[，,;；\n]/).map(x=>x.trim()).filter(Boolean);await commit(next);toast('关注方向已保存。');return;
    }
    if(form.dataset.form==='password'){
      if(STATIC_MODE&&session.cloud){throw new Error('云账号请使用“发送密码重置邮件”修改密码。');}
      if(STATIC_MODE){
        if(String(values.newPassword||'').length<10||String(values.newPassword).length>200)throw new Error('新密码需为 10–200 个字符。');
        await unlockOffline(session.user.username,values.oldPassword);
        session.key=await createOfflineSession(session.user.username,values.newPassword,{user:session.user,vault:session.vault,revision:0,dirty:false});
        toast('此设备资料的密码已更新。请妥善保存新密码和备份。');return;
      }
      await request('/api/change-password','POST',{oldPassword:values.oldPassword,newPassword:values.newPassword});
      await createOfflineSession(session.user.username,values.newPassword,{user:session.user,vault:session.vault,revision:session.revision,dirty:session.dirty});
      session=null;render();toast('密码已更新，请重新登录。');return;
    }
    if(form.dataset.form==='email'){
      const response=await request('/api/email','POST',{email:values.email,password:values.password});
      session.user.email=values.email;session.user.emailVerified=false;await cache();toast(response.message);return;
    }
    if(form.dataset.form==='delete-local'&&STATIC_MODE){
      if(!confirm(`永久删除此设备上的 ${session.user.username} 资料？此操作无法撤销。`))return;
      await deleteLocalAccount(session.user.username,values.password);try{localStorage.removeItem(backupKey(session.user.username));}catch{}localAccounts=await listLocalAccounts();session=null;view='public';render();toast('本机资料已删除。');return;
    }
  }catch(error){toast(error.message);}
});

document.addEventListener('change',async event=>{
  if(event.target.id!=='import-file')return;
  const file=event.target.files?.[0];if(!file)return;
  try{if(file.size>6_000_000)throw new Error('导入文件不能超过 6 MB。');importPreview=parseImport(await file.text(),file.name,catalog);render();toast(`已读取 ${importPreview.kind}，请核对数量后确认。`);}catch(error){toast(error.message);}
});
document.addEventListener('input',event=>{
  if(STATIC_MODE&&event.target.id==='public-search'&&!event.isComposing)updatePublicSearch(event.target);
  if(event.target.id==='paper-search'){const input=event.target;paperQuery=input.value;const pos=input.selectionStart;render();const replacement=document.querySelector('#paper-search');replacement?.focus();replacement?.setSelectionRange(pos,pos);}
  if(event.target.name==='scheduleText'){
    const node=document.querySelector('#schedule-preview');if(!node)return;
    try{node.innerHTML=scheduleChart(parseSchedule(event.target.value));}catch(error){node.innerHTML=`<p class="input-warning">${h(error.message)}</p>`;}
  }
});
document.addEventListener('compositionend',event=>{if(STATIC_MODE&&event.target.id==='public-search')updatePublicSearch(event.target);});
function updatePublicSearch(input){publicQuery=input.value;publicPage=0;selectedPublic=null;const pos=input.selectionStart;render();const replacement=document.querySelector('#public-search');replacement?.focus();if(pos!=null)replacement?.setSelectionRange(pos,pos);}
window.addEventListener('online',async()=>{
  if(STATIC_MODE&&!session?.cloud)return;
  if(!session)return;
  try{const remote=session.cloud?await cloudClient.read(session.user.id):await request('/api/me');session.vault=mergeVault(remote.vault||emptyVault(),session.vault);session.revision=remote.revision;session.offline=false;session.dirty=true;editVersion++;await cache();render();void flush();}catch(error){toast(session.cloud?'网络已恢复，请退出并重新登录云账号，然后再同步。':error.status===401?'网络已恢复，请退出并重新登录以同步。':error.message);}
});
window.addEventListener('offline',()=>{if((!STATIC_MODE||session?.cloud)&&session){session.offline=true;updateStatus();}});
async function boot(){
  try{catalog=await fetch('./catalog.json').then(r=>r.json());}catch{catalog=[];}
  if(STATIC_MODE){
    config={setupRequired:false,registrationOpen:true,recoveryMode:'local',staticMode:true};
    try{
      const cloudConfig=await fetch('./cloud-config.json',{cache:'no-store'}).then(r=>r.json());
      if(cloudConfig.enabled){const module=await import('./cloud-client.bundle.mjs');cloudClient=module.createCloudClient(cloudConfig);cloudConfigured=true;authBackend='cloud';}
    }catch(error){notice=`云账号尚未配置成功：${error.message}。当前仍可使用本机资料。`;}
    try{localAccounts=await listLocalAccounts();}catch{localAccounts=[];}
    authTab=cloudConfigured?'login':localAccounts.length?'login':'register';view='public';render();
    if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
    return;
  }
  try{config=await request('/api/config');try{localStorage.setItem('yanxi-config-v1',JSON.stringify(config));}catch{}}catch{try{config={...config,...JSON.parse(localStorage.getItem('yanxi-config-v1')||'{}'),setupRequired:false,registrationOpen:false};}catch{config={setupRequired:false,registrationOpen:false};}}
  if(!config.registrationOpen&&!config.setupRequired)authTab='login';
  if(config.setupRequired)authTab='register';
  const hash=location.hash.slice(1);
  if(hash.startsWith('reset=')){authToken=decodeURIComponent(hash.slice(6));authTab='reset';}
  if(hash.startsWith('verify=')){authToken=decodeURIComponent(hash.slice(7));authTab='verify';}
  render();
  if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
boot();
