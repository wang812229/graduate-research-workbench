import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { emptyVault, escapeHtml } from '../core.mjs';
import { registerLocalAccount, unlockOffline, saveOffline, listLocalAccounts, deleteLocalAccount } from '../offline.mjs';
import { validateCloudConfig } from '../cloud-client.mjs';

test('device-local profiles require their own password and never overwrite an existing name',async()=>{
  const vault=emptyVault(),created=await registerLocalAccount('member','研究成员','long-password-1',vault);
  assert.deepEqual(await listLocalAccounts(),['member']);
  assert.equal(created.user.role,'user');
  assert.equal(created.user.localOnly,true);
  await assert.rejects(registerLocalAccount('member','Another','long-password-2',vault),/已存在同名资料/);
  await assert.rejects(unlockOffline('member','wrong-password'),/无法解锁/);
  const large=emptyVault();large.experiments.push({id:'large-note',notes:'实验观察'.repeat(50000)});
  await saveOffline('member',created.key,{user:created.user,vault:large,revision:0,dirty:false});
  assert.equal((await unlockOffline('member','long-password-1')).vault.experiments[0].notes.length,200000);
  await assert.rejects(deleteLocalAccount('member','wrong-password'),/无法解锁/);
  await deleteLocalAccount('member','long-password-1');
  assert.deepEqual(await listLocalAccounts(),[]);
});

test('static build publishes only public assets and enables browser-local mode',async()=>{
  execFileSync(process.execPath,['scripts/build-static.mjs'],{cwd:resolve('.')});
  const out=resolve('dist-static'),files=await readdir(out);
  assert.ok(files.includes('index.html'));
  assert.ok(files.includes('catalog.json'));
  assert.ok(files.includes('cloud-config.json'));
  assert.ok(files.includes('cloud-client.bundle.mjs'));
  assert.match(await readFile(resolve(out,'runtime.mjs'),'utf8'),/STATIC_MODE=true/);
  const html=await readFile(resolve(out,'index.html'),'utf8');
  const app=await readFile(resolve(out,'app.mjs'),'utf8');
  const core=await readFile(resolve(out,'core.mjs'),'utf8');
  const worker=await readFile(resolve(out,'sw.js'),'utf8');
  const version=html.match(/app\.mjs\?v=([a-f0-9]{12})/)?.[1];
  assert.ok(version,'published app URL should change when assets change');
  assert.match(html,new RegExp(`styles\\.css\\?v=${version}`));
  assert.match(app,new RegExp(`core\\.mjs\\?v=${version}`));
  assert.match(app,/pick-measurement/);
  assert.match(app,/TABLE \+ LIVE PLOT/);
  assert.match(app,/多样品叠图比较/);
  assert.match(app,/dataset-analysis/);
  assert.match(app,/data-fit-chart/);
  assert.match(app,/大窗口绘图/);
  assert.match(app,/导出 Origin 数据/);
  assert.match(app,/25_000_000/);
  assert.match(core,/parseMeasurementText/);
  assert.match(core,/Curie–Weiss/);
  assert.match(core,/downsampleDataset/);
  assert.match(core,/analysisCsv/);
  assert.match(core,/Bloch–Grüneisen/);
  assert.match(worker,new RegExp(`v7-${version}`));
  const cloudConfig=JSON.parse(await readFile(resolve(out,'cloud-config.json'),'utf8'));
  assert.equal(cloudConfig.enabled,true);
  assert.equal(validateCloudConfig(cloudConfig),true);
  for(const forbidden of ['server.mjs','server-v2.mjs','db-local.mjs','db-postgres.mjs','compose.yml','.env'])assert.equal(files.includes(forbidden),false);
});

