// A portable, encrypted, self-contained dataset snapshot. No password or
// plaintext research data is sent to the website or stored in this module.
const encoder=new TextEncoder(),decoder=new TextDecoder();
const b64=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};
const unb64=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
const hex=bytes=>[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const MAX_PLAINTEXT=120_000_000;

export async function sha256(value){
  const bytes=typeof value==='string'?encoder.encode(value):value;
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
}

async function derive(passphrase,salt){
  if(typeof passphrase!=='string'||passphrase.length<10)throw new Error('复现包口令至少需要 10 个字符。');
  const source=await crypto.subtle.importKey('raw',encoder.encode(passphrase),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:260000,hash:'SHA-256'},source,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}

async function compress(bytes){
  if(!globalThis.CompressionStream)return {bytes,compression:'none'};
  const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return {bytes:new Uint8Array(await new Response(stream).arrayBuffer()),compression:'gzip'};
}
async function decompress(bytes,method){
  if(method==='none')return bytes;
  if(method!=='gzip'||!globalThis.DecompressionStream)throw new Error('当前浏览器不支持此复现包的解压格式。');
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader=stream.getReader(),pieces=[];
  let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.length;
      if(total>MAX_PLAINTEXT)throw new Error('复现包解压后超过 120 MB，未修改任何记录。');
      pieces.push(value);
    }
  }finally{await reader.cancel().catch(()=>{});}
  const result=new Uint8Array(total);let offset=0;
  for(const piece of pieces){result.set(piece,offset);offset+=piece.length;}
  return result;
}

export async function packResearchDataset(experiment,dataset,originalBytes,passphrase){
  if(!dataset?.id||!Array.isArray(dataset.rows)||!dataset.rows.length)throw new Error('没有可打包的完整数据。');
  const sourceBytes=originalBytes instanceof Uint8Array?originalBytes:null;
  if(sourceBytes&&dataset.source?.sha256&&await sha256(sourceBytes)!==dataset.source.sha256)throw new Error('仪器原文件校验值不一致，已停止打包。');
  const contextKeys=['id','sampleId','material','batch','date','method','project','ratio','agent','vessel','atmosphere','sourceTemp','growthTemp','peakTemp','holdTime','coolingRate','postTreatment','crystalSize','yield','measurements','results','quality','notes','schedule','lineage','qualityCriteria','figures','runComparison','runEvents','outcomeReviews'];
  const context=Object.fromEntries(contextKeys.map(key=>[key,experiment?.[key]??(key==='schedule'||key==='lineage'||key==='qualityCriteria'||key==='figures'?[]:'')]));
  const payload={format:'yanxi-research-dataset',version:1,createdAt:new Date().toISOString(),experiment:context,dataset,originalBytes:sourceBytes?b64(sourceBytes):null};
  const plaintext=encoder.encode(JSON.stringify(payload));
  if(plaintext.length>MAX_PLAINTEXT)throw new Error('单个复现包超过 120 MB，请按扫描段拆分数据。');
  const {bytes,compression}=await compress(plaintext),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await derive(passphrase,salt),ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes));
  return {format:'yanxi-encrypted-research-package',version:1,compression,kdf:'PBKDF2-SHA256-260000',cipher:'AES-256-GCM',salt:b64(salt),iv:b64(iv),sha256:await sha256(plaintext),plaintextBytes:plaintext.length,ciphertext:b64(ciphertext)};
}

export async function unpackResearchDataset(packageValue,passphrase){
  const bundle=typeof packageValue==='string'?JSON.parse(packageValue):packageValue;
  if(bundle?.format!=='yanxi-encrypted-research-package'||bundle.version!==1||bundle.kdf!=='PBKDF2-SHA256-260000'||bundle.cipher!=='AES-256-GCM')throw new Error('不是受支持的研析加密复现包。');
  if(!Number.isSafeInteger(bundle.plaintextBytes)||bundle.plaintextBytes<1||bundle.plaintextBytes>MAX_PLAINTEXT||typeof bundle.ciphertext!=='string'||bundle.ciphertext.length>170_000_000)throw new Error('复现包大小或格式无效。');
  let plaintext;
  try{
    const key=await derive(passphrase,unb64(bundle.salt));
    const bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(bundle.iv)},key,unb64(bundle.ciphertext)));
    plaintext=await decompress(bytes,bundle.compression);
  }catch(error){if(error.message?.includes('口令'))throw error;throw new Error('口令错误、文件损坏或解压失败，未修改任何记录。');}
  if(plaintext.length!==bundle.plaintextBytes||await sha256(plaintext)!==bundle.sha256)throw new Error('复现包校验失败，未修改任何记录。');
  const payload=JSON.parse(decoder.decode(plaintext));
  if(payload.format!=='yanxi-research-dataset'||payload.version!==1||!payload.dataset?.id||!Array.isArray(payload.dataset.rows)||!payload.dataset.rows.length)throw new Error('复现包数据结构无效。');
  if(payload.originalBytes!=null&&payload.dataset.source?.sha256&&await sha256(unb64(payload.originalBytes))!==payload.dataset.source.sha256)throw new Error('仪器原文件校验失败，未修改任何记录。');
  return payload;
}

