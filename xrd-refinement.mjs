const form=document.querySelector('#refine-form');
const status=document.querySelector('#status');
const result=document.querySelector('#result');
const submit=document.querySelector('#submit');

function say(message,error=false){status.textContent=message;status.classList.toggle('error',error);}
function file64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});}
function zipBlob(base64){const raw=atob(base64),array=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)array[i]=raw.charCodeAt(i);return new Blob([array],{type:'application/zip'});}
form.addEventListener('submit',async event=>{
  event.preventDefault();submit.disabled=true;result.hidden=true;say('正在检查文件并调用本机 GSAS-II。大样品可能需要数分钟，请勿关闭本机服务。');
  try{
    const data=new FormData(form),files={};
    for(const kind of ['pattern','structure','instrument','card']){
      const file=data.get(kind);if(!file?.size){if(kind==='card')continue;throw new Error(`缺少 ${kind} 文件`);}
      if(file.size>30*1024*1024)throw new Error(`${kind} 超过 30 MB`);
      files[kind]={name:file.name,base64:await file64(file)};
    }
    const port=Number(data.get('port'));if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('端口必须为 1024–65535');
    const response=await fetch(`http://127.0.0.1:${port}/refine`,{method:'POST',headers:{'Authorization':`Bearer ${data.get('token')}`,'Content-Type':'application/json'},body:JSON.stringify({files,background_terms:Number(data.get('background_terms')),refine_cell:data.has('refine_cell'),refine_profile:data.has('refine_profile'),confirm_structure_match:data.has('confirm_structure_match'),confirm_instrument_calibrated:data.has('confirm_instrument_calibrated'),confirm_card_same_wavelength:data.has('confirm_card_same_wavelength')})});
    const payload=await response.json();if(!response.ok)throw new Error(payload.error||`本机服务返回 ${response.status}`);
    const output=payload.result;const archive=zipBlob(payload.zip_base64);const link=document.createElement('a');link.href=URL.createObjectURL(archive);link.download=`yanxi-gsasii-${new Date().toISOString().replaceAll(':','-')}.zip`;link.textContent='下载完整精修包（GPX、CIF、Origin CSV、SVG、诊断）';
    result.replaceChildren();const title=document.createElement('h3');title.textContent='精修已运行，仍须人工审查';result.append(title,link);
    const stats=document.createElement('p');stats.textContent=`${output.points} 个数据点；末阶段 wR = ${Number(output.stages.at(-1).wR_percent).toFixed(3)}%；本地目录：${payload.local_directory}`;result.append(stats);
    for(const warning of output.warnings){const p=document.createElement('p');p.textContent=`注意：${warning}`;result.append(p);}
    result.hidden=false;say('真实 GSAS-II 运算结束。请检查差谱、杂相与结构化学合理性，勿只看 wR。');
  }catch(error){say(`未得到有效精修结果：${error.message}。请确认本机 GSAS-II 环境与令牌，或查看终端错误。`,true);}
  finally{submit.disabled=false;}
});
