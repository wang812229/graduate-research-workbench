import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive=promisify(scrypt);
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const randomToken=()=>randomBytes(32).toString('base64url');
export const validateUsername=value=>typeof value==='string'&&/^[a-z0-9._-]{3,32}$/.test(value.toLowerCase());
export const validatePassword=value=>typeof value==='string'&&value.length>=10&&value.length<=200;
export const normalizeEmail=value=>String(value||'').trim().toLowerCase();
export const validateEmail=value=>typeof value==='string'&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const newSalt=()=>randomBytes(16).toString('hex');
export async function hashPassword(password,salt){return (await derive(password,Buffer.from(salt,'hex'),64,{N:16384,r:8,p:1})).toString('hex');}
export async function matchesPassword(password,salt,expectedHex){
  const actual=Buffer.from(await hashPassword(password,salt),'hex'),expected=Buffer.from(expectedHex,'hex');
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
