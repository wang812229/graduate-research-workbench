import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { digest,randomToken,validateUsername,validatePassword,normalizeEmail,validateEmail,newSalt,hashPassword,matchesPassword } from './auth-crypto.mjs';

export function openLocalDatabase(path){
  mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','user')),disabled INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,vault_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT OR IGNORE INTO settings(key,value) VALUES ('registration_open','true');`);
  const columns=db.prepare('PRAGMA table_info(users)').all().map(x=>x.name);
  if(!columns.includes('email'))db.exec('ALTER TABLE users ADD COLUMN email TEXT');
  if(!columns.includes('email_verified'))db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL');
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_one_admin ON users(role) WHERE role='admin'");
  db.exec(`CREATE TABLE IF NOT EXISTS email_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,used_at INTEGER);CREATE INDEX IF NOT EXISTS email_tokens_user_purpose ON email_tokens(user_id,purpose,created_at);`);
  const publicUser=row=>row&&({id:row.id,username:row.username,displayName:row.display_name,email:row.email||'',emailVerified:Boolean(row.email_verified),role:row.role,createdAt:row.created_at,disabled:Boolean(row.disabled)});
  return {
    close:()=>db.close(),
    countUsers:async()=>db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    registrationOpen:async()=>db.prepare("SELECT value FROM settings WHERE key='registration_open'").get().value==='true',
    setRegistrationOpen:async value=>{db.prepare("UPDATE settings SET value=? WHERE key='registration_open'").run(value?'true':'false');},
    async createUser({username,displayName,email,password,role,vault,allowNoEmail=false}){
      username=String(username||'').toLowerCase();email=normalizeEmail(email);
      if(!validateUsername(username))throw new Error('用户名需为 3–32 位小写字母、数字、点、下划线或连字符。');
      if((!email&&!allowNoEmail)||(email&&!validateEmail(email)))throw new Error('请填写有效邮箱地址。');
      if(!validatePassword(password))throw new Error('密码需为 10–200 个字符。');
      if(!['admin','user'].includes(role))throw new Error('无效角色。');
      const id=randomBytes(16).toString('hex'),salt=newSalt(),createdAt=new Date().toISOString(),passwordHash=await hashPassword(password,salt);
      db.prepare('INSERT INTO users(id,username,display_name,email,email_verified,password_salt,password_hash,role,created_at,vault_json) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,username,String(displayName||username).slice(0,64),email||null,role==='admin'?1:0,salt,passwordHash,role,createdAt,JSON.stringify(vault));
      return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
    },
    async verifyLogin(username,password){
      const identifier=String(username||'').toLowerCase();
      const row=db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(identifier,identifier);
      if(!row||row.disabled||(row.email&&!row.email_verified)||typeof password!=='string')return null;
      return await matchesPassword(password,row.password_salt,row.password_hash)?publicUser(row):null;
    },
    createSession:async userId=>{const token=randomToken(),expiresAt=Date.now()+30*86400_000;db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(digest(token),userId,expiresAt);return {token,expiresAt};},
    getSession:async token=>{if(!token)return null;const row=db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?').get(digest(token),Date.now());return row&&!row.disabled?publicUser(row):null;},
    removeSession:async token=>{if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));},
    getVault:async userId=>{const row=db.prepare('SELECT revision,vault_json FROM users WHERE id=?').get(userId);return row&&{revision:row.revision,vault:JSON.parse(row.vault_json)};},
    saveVault:async(userId,revision,vault)=>{const changed=db.prepare('UPDATE users SET vault_json=?,revision=revision+1 WHERE id=? AND revision=?').run(JSON.stringify(vault),userId,revision).changes;const row=db.prepare('SELECT revision,vault_json FROM users WHERE id=?').get(userId);return changed?{revision:row.revision,vault:JSON.parse(row.vault_json)}:null;},
    async changePassword(userId,oldPassword,newPassword){
      const row=db.prepare('SELECT * FROM users WHERE id=?').get(userId);
      if(!row||!await matchesPassword(oldPassword,row.password_salt,row.password_hash))return false;
      if(!validatePassword(newPassword))throw new Error('新密码需为 10–200 个字符。');
      const salt=newSalt(),passwordHash=await hashPassword(newPassword,salt);
      db.prepare('UPDATE users SET password_salt=?,password_hash=? WHERE id=?').run(salt,passwordHash,userId);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);return true;
    },
    async changeEmail(userId,password,email){
      const row=db.prepare('SELECT * FROM users WHERE id=?').get(userId);email=normalizeEmail(email);
      if(!row||!await matchesPassword(password,row.password_salt,row.password_hash))return null;
      if(!validateEmail(email))throw new Error('请填写有效邮箱地址。');
      db.exec('BEGIN IMMEDIATE');
      try{db.prepare('UPDATE users SET email=?,email_verified=0 WHERE id=?').run(email,userId);db.prepare("DELETE FROM email_tokens WHERE user_id=? AND purpose='verify'").run(userId);db.exec('COMMIT');}
      catch(error){db.exec('ROLLBACK');throw error;}
      return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(userId));
    },
    listUsers:async()=>db.prepare('SELECT * FROM users ORDER BY created_at').all().map(publicUser),
    setDisabled:async(userId,value)=>{const target=db.prepare('SELECT role FROM users WHERE id=?').get(userId);if(!target||target.role==='admin')throw new Error('不能停用管理员账号。');db.prepare('UPDATE users SET disabled=? WHERE id=?').run(value?1:0,userId);if(value)db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);},
    findByEmail:async email=>{const row=db.prepare('SELECT * FROM users WHERE email=?').get(normalizeEmail(email));return row&&publicUser(row);},
    latestTokenAt:async(userId,purpose)=>db.prepare('SELECT MAX(created_at) AS timestamp FROM email_tokens WHERE user_id=? AND purpose=?').get(userId,purpose).timestamp,
    issueToken:async(userId,purpose,ttlMs)=>{const token=randomToken(),now=Date.now();db.prepare('INSERT INTO email_tokens(token_hash,user_id,purpose,expires_at,created_at) VALUES (?,?,?,?,?)').run(digest(token),userId,purpose,now+ttlMs,now);return token;},
    async consumeToken(token,purpose,newPassword){
      if(typeof token!=='string'||token.length>256)return false;
      const row=db.prepare('SELECT * FROM email_tokens WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>?').get(digest(token),purpose,Date.now());
      if(!row)return false;
      let salt,hash;
      if(purpose==='reset'){if(!validatePassword(newPassword))throw new Error('新密码需为 10–200 个字符。');salt=newSalt();hash=await hashPassword(newPassword,salt);}
      db.exec('BEGIN IMMEDIATE');
      try{
        const used=db.prepare('UPDATE email_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?').run(Date.now(),row.token_hash,Date.now()).changes;
        if(!used){db.exec('ROLLBACK');return false;}
        if(purpose==='verify')db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(row.user_id);
        else {db.prepare('UPDATE users SET password_salt=?,password_hash=? WHERE id=?').run(salt,hash,row.user_id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);}
        db.prepare('UPDATE email_tokens SET used_at=? WHERE user_id=? AND purpose=? AND used_at IS NULL').run(Date.now(),row.user_id,purpose);
        db.exec('COMMIT');return true;
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
  };
}
