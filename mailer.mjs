import nodemailer from 'nodemailer';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function createMailer({origin,dataDir,mode=process.env.MAIL_MODE||'',host=process.env.SMTP_HOST,port=Number(process.env.SMTP_PORT||465),user=process.env.SMTP_USER,password=process.env.SMTP_PASSWORD,from=process.env.SMTP_FROM}={}){
  if(!origin)throw new Error('APP_ORIGIN 必须设置为网站的公开地址。');
  const isProduction=process.env.NODE_ENV==='production';
  if(isProduction&&(!origin.startsWith('https://')||!host||!from||mode==='file'))throw new Error('生产部署必须配置 HTTPS APP_ORIGIN、SMTP_HOST 和 SMTP_FROM，且不得使用文件邮件模式。');
  const fileMode=mode==='file'||(!isProduction&&!host);
  if(!fileMode&&(!host||!from))throw new Error('请配置 SMTP_HOST 和 SMTP_FROM。');
  const transport=fileMode?null:nodemailer.createTransport({host,port,secure:port===465,requireTLS:port!==465,auth:user?{user,pass:password}:undefined,pool:true,maxConnections:4,connectionTimeout:10000,socketTimeout:20000});
  const outbox=join(dataDir,'dev-mailbox');
  return {
    mode:fileMode?'file':'smtp',
    verify:async()=>fileMode?true:transport.verify(),
    async send({to,purpose,token}){
      const label=purpose==='verify'?'验证邮箱':'重置密码';
      const link=`${origin}/#${purpose==='verify'?'verify':'reset'}=${encodeURIComponent(token)}`;
      const subject=`研析工作平台｜${label}`;
      const text=purpose==='verify'?`请在 30 分钟内打开以下链接，验证你在研析工作平台的邮箱：\n${link}\n\n若并非你本人注册，请忽略此邮件。`:`请在 15 分钟内打开以下链接重置密码：\n${link}\n\n重置后，原密码加密的未同步离线缓存无法用新密码解开。若并非你本人操作，请忽略此邮件。`;
      if(fileMode){await mkdir(outbox,{recursive:true});const path=join(outbox,`${Date.now()}-${randomBytes(4).toString('hex')}.json`);await writeFile(path,JSON.stringify({to,subject,text,link,purpose,createdAt:new Date().toISOString()},null,2),{mode:0o600});return;}
      await transport.sendMail({from,to,subject,text});
    },
    close:()=>transport?.close()
  };
}
