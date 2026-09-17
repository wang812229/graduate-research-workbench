import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, inMemoryPersistence, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updateProfile, reload, signOut } from 'firebase/auth';
import { getDatabase, ref, get, runTransaction } from 'firebase/database';

export function validateCloudConfig(config) {
  const fields=['apiKey','authDomain','databaseURL','projectId','appId'];
  if (!config?.enabled) return false;
  if (fields.some(field=>!config[field]||typeof config[field]!=='string')) throw new Error('云账号配置不完整。请检查 cloud-config.json。');
  const domain=new URL(config.databaseURL);
  if (domain.protocol!=='https:'||!/^[-\w.]+\.firebasedatabase\.app$|^[-\w.]+\.firebaseio\.com$/.test(domain.hostname)) throw new Error('Realtime Database 地址无效。');
  return true;
}

export function createCloudClient(config) {
  validateCloudConfig(config);
  const app=initializeApp(config),auth=getAuth(app),database=getDatabase(app);
  const path=uid=>ref(database,`vaults/${uid}`);
  const userInfo=user=>({id:user.uid,username:user.email?.toLowerCase()||user.uid,email:user.email||'',displayName:user.displayName||user.email?.split('@')[0]||'研究成员',role:'user',cloud:true});
  const prepare=()=>setPersistence(auth,inMemoryPersistence);
  const read=async user=>{
    const snapshot=await get(path(user.uid));
    const value=snapshot.val();
    return value?{revision:value.revision||0,vault:JSON.parse(value.payload)}:{revision:0,vault:null};
  };
  return {
    async register(email,password,displayName){
      await prepare();
      const {user}=await createUserWithEmailAndPassword(auth,email,password);
      if(displayName)await updateProfile(user,{displayName});
      await sendEmailVerification(user);
      await signOut(auth);
      return {pendingVerification:true};
    },
    async login(email,password){
      await prepare();const user=(await signInWithEmailAndPassword(auth,email,password)).user;
      await reload(user);
      if(!user.emailVerified){await signOut(auth);throw new Error('邮箱尚未验证。请打开注册时收到的验证邮件，再返回登录。');}
      return userInfo(user);
    },
    async resendVerification(email,password){
      await prepare();const user=(await signInWithEmailAndPassword(auth,email,password)).user;
      try{if(!user.emailVerified)await sendEmailVerification(user);}finally{await signOut(auth);}
    },
    async reset(email){await sendPasswordResetEmail(auth,email);},
    async logout(){await signOut(auth);},
    async read(uid){
      if(!auth.currentUser||auth.currentUser.uid!==uid)throw new Error('请重新登录云账号。');
      return read(auth.currentUser);
    },
    async write(uid,revision,vault){
      if(!auth.currentUser||auth.currentUser.uid!==uid)throw new Error('请重新登录云账号。');
      const payload=JSON.stringify(vault);
      if(new TextEncoder().encode(payload).length>4_000_000)throw new Error('云资料已超过当前单账号 4 MB 安全上限，请先导出备份并精简大段附件。');
      const result=await runTransaction(path(uid),current=>{
        if((current?.revision||0)!==revision)return;
        return {revision:revision+1,payload};
      },{applyLocally:false});
      const value=result.snapshot.val();
      return result.committed?{revision:value.revision}:{conflict:true,revision:value?.revision||0,vault:value?JSON.parse(value.payload):null};
    }
  };
}