test('cloud mode requires complete Firebase config and owner-only verified-email rules',async()=>{
  assert.equal(validateCloudConfig({enabled:false}),false);
  assert.throws(()=>validateCloudConfig({enabled:true}),/配置不完整/);
  assert.equal(validateCloudConfig({enabled:true,apiKey:'test',authDomain:'example.firebaseapp.com',databaseURL:'https://example-default-rtdb.asia-southeast1.firebasedatabase.app',projectId:'example',appId:'app'}),true);
  assert.throws(()=>validateCloudConfig({enabled:true,apiKey:'test',authDomain:'example.firebaseapp.com',databaseURL:'http://example.com',projectId:'example',appId:'app'}),/地址无效/);
  const rules=JSON.parse(await readFile(resolve('database.rules.json'),'utf8')).rules;
  assert.equal(rules['.read'],false);
  assert.equal(rules['.write'],false);
  assert.match(rules.vaults.$uid['.read'],/auth\.uid === \$uid/);
  assert.match(rules.vaults.$uid['.write'],/email_verified/);
});

test('public search and cloud account entry render without breaking page actions',async()=>{
  const app={innerHTML:''},handlers={};
  const document={
    querySelector:selector=>selector==='#app'?app:selector==='#public-search'?{focus(){},setSelectionRange(){}}:null,
    addEventListener:(name,handler)=>{handlers[name]=handler;}
  };
  const context={document,window:{addEventListener(){}},STATIC_MODE:true,h:escapeHtml};
  const source=(await readFile(resolve('app.mjs'),'utf8'))
    .replace(/^import .*;\r?\n/gm,'')
    .replace(/\bboot\(\);\s*$/,'');
  vm.runInNewContext(`${source}\nglobalThis.harness={start(papers){catalog=papers;cloudConfigured=true;authBackend='cloud';view='public';render();},html(){return app.innerHTML;},errorMessage:userFacingError};`,context,{filename:'app.mjs'});
  const paper={id:'paper-1',title:'Flux growth of a quantum material',authors:'A. Researcher',journal:'Physical Review B',year:'2026',material:'UTe₂',doi:'10.1103/example',tags:['Flux'],url:'https://doi.org/10.1103/example'};
  context.harness.start([paper,{...paper,id:'paper-2',title:'Unrelated result',tags:[]}]);
  assert.match(context.harness.html(),/找到 2 条/);
  handlers.input({target:{id:'public-search',value:'Flux',selectionStart:4}});
  assert.match(context.harness.html(),/找到 1 条/);
  assert.doesNotMatch(context.harness.html(),/Unrelated result/);
  handlers.input({target:{id:'public-search',value:'UTe2 Flux',selectionStart:9}});
  assert.match(context.harness.html(),/找到 1 条/);
  handlers.input({target:{id:'public-search',value:'Unrelated；UTe₂ Flux',selectionStart:19}});
  assert.match(context.harness.html(),/找到 2 条/);
  handlers.input({target:{id:'public-search',value:'不存在',selectionStart:3},isComposing:true});
  assert.match(context.harness.html(),/找到 2 条/);
  handlers.compositionend({target:{id:'public-search',value:'Flux',selectionStart:4}});
  assert.match(context.harness.html(),/找到 1 条/);
  await handlers.click({target:{closest:()=>({dataset:{publicPaper:'paper-1'}})}});
  assert.match(context.harness.html(),/打开论文原文/);
  await handlers.click({target:{closest:()=>({dataset:{action:'open-local'}})}});
  assert.match(context.harness.html(),/登录免费云账号/);
  assert.match(context.harness.html(),/<form data-form="auth"/);
  for(const [tab,label] of [['register','创建免费云账号'],['forgot','找回密码'],['resend','重发验证邮件'],['login','登录免费云账号']]){
    await handlers.click({target:{closest:()=>({dataset:{action:'auth-tab',tab}})}});
    assert.match(context.harness.html(),new RegExp(label));
  }
  await handlers.click({target:{closest:()=>({dataset:{action:'switch-backend',backend:'local'}})}});
  assert.match(context.harness.html(),/在此设备创建资料|进入工作台/);
  assert.match(context.harness.errorMessage({code:'auth/operation-not-allowed'}),/电子邮件\/密码注册/);
  assert.match(context.harness.errorMessage({code:'auth/unauthorized-domain'}),/已获授权的网域/);
});
