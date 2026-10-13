const form=document.querySelector('#refine-form'),status=document.querySelector('#status'),result=document.querySelector('#result'),submit=document.querySelector('#submit');
const referenceDialog=document.querySelector('#xrd-reference-dialog');
let referenceRequest=null,referenceTrigger=null;
function closeReference(){referenceRequest?.abort();referenceRequest=null;referenceDialog.close();referenceTrigger?.focus();}
document.querySelector('#xrd-reference-close').addEventListener('click',closeReference);
referenceDialog.addEventListener('cancel',()=>{referenceRequest?.abort();referenceRequest=null;});
document.querySelector('#xrd-return').addEventListener('click',event=>{
  if(window.parent!==window){event.preventDefault();window.parent.postMessage({type:'yanxi-xrd-return'},location.origin);}
});
document.addEventListener('click',async event=>{
  const link=event.target.closest('[data-xrd-reference]');if(!link)return;
  event.preventDefault();referenceRequest?.abort();referenceRequest=new AbortController();
  const request=referenceRequest;referenceTrigger=link;
  const title=document.querySelector('#xrd-reference-title'),content=document.querySelector('#xrd-reference-content'),message=document.querySelector('#xrd-reference-status');
  title.textContent=link.dataset.xrdReference==='instrument'?'Rigaku Ultima IV 设备档案':'独立计算环境接入说明';content.textContent='';message.textContent='正在读取资料…';
  if(!referenceDialog.open)referenceDialog.showModal();
  try{
    const url=new URL(link.href);if(url.origin!==location.origin)throw new Error('帮助资料必须来自本平台');
    const response=await fetch(url,{signal:request.signal});if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const text=await response.text();if(referenceRequest!==request)return;
    content.textContent=link.dataset.xrdReference==='instrument'?JSON.stringify(JSON.parse(text),null,2):text;
    message.textContent='关闭此窗口即可继续；上传文件、令牌和计算结果不会因此清除。';
  }catch(error){if(error.name!=='AbortError'&&referenceRequest===request)message.textContent=`资料暂时无法读取：${error.message}。可直接关闭此窗口返回精修。`;}
});
let objectUrls=[];
const candidateLabels={'01_scale_background':'尺度与背景','02_cell_only':'仅晶胞','03_zero_only':'仅零点','04_cell_zero_simultaneous':'晶胞与零点同时释放','05_cell_then_zero':'先晶胞后零点','06_zero_then_cell':'先零点后晶胞'};
const candidateLabel=candidate=>candidateLabels[candidate.name]||candidate.name;
function say(message,error=false){status.textContent=message;status.classList.toggle('error',error);}
function element(tag,text='',className=''){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;}
function file64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});}
function zipBlob(base64){const raw=atob(base64),array=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)array[i]=raw.charCodeAt(i);return new Blob([array],{type:'application/zip'});}
function objectUrl(blob){const value=URL.createObjectURL(blob);objectUrls.push(value);return value;}
async function callService(path,body){const data=new FormData(form),port=Number(data.get('port'));if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('端口必须为 1024–65535');const response=await fetch(`http://127.0.0.1:${port}/${path}`,{method:'POST',headers:{Authorization:`Bearer ${data.get('token')}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const payload=await response.json();if(!response.ok)throw new Error(payload.error||`本机服务返回 ${response.status}`);return payload;}
function showOutput(payload){
  for(const url of objectUrls)URL.revokeObjectURL(url);objectUrls=[];
  const output=payload.result;result.replaceChildren();result.hidden=false;
  result.append(element('h3',output.selected_candidate?'已保存选定审查模型':'精修分支已运行，待比较与审查'));
  const link=element('a',output.selected_candidate?'下载选定结果与完整审查档案':'下载全部候选（GPX、差谱、Origin CSV、诊断）','archive-link');link.href=objectUrl(zipBlob(payload.zip_base64));link.download=`yanxi-gsasii-${output.selected_candidate?'selected':'candidates'}-${new Date().toISOString().replaceAll(':','-')}.zip`;result.append(link);
  result.append(element('p',`${output.points} 个数据点；结果目录：${payload.local_directory}`,'metadata'));
  if(output.candidates){
    const table=element('table','','candidate-table'),head=element('tr');for(const label of ['候选','Rwp %','GOF','数值审查'])head.append(element('th',label));table.append(head);
    for(const candidate of output.candidates){const row=element('tr');for(const value of [candidateLabel(candidate),Number.isFinite(candidate.Rwp)?candidate.Rwp.toFixed(3):'未完成',Number.isFinite(candidate.GOF)?candidate.GOF.toFixed(3):'—',candidate.eligible_for_selection?'可继续审查':candidate.selection_errors.join('；')])row.append(element('td',value));table.append(row);}result.append(table);
    const preview=element('select'),image=element('img','','candidate-plot');preview.setAttribute('aria-label','选择要查看差谱的候选');image.alt='真实 GSAS-II 候选全谱计算与实测差谱';
    for(const candidate of output.candidates){if(!payload.preview_svg?.[candidate.name])continue;const option=element('option',candidateLabel(candidate));option.value=candidate.name;preview.append(option);}
    const showPlot=()=>{const svg=payload.preview_svg?.[preview.value];if(svg){image.src=objectUrl(new Blob([svg],{type:'image/svg+xml'}));image.hidden=false;}else image.hidden=true;};preview.addEventListener('change',showPlot);if(preview.options.length){result.append(element('p','比较各分支差谱：'),preview,image);showPlot();}
    if(!output.selected_candidate){
      const eligible=output.candidates.filter(candidate=>candidate.eligible_for_selection);
      if(eligible.length){const reviewForm=element('form'),choice=element('select'),note=element('textarea','','review-input'),button=element('button','保存选定模型、校验报告并归档');choice.required=true;choice.append(element('option','请选择经你审查的候选'));choice.options[0].value='';for(const candidate of eligible){const option=element('option',`${candidateLabel(candidate)} · Rwp ${candidate.Rwp.toFixed(3)}%`);option.value=candidate.name;choice.append(option);}note.required=true;note.minLength=10;note.maxLength=5000;note.placeholder='记录强峰与差谱是否匹配、杂相/背景问题、晶胞与零点路径依赖，以及选此候选的理由。';button.type='submit';reviewForm.append(element('p','数值门槛通过后，仍需核对全谱差谱与相模型。'),choice,note,button);reviewForm.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;say('正在调用 skill 选择门槛、报告校验与归档…');try{showOutput(await callService('select',{job_id:payload.job_id,candidate:choice.value,review_note:note.value}));say('选定模型与审查档案已保存，请下载并保留原始证据。');}catch(error){say(error.message,true);button.disabled=false;}});result.append(reviewForm);}
      else result.append(element('p','所有候选都被数值门槛阻止。请保留审查包，检查输入、光路、结构模型与差谱后再运行。'));
    }
  }else if(output.stages){result.append(element('p',`末阶段 wR = ${Number(output.stages.at(-1).wR_percent).toFixed(3)}%`));}
  for(const warning of output.warnings||[])result.append(element('p',`注意：${warning}`));
}
form.addEventListener('submit',async event=>{
  event.preventDefault();submit.disabled=true;result.hidden=true;say('正在核查输入并调用真实 GSAS-II skill。六个分支可能需要数分钟，请保持本机服务开启。');
  try{
    const data=new FormData(form),files={};
    for(const kind of ['pattern','structure','instrument','card']){const file=data.get(kind);if(!file?.size){if(kind==='card')continue;throw new Error(`缺少 ${kind} 文件`);}if(file.size>30*1024*1024)throw new Error(`${kind} 超过 30 MB`);files[kind]={name:file.name,base64:await file64(file)};}
    const metadata={preset:String(data.get('instrument_preset')),target:String(data.get('target')),scan_geometry:String(data.get('scan_geometry')),goniometer_radius_mm:Number(data.get('goniometer_radius_mm'))};
    if(!metadata.target||!metadata.scan_geometry)throw new Error('请填写本次扫描的实际靶材与几何');if(metadata.scan_geometry!=='bragg-brentano')throw new Error('当前自动精修仅支持 Bragg–Brentano 常波长粉末扫描，请为其他几何建立相应模型');
    const payload=await callService('refine',{files,workflow:'skill',instrument_metadata:metadata,background_terms:Number(data.get('background_terms')),confirm_structure_match:data.has('confirm_structure_match'),confirm_instrument_calibrated:data.has('confirm_instrument_calibrated'),confirm_card_same_wavelength:data.has('confirm_card_same_wavelength')});showOutput(payload);say('真实 skill 分支运算结束。请比较差谱与数值审查，再决定选定模型。');
  }catch(error){say(`未得到有效结果：${error.message}。请查看本机服务终端。`,true);}finally{submit.disabled=false;}
});
