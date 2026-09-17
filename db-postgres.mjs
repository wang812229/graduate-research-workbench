import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { digest,randomToken,validateUsername,validatePassword,normalizeEmail,validateEmail,newSalt,hashPassword,matchesPassword } from './auth-crypto.mjs';
const {Pool}=pg;
const publicUser=row=>row&&({id:row.id,username:row.username,displayName:row.display_name,email:row.email||'',emailVerified:Boolean(row.email_verified),role:row.role,createdAt:row.created_at,disabled:Boolean(row.disabled)});

export async function openPostgres(url){
  const pool=new Pool({connectionString:url,max:Number(process.env.PG_POOL_SIZE||12),idleTimeoutMillis:30000,connectionTimeoutMillis:5000});
  pool.on('error',error=>console.error('PostgreSQL idle connection error:',error.message));
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,
    password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','user')),
    disabled BOOLEAN NOT NULL DEFAULT FALSE,created_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,vault_json JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO settings(key,value) VALUES ('registration_open','true') ON CONFLICT(key) DO NOTHING;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS users_one_admin ON users(role) WHERE role='admin';
    CREATE TABLE IF NOT EXISTS email_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),expires_at BIGINT NOT NULL,created_at BIGINT NOT NULL,used_at BIGINT);
    CREATE INDEX IF NOT EXISTS email_tokens_user_purpose ON email_tokens(user_id,purpose,created_at);`);
  return {
    close:()=>pool.end(),
    countUsers:async()=>Number((await pool.query('SELECT COUNT(*) AS n FROM users')).rows[0].n),
    registrationOpen:async()=>(await pool.query("SELECT value FROM settings WHERE key='registration_open'")).rows[0].value==='true',
    setRegistrationOpen:async value=>{await pool.query("UPDATE settings SET value=$1 WHERE key='registration_open'",[value?'true':'false']);},
    async createUser({username,displayName,email,password,role,vault,allowNoEmail=false}){
      username=String(username||'').toLowerCase();email=normalizeEmail(email);
      if(!validateUsername(username))throw new Error('用户名需为 3–32 位小写字母、数字、点、下划线或连字符。');
      if((!email&&!allowNoEmail)||(email&&!validateEmail(email)))throw new Error('请填写有效邮箱地址。');
      if(!validatePassword(password))throw new Error('密码需为 10–200 个字符。');
      if(!['admin','user'].includes(role))throw new Error('无效角色。');
      const id=randomBytes(16).toString('hex'),salt=newSalt(),hash=await hashPassword(password,salt);
      const result=await pool.query('INSERT INTO users(id,username,display_name,email,email_verified,password_salt,password_hash,role,created_at,vault_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[id,username,String(displayName||username).slice(0,64),email||null,role==='admin',salt,hash,role,new Date().toISOString(),JSON.stringify(vault)]);
      return publicUser(result.rows[0]);
    },
    async verifyLogin(username,password){
      const identifier=String(username||'').toLowerCase();
      const row=(await pool.query('SELECT * FROM users WHERE username=$1 OR email=$1',[identifier])).rows[0];
      if(!row||row.disabled||(row.email&&!row.email_verified)||typeof password!=='string')return null;
      return await matchesPassword(password,row.password_salt,row.password_hash)?publicUser(row):null;
    },
    createSession:async userId=>{const token=randomToken(),expiresAt=Date.now()+30*86400_000;await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[digest(token),userId,expiresAt]);return {token,expiresAt};},
    getSession:async token=>{if(!token)return null;const row=(await pool.query('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=$1 AND sessions.expires_at>$2',[digest(token),Date.now()])).rows[0];return row&&!row.disabled?publicUser(row):null;},
    removeSession:async token=>{if(token)await pool.query('DELETE FROM sessions WHERE token_hash=$1',[digest(token)]);},
    getVault:async userId=>{const row=(await pool.query('SELECT revision,vault_json FROM users WHERE id=$1',[userId])).rows[0];return row&&{revision:row.revision,vault:row.vault_json};},
    saveVault:async(userId,revision,vault)=>{const row=(await pool.query('UPDATE users SET vault_json=$1,revision=revision+1 WHERE id=$2 AND revision=$3 RETURNING revision,vault_json',[JSON.stringify(vault),userId,revision])).rows[0];return row&&{revision:row.revision,vault:row.vault_json};},
    async changePassword(userId,oldPassword,newPassword){
      const row=(await pool.query('SELECT * FROM users WHERE id=$1',[userId])).rows[0];
      if(!row||!await matchesPassword(oldPassword,row.password_salt,row.password_hash))return false;
      if(!validatePassword(newPassword))throw new Error('新密码需为 10–200 个字符。');
      const salt=newSalt(),hash=await hashPassword(newPassword,salt);
      await pool.query('UPDATE users SET password_salt=$1,password_hash=$2 WHERE id=$3',[salt,hash,userId]);
      await pool.query('DELETE FROM sessions WHERE user_id=$1',[userId]);return true;
    },
    async changeEmail(userId,password,email){
      const row=(await pool.query('SELECT * FROM users WHERE id=$1',[userId])).rows[0];email=normalizeEmail(email);
      if(!row||!await matchesPassword(password,row.password_salt,row.password_hash))return null;
      if(!validateEmail(email))throw new Error('请填写有效邮箱地址。');
      const client=await pool.connect();
      try{await client.query('BEGIN');const updated=(await client.query('UPDATE users SET email=$1,email_verified=FALSE WHERE id=$2 RETURNING *',[email,userId])).rows[0];await client.query("DELETE FROM email_tokens WHERE user_id=$1 AND purpose='verify'",[userId]);await client.query('COMMIT');return publicUser(updated);}
      catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    listUsers:async()=>(await pool.query('SELECT * FROM users ORDER BY created_at')).rows.map(publicUser),
    async setDisabled(userId,value){const row=(await pool.query("UPDATE users SET disabled=$1 WHERE id=$2 AND role<>'admin' RETURNING id",[value,userId])).rows[0];if(!row)throw new Error('不能停用管理员账号或账号不存在。');if(value)await pool.query('DELETE FROM sessions WHERE user_id=$1',[userId]);},
    findByEmail:async email=>publicUser((await pool.query('SELECT * FROM users WHERE email=$1',[normalizeEmail(email)])).rows[0]),
    latestTokenAt:async(userId,purpose)=>Number((await pool.query('SELECT MAX(created_at) AS timestamp FROM email_tokens WHERE user_id=$1 AND purpose=$2',[userId,purpose])).rows[0].timestamp||0),
    issueToken:async(userId,purpose,ttlMs)=>{const token=randomToken(),now=Date.now();await pool.query('INSERT INTO email_tokens(token_hash,user_id,purpose,expires_at,created_at) VALUES($1,$2,$3,$4,$5)',[digest(token),userId,purpose,now+ttlMs,now]);return token;},
    async consumeToken(token,purpose,newPassword){
      if(typeof token!=='string'||token.length>256)return false;
      let salt,hash;if(purpose==='reset'){if(!validatePassword(newPassword))throw new Error('新密码需为 10–200 个字符。');salt=newSalt();hash=await hashPassword(newPassword,salt);}
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const row=(await client.query('UPDATE email_tokens SET used_at=$1 WHERE token_hash=$2 AND purpose=$3 AND used_at IS NULL AND expires_at>$1 RETURNING user_id',[Date.now(),digest(token),purpose])).rows[0];
        if(!row){await client.query('ROLLBACK');return false;}
        if(purpose==='verify')await client.query('UPDATE users SET email_verified=TRUE WHERE id=$1',[row.user_id]);
        else{await client.query('UPDATE users SET password_salt=$1,password_hash=$2 WHERE id=$3',[salt,hash,row.user_id]);await client.query('DELETE FROM sessions WHERE user_id=$1',[row.user_id]);}
        await client.query('UPDATE email_tokens SET used_at=$1 WHERE user_id=$2 AND purpose=$3 AND used_at IS NULL',[Date.now(),row.user_id,purpose]);
        await client.query('COMMIT');return true;
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }
  };
}
