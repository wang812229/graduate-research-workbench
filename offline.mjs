import { STATIC_MODE } from './runtime.mjs';
const basePath=new URL('.',globalThis.location?.href||'https://local.invalid/').pathname;
const DB_NAME=STATIC_MODE?`yanxi-local-${encodeURIComponent(basePath)}`:'yanxi-offline-cache-v1', STORE='accounts';
const b64=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};
const unb64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
function openDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'username'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function row(username){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly'), request=tx.objectStore(STORE).get(username.toLowerCase());
    request.onsuccess=()=>resolve(request.result||null);
    request.onerror=()=>reject(request.error);
    tx.oncomplete=()=>db.close();
  });
}
async function put(value){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value);
    tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
  });
}
async function add(value){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).add(value);
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onabort=()=>{db.close();reject(tx.error?.name==='ConstraintError'?new Error('这台设备已存在同名资料，请换一个用户名。'):tx.error);};
  });
}
async function remove(username){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(username.toLowerCase());
    tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};
  });
}
async function derive(password,salt){
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:260000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function unlockOffline(username,password){
  const saved=await row(username);
  if(!saved) throw new Error('这台设备尚无该账号的离线缓存。请先联网登录一次。');
  const key=await derive(password,unb64(saved.salt));
  try {
    const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(saved.iv)},key,unb64(saved.ciphertext));
    return {...JSON.parse(new TextDecoder().decode(data)),key};
  } catch { throw new Error('密码不正确，无法解锁离线数据。'); }
}
export async function registerLocalAccount(username,displayName,password,vault){
  username=String(username||'').trim().toLowerCase();displayName=String(displayName||'').trim().slice(0,64)||username;
  if(!/^[a-z0-9._-]{3,32}$/.test(username))throw new Error('用户名需为 3–32 位小写字母、数字、点、下划线或连字符。');
  if(typeof password!=='string'||password.length<10||password.length>200)throw new Error('密码需为 10–200 个字符。');
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await derive(password,salt);
  const user={id:`local:${username}`,username,displayName,role:'user',email:'',emailVerified:false,localOnly:true,createdAt:new Date().toISOString()};
  const payload={user,vault,revision:0,dirty:false};
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(payload)));
  await add({username,salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(ciphertext)),savedAt:new Date().toISOString()});
  return {...payload,key};
}
export async function listLocalAccounts(){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).getAllKeys();
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    tx.oncomplete=()=>db.close();
  });
}
export async function deleteLocalAccount(username,password){
  await unlockOffline(username,password);
  await remove(username);
}
export async function createOfflineSession(username,password,payload){
  const saved=await row(username), salt=saved?.salt?unb64(saved.salt):crypto.getRandomValues(new Uint8Array(16));
  const key=await derive(password,salt);
  await saveOffline(username,key,payload,salt);
  return key;
}
export async function saveOffline(username,key,payload,saltOverride){
  const saved=await row(username),salt=saltOverride || unb64(saved.salt);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(payload)));
  await put({username:username.toLowerCase(),salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(ciphertext)),savedAt:new Date().toISOString()});
}
