import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { emptyVault } from '../core.mjs';
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