export function originalFileBytes(payload){return payload?.originalBytes==null?null:unb64(payload.originalBytes);}

// A whole-run archive is intentionally distinct from the single-dataset format.
// Importers must verify every raw file before changing the local vault.
export async function packWholeExperiment(experiment,rawFiles={},passphrase){
  if(!experiment?.id||!Array.isArray(experiment.datasets))throw new Error('没有可打包的实验记录。');
  const originals={},missingOriginals=[];
  for(const dataset of experiment.datasets){
    const bytes=rawFiles[dataset.id];
    if(bytes==null){missingOriginals.push(dataset.id);continue;}
    if(!(bytes instanceof Uint8Array))throw new Error('原始文件必须是字节数据。');
    if(dataset.source?.sha256&&await sha256(bytes)!==dataset.source.sha256)throw new Error(`${dataset.name||dataset.id} 的仪器原文件校验失败。`);
    originals[dataset.id]=b64(bytes);
  }
  const payload={format:'yanxi-whole-experiment',version:1,createdAt:new Date().toISOString(),experiment,originals,missingOriginals};
  const plaintext=encoder.encode(JSON.stringify(payload));
  if(plaintext.length>MAX_PLAINTEXT)throw new Error('整次实验档案超过 120 MB，请先分数据集导出复现包。');
  const {bytes,compression}=await compress(plaintext),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await derive(passphrase,salt),ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes));
  return {format:'yanxi-encrypted-experiment-package',version:1,compression,kdf:'PBKDF2-SHA256-260000',cipher:'AES-256-GCM',salt:b64(salt),iv:b64(iv),sha256:await sha256(plaintext),plaintextBytes:plaintext.length,ciphertext:b64(ciphertext),missingOriginals};
}
export async function unpackWholeExperiment(packageValue,passphrase){
  const bundle=typeof packageValue==='string'?JSON.parse(packageValue):packageValue;
  if(bundle?.format!=='yanxi-encrypted-experiment-package'||bundle.version!==1||bundle.kdf!=='PBKDF2-SHA256-260000'||bundle.cipher!=='AES-256-GCM')throw new Error('不是受支持的整次实验复现档案。');
  if(!Number.isSafeInteger(bundle.plaintextBytes)||bundle.plaintextBytes<1||bundle.plaintextBytes>MAX_PLAINTEXT||typeof bundle.ciphertext!=='string'||bundle.ciphertext.length>170_000_000)throw new Error('档案大小或格式无效。');
  let plaintext;
  try{const key=await derive(passphrase,unb64(bundle.salt));const bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(bundle.iv)},key,unb64(bundle.ciphertext)));plaintext=await decompress(bytes,bundle.compression);}
  catch(error){if(error.message?.includes('口令'))throw error;throw new Error('口令错误、档案损坏或解压失败，未修改任何记录。');}
  if(plaintext.length!==bundle.plaintextBytes||await sha256(plaintext)!==bundle.sha256)throw new Error('档案校验失败，未修改任何记录。');
  const payload=JSON.parse(decoder.decode(plaintext));
  if(payload.format!=='yanxi-whole-experiment'||payload.version!==1||!payload.experiment?.id||!Array.isArray(payload.experiment.datasets)||payload.experiment.datasets.length>12||!payload.originals||typeof payload.originals!=='object')throw new Error('档案数据结构无效。');
  const ids=new Set(payload.experiment.datasets.map(item=>item.id));
  if(ids.size!==payload.experiment.datasets.length||Object.keys(payload.originals).some(key=>!ids.has(key)))throw new Error('档案中的数据集标识无效。');
  const originals={};for(const [datasetId,value] of Object.entries(payload.originals)){
    if(typeof value!=='string'||value.length>35_000_000)throw new Error('仪器原文件格式无效。');
    const bytes=unb64(value),dataset=payload.experiment.datasets.find(item=>item.id===datasetId);
    if(dataset.source?.sha256&&await sha256(bytes)!==dataset.source.sha256)throw new Error('仪器原文件校验失败，未修改任何记录。');
    originals[datasetId]=bytes;
  }
  return {experiment:payload.experiment,originals,missingOriginals:payload.missingOriginals||[]};
}

export function splitCloudPackage(bundle,chunkSize=500_000){
  const serialized=JSON.stringify(bundle),bytes=encoder.encode(serialized).length;
  if(bytes>60_000_000)throw new Error('加密复现包超过 60 MB，暂不适合免费云端备份；请使用下载文件跨设备转移。');
  const chunks=[];for(let offset=0;offset<serialized.length;offset+=chunkSize)chunks.push(serialized.slice(offset,offset+chunkSize));
  if(!chunks.length||chunks.length>160)throw new Error('复现包分块数量无效。');
  return {chunks,bytes};
}
export function joinCloudPackage(chunks,expectedBytes){
  if(!Array.isArray(chunks)||!chunks.length||chunks.length>160||chunks.some(chunk=>typeof chunk!=='string'||chunk.length>500_000))throw new Error('云端分块缺失或无效。');
  const serialized=chunks.join('');
  if(encoder.encode(serialized).length!==expectedBytes)throw new Error('云端数据长度不符，未覆盖本机数据。');
  return JSON.parse(serialized);
}
