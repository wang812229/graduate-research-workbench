export const PROFILE_KEYS = ['materials','methods','measurements','journals','authors'];
export const PAPER_GROUPS = ['准备复现','实验方法参考','生长方法参考','待组会汇报','与当前结果冲突','需要获取全文','需要补看SI'];
export const MEASUREMENT_TYPES = ['电阻/电输运','磁化/磁矩','比热','霍尔效应','I–V曲线','XRD/衍射','光谱','自定义'];
export const ANALYSIS_TYPES = ['RRR','超导转变温度','Curie–Weiss 拟合','C/T–T² 拟合','霍尔系数与迁移率'];
export const INSTRUMENT_TEMPLATES = ['通用表格','Quantum Design PPMS','Quantum Design MPMS','Keithley','XRD'];
export const EXPERIMENT_COLUMNS = ['date','project','sampleId','material','method','batch','ratio','agent','vessel','atmosphere','sourceTemp','growthTemp','peakTemp','holdTime','coolingRate','postTreatment','crystalSize','yield','measurements','results','quality','notes'];
const now = () => new Date().toISOString();
const clean = value => String(value ?? '').trim();
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

export function emptyVault() {
  return { schema: 1, profile: { updatedAt: now(), materials: [], methods: [], measurements: [], journals: [], authors: [] }, experiments: [], papers: [], projects: [], tasks: [] };
}

export function normalizeExperiment(raw = {}) {
  const result = { id: clean(raw.id) || uid('exp'), createdAt: clean(raw.createdAt) || now(), updatedAt: clean(raw.updatedAt) || now() };
  for (const key of EXPERIMENT_COLUMNS) result[key] = clean(raw[key]);
  result.project ||= '未分组';
  result.schedule = Array.isArray(raw.schedule) ? raw.schedule.map(s => ({ label: clean(s.label), hours: Number(s.hours), sourceC: s.sourceC === '' || s.sourceC == null ? null : Number(s.sourceC), growthC: s.growthC === '' || s.growthC == null ? null : Number(s.growthC) })).filter(s => s.label && Number.isFinite(s.hours) && s.hours >= 0 && (Number.isFinite(s.sourceC) || Number.isFinite(s.growthC))) : [];
  result.datasets = Array.isArray(raw.datasets) ? raw.datasets.slice(0,12).map(normalizeMeasurementDataset).filter(Boolean) : [];
  result.archived = Boolean(raw.archived);
  return result;
}

const numeric = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = clean(value).replace(/[−–—]/g,'-').replace(/([\d.])D([+-]?\d+)/i,'$1E$2');
  if (!normalized || /^(?:nan|inf|-inf|null|--?)$/i.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

function uniqueColumns(values) {
  const seen = new Map();
  return values.map((value,index) => {
    const base=clean(value).replace(/^['"]|['"]$/g,'') || `Column ${index+1}`;
    const count=(seen.get(base)||0)+1;seen.set(base,count);
    return count===1?base:`${base} (${count})`;
  });
}

export function inferMeasurementType(columns=[],filename='') {
  const text=`${filename} ${columns.join(' ')}`.toLocaleLowerCase();
  if(/heat|specific.?heat|cp\b|c\/t|比热/.test(text))return '比热';
  if(/magnet|moment|emu|m\/h|suscept|磁化|磁矩/.test(text))return '磁化/磁矩';
  if(/hall|霍尔|rxy|rho.?xy/.test(text))return '霍尔效应';
  if(/xrd|2theta|2.?theta|intensity|衍射/.test(text))return 'XRD/衍射';
  if(/raman|wavenumber|absorb|photolum|spectrum|光谱/.test(text))return '光谱';
  if(/current|voltage|\bi.?v\b|电流|电压/.test(text))return 'I–V曲线';
  if(/resist|rho\b|rxx|电阻|电输运/.test(text))return '电阻/电输运';
  return '自定义';
}

function axisScore(name,kind='x') {
  const text=String(name).toLocaleLowerCase();
  const xPatterns=[/temperature|temp|^t\b|温度/,/field|^h\b|magnetic|磁场/,/time|秒|minute|hour/,/angle|theta|角度/,/current|电流/,/voltage|电压/];
  const yPatterns=[/resist|rho|rxx|电阻/,/moment|magnet|emu|磁矩|磁化/,/heat|^cp|c\/t|比热/,/intensity|counts|强度/,/voltage|电压/,/current|电流/];
  return (kind==='x'?xPatterns:yPatterns).findIndex(pattern=>pattern.test(text));
}

export function normalizeMeasurementDataset(raw={}) {
  const columns=uniqueColumns(Array.isArray(raw.columns)?raw.columns:[]).slice(0,64);
  if(columns.length<2)return null;
  const rows=(Array.isArray(raw.rows)?raw.rows:[]).slice(0,250000).map(row=>columns.map((_,i)=>numeric(row?.[i]))).filter(row=>row.filter(Number.isFinite).length>=2);
  if(!rows.length)return null;
  const xColumn=columns.includes(raw.xColumn)?raw.xColumn:columns[0];
  const yColumn=columns.includes(raw.yColumn)&&raw.yColumn!==xColumn?raw.yColumn:(columns.find(c=>c!==xColumn)||columns[1]);
  const sampleMeta={};
  for(const key of ['massMg','lengthMm','widthMm','thicknessMm','molarMass','formulaUnits'])sampleMeta[key]=numeric(raw.sampleMeta?.[key]);
  const analyses=Array.isArray(raw.analyses)?raw.analyses.slice(0,100).map(item=>({
    id:clean(item.id)||uid('analysis'),type:ANALYSIS_TYPES.includes(item.type)?item.type:clean(item.type),version:Math.max(1,Number(item.version)||1),createdAt:clean(item.createdAt)||now(),xColumn:clean(item.xColumn),yColumn:clean(item.yColumn),window:item.window&&typeof item.window==='object'?{min:numeric(item.window.min),max:numeric(item.window.max)}:{min:null,max:null},parameters:item.parameters&&typeof item.parameters==='object'?item.parameters:{},formula:clean(item.formula),summary:clean(item.summary),metrics:item.metrics&&typeof item.metrics==='object'?item.metrics:{},fit:item.fit&&typeof item.fit==='object'?item.fit:null,steps:Array.isArray(item.steps)?item.steps.map(clean).filter(Boolean).slice(0,20):[]
  })).filter(item=>item.type):[];
  return {id:clean(raw.id)||uid('data'),name:clean(raw.name)||'未命名数据',type:MEASUREMENT_TYPES.includes(raw.type)?raw.type:inferMeasurementType(columns,raw.name),instrument:INSTRUMENT_TEMPLATES.includes(raw.instrument)?raw.instrument:'通用表格',columns,xColumn,yColumn,rows,rowCount:Number(raw.rowCount)||rows.length,sourceRows:Number(raw.sourceRows)||Number(raw.rowCount)||rows.length,sourceBytes:Number(raw.sourceBytes)||0,localRawOnly:Boolean(raw.localRawOnly),importedAt:clean(raw.importedAt)||now(),notes:clean(raw.notes),sampleMeta,analyses};
}

export function detectInstrument(text='',filename='',columns=[]) {
  const value=`${filename}\n${String(text).slice(0,12000)}\n${columns.join(' ')}`.toLocaleLowerCase();
  if(/mpms|dc moment|long moment|mvs[h|t]|squid/.test(value))return 'Quantum Design MPMS';
  if(/ppms|physical property measurement|resistivity|bridge [1-4] resistance/.test(value))return 'Quantum Design PPMS';
  if(/keithley|model 24\d\d|model 26\d\d|source.?measure|smu/.test(value))return 'Keithley';
  if(/\.xy\b|\.xrdml\b|2.?theta|2theta|diffraction|xrd/.test(value))return 'XRD';
  return '通用表格';
}

function splitMeasurementLine(line,delimiter){
  if(delimiter===',')return parseCsv(line)[0]||[];
  if(delimiter===';')return line.split(';').map(clean);
  if(delimiter==='\t')return line.split('\t').map(clean);
  return line.trim().split(/\s+/).map(clean);
}

export function parseMeasurementText(text,filename='measurement.txt') {
  const original=String(text).replace(/^\uFEFF/,'');
  const allLines=original.split(/\r?\n/).map(line=>line.trim());
  const dataMarker=allLines.findIndex(line=>/^\[data\]$/i.test(line));
  const lines=(dataMarker>=0?allLines.slice(dataMarker+1):allLines).filter(line=>line&&!/^(?:#|\/\/|;)/.test(line)&&!/^\[(?!data\])/i.test(line));
  if(lines.length<2)throw new Error('数据文件至少需要两行。');
  const sample=lines.slice(0,8).join('\n');
  const counts=[['\t',(sample.match(/\t/g)||[]).length],[',',(sample.match(/,/g)||[]).length],[';',(sample.match(/;/g)||[]).length]];
  const delimiter=counts.sort((a,b)=>b[1]-a[1])[0][1]>0?counts[0][0]:'whitespace';
  const rawRows=lines.map(line=>splitMeasurementLine(line,delimiter));
  const width=rawRows.reduce((maximum,row)=>Math.max(maximum,row.length),0);
  if(width<2)throw new Error('没有识别到至少两列数据。请使用逗号、制表符、分号或空格分隔。');
  const first=rawRows[0];
  const firstNumeric=first.filter(value=>numeric(value)!==null).length;
  const hasHeader=firstNumeric<Math.max(2,Math.ceil(first.length*.65));
  const columns=uniqueColumns(hasHeader?first:Array.from({length:width},(_,i)=>`Column ${i+1}`));
  const body=rawRows.slice(hasHeader?1:0);
  const rows=body.map(row=>columns.map((_,i)=>numeric(row[i]))).filter(row=>row.filter(Number.isFinite).length>=2);
  if(!rows.length)throw new Error('文件中没有可绘图的数值行。');
  if(rows.length>250000)throw new Error('单个文件最多导入 250,000 行；更大的原始文件请先按扫描段拆分。');
  const xRank=columns.map((name,index)=>({index,score:axisScore(name,'x')})).filter(x=>x.score>=0).sort((a,b)=>a.score-b.score)[0]?.index??0;
  const yRank=columns.map((name,index)=>({index,score:axisScore(name,'y')})).filter(x=>x.index!==xRank&&x.score>=0).sort((a,b)=>a.score-b.score)[0]?.index;
  const yIndex=yRank??columns.findIndex((_,i)=>i!==xRank);
  return normalizeMeasurementDataset({name:filename.replace(/\.[^.]+$/,''),type:inferMeasurementType(columns,filename),instrument:detectInstrument(original,filename,columns),columns,xColumn:columns[xRank],yColumn:columns[yIndex],rows,rowCount:rows.length,sourceRows:rows.length,sourceBytes:new TextEncoder().encode(original).byteLength});
}

function finitePairs(dataset,request={}) {
  const normalized=normalizeMeasurementDataset(dataset);if(!normalized)throw new Error('数据集为空。');
  const xColumn=request.xColumn||normalized.xColumn,yColumn=request.yColumn||normalized.yColumn;
  const xi=normalized.columns.indexOf(xColumn),yi=normalized.columns.indexOf(yColumn);
  if(xi<0||yi<0||xi===yi)throw new Error('请选择不同的 X/Y 数值列。');
  const min=numeric(request.xMin),max=numeric(request.xMax);
  const pairs=normalized.rows.map(row=>[row[xi],row[yi]]).filter(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)&&(min===null||x>=min)&&(max===null||x<=max));
  if(pairs.length<3)throw new Error('拟合窗口内至少需要 3 个有效数据点。');
  return {normalized,xColumn,yColumn,pairs,min,max};
}

export function linearRegression(pairs=[]) {
  const valid=pairs.filter(pair=>pair.length>=2&&pair.every(Number.isFinite));if(valid.length<2)throw new Error('线性拟合至少需要 2 个点。');
  const n=valid.length,sx=valid.reduce((s,p)=>s+p[0],0),sy=valid.reduce((s,p)=>s+p[1],0),sxx=valid.reduce((s,p)=>s+p[0]*p[0],0),sxy=valid.reduce((s,p)=>s+p[0]*p[1],0),den=n*sxx-sx*sx;
  if(Math.abs(den)<Number.EPSILON)throw new Error('X 数据没有足够变化，无法线性拟合。');
  const slope=(n*sxy-sx*sy)/den,intercept=(sy-slope*sx)/n,mean=sy/n;
  const ssTot=valid.reduce((s,p)=>s+(p[1]-mean)**2,0),ssRes=valid.reduce((s,p)=>s+(p[1]-(slope*p[0]+intercept))**2,0);
  return {slope,intercept,r2:ssTot?1-ssRes/ssTot:1,n};
}

const average=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const sci=value=>Number.isFinite(value)?Number(value.toPrecision(6)):null;
function crossing(sorted,threshold){
  for(let i=1;i<sorted.length;i++){const [x0,y0]=sorted[i-1],[x1,y1]=sorted[i];if((y0-threshold)*(y1-threshold)<=0&&y0!==y1)return x0+(threshold-y0)*(x1-x0)/(y1-y0);}
  return null;
}

export function analyzeDataset(dataset,request={}) {
  const {normalized,xColumn,yColumn,pairs,min,max}=finitePairs(dataset,request),type=ANALYSIS_TYPES.includes(request.type)?request.type:ANALYSIS_TYPES[0],sorted=[...pairs].sort((a,b)=>a[0]-b[0]);
  const base={id:uid('analysis'),type,version:(normalized.analyses.filter(item=>item.type===type).at(-1)?.version||0)+1,createdAt:now(),xColumn,yColumn,window:{min,max},parameters:{},formula:'',summary:'',metrics:{},fit:null,steps:[`从 ${normalized.name} 选择 ${xColumn} 为 X、${yColumn} 为 Y`,`保留拟合窗口内 ${pairs.length} 个有效点`]};
  if(type==='RRR'){
    const count=Math.max(1,Math.ceil(sorted.length*.1)),low=average(sorted.slice(0,count).map(p=>p[1])),high=average(sorted.slice(-count).map(p=>p[1])),rrr=high/low;
    if(!Number.isFinite(rrr)||low===0)throw new Error('低温电阻为零或无效，无法计算 RRR。');
    return {...base,formula:'RRR = ρ(T_high) / ρ(T_low)',summary:`RRR = ${sci(rrr)}；低温端与高温端分别取窗口内约 10% 数据平均。`,metrics:{rrr:sci(rrr),rhoLow:sci(low),rhoHigh:sci(high),points:pairs.length},steps:[...base.steps,'分别平均低温端和高温端 10% 数据，以降低单点噪声','计算高温端/低温端电阻比；请确认 Y 已换算为同一几何条件下的电阻率']};
  }
  if(type==='超导转变温度'){
    const count=Math.max(2,Math.ceil(sorted.length*.1)),residual=average(sorted.slice(0,count).map(p=>p[1])),normal=average(sorted.slice(-count).map(p=>p[1])),delta=normal-residual;
    if(Math.abs(delta)<Number.EPSILON)throw new Error('所选窗口内没有可识别的电阻转变。');
    const onset=crossing(sorted,residual+.9*delta),mid=crossing(sorted,residual+.5*delta),zero=crossing(sorted,residual+.1*delta);
    return {...base,formula:'Tc,onset / Tc,mid / Tc,10% 由归一化电阻 90% / 50% / 10% 阈值线性插值得到',summary:`Tc,onset = ${sci(onset)} K；Tc,mid = ${sci(mid)} K；Tc,10% = ${sci(zero)} K。`,metrics:{tcOnsetK:sci(onset),tcMidK:sci(mid),tc10K:sci(zero),normalResistance:sci(normal),residualResistance:sci(residual),points:pairs.length},steps:[...base.steps,'以低温端和高温端各 10% 数据估计剩余电阻与正常态电阻','在 90%、50%、10% 阈值附近做相邻点线性插值；结果依赖窗口和电流条件']};
  }
  if(type==='Curie–Weiss 拟合'){
    const transformed=pairs.filter(([,y])=>y!==0).map(([x,y])=>[x,1/y]),fit=linearRegression(transformed),C=1/fit.slope,theta=-fit.intercept/fit.slope,muEff=C>0?2.828*Math.sqrt(C):null;
    return {...base,formula:'1/χ = (T − θCW) / C；μeff = 2.828√C（仅当 χ 为 emu·mol⁻¹·Oe⁻¹）',summary:`θCW = ${sci(theta)} K，C = ${sci(C)}，R² = ${sci(fit.r2)}${muEff?`，条件满足时 μeff = ${sci(muEff)} μB`:''}。`,metrics:{thetaK:sci(theta),curieConstant:sci(C),muEffBohr:sci(muEff),r2:sci(fit.r2),points:fit.n},fit:{...fit,xTransform:'T',yTransform:'1/χ'},steps:[...base.steps,'将磁化率转换为 1/χ 后线性回归','由斜率与截距计算 C 和 θCW；μeff 只在摩尔磁化率单位正确时有效']};
  }
  if(type==='C/T–T² 拟合'){
    const transformed=pairs.filter(([t])=>t!==0).map(([t,c])=>[t*t,c/t]),fit=linearRegression(transformed),atoms=Math.max(1,numeric(request.atomsPerFormula)||1),betaJ=fit.slope/1000,thetaD=betaJ>0?(12*Math.PI**4*atoms*8.314462618/(5*betaJ))**(1/3):null;
    return {...base,parameters:{atomsPerFormula:atoms},formula:'C/T = γ + βT²；ΘD = [12π⁴nR/(5β)]^(1/3)',summary:`γ = ${sci(fit.intercept)}，β = ${sci(fit.slope)}，R² = ${sci(fit.r2)}${thetaD?`，按 β 的 mJ·mol⁻¹·K⁻⁴ 单位估算 ΘD = ${sci(thetaD)} K`:''}。`,metrics:{gamma:sci(fit.intercept),beta:sci(fit.slope),debyeK:sci(thetaD),r2:sci(fit.r2),points:fit.n},fit:{...fit,xTransform:'T²',yTransform:'C/T'},steps:[...base.steps,'逐点构造 T² 与 C/T','线性拟合得到电子比热系数 γ 和晶格项 β','Debye 温度计算假定 β 单位为 mJ·mol⁻¹·K⁻⁴，并使用用户填写的每化学式原子数']};
  }
  const fit=linearRegression(pairs),thicknessMm=numeric(request.thicknessMm),rhoXx=numeric(request.rhoXx),yIsResistance=Boolean(request.yIsResistance),hallCoefficient=yIsResistance&&thicknessMm?fit.slope*thicknessMm*1e-3:fit.slope,e=1.602176634e-19,carrier=hallCoefficient?1/(e*Math.abs(hallCoefficient)):null,mobility=rhoXx?Math.abs(hallCoefficient)/rhoXx:null;
  return {...base,parameters:{thicknessMm,rhoXx,yIsResistance},formula:yIsResistance?'RH = (dRxy/dB)·t；n = 1/(e|RH|)；μ = |RH|/ρxx':'RH = dρxy/dB；n = 1/(e|RH|)；μ = |RH|/ρxx',summary:`RH = ${sci(hallCoefficient)} m³/C，载流子浓度 |n| = ${sci(carrier)} m⁻³${mobility?`，迁移率 μ = ${sci(mobility)} m²·V⁻¹·s⁻¹`:''}，R² = ${sci(fit.r2)}。`,metrics:{hallCoefficient:sci(hallCoefficient),carrierDensityM3:sci(carrier),mobilityM2Vs:sci(mobility),r2:sci(fit.r2),points:fit.n},fit,steps:[...base.steps,'对霍尔信号随磁场进行线性拟合',yIsResistance?'按样品厚度把霍尔电阻斜率换算为霍尔系数':'假定 Y 已是霍尔电阻率',rhoXx?'使用输入的纵向电阻率计算迁移率':'未提供 ρxx，因此不计算迁移率']};
}

export function comparisonSeries(dataset,mode='none') {
  const normalized=normalizeMeasurementDataset(dataset);if(!normalized)return {points:[],factor:null,label:''};
  const xi=normalized.columns.indexOf(normalized.xColumn),yi=normalized.columns.indexOf(normalized.yColumn),meta=normalized.sampleMeta||{};let factor=1,label=normalized.yColumn;
  if(mode==='mass'){if(!(meta.massMg>0))return {points:[],factor:null,label:'缺少质量'};factor=1000/meta.massMg;label=`${normalized.yColumn} / g`;}
  if(mode==='geometry'){if(!(meta.lengthMm>0&&meta.widthMm>0&&meta.thicknessMm>0))return {points:[],factor:null,label:'缺少长宽厚'};factor=meta.widthMm*meta.thicknessMm/meta.lengthMm*1e-3;label='电阻率 (Ω·m)';}
  if(mode==='molar'){if(!(meta.massMg>0&&meta.molarMass>0))return {points:[],factor:null,label:'缺少质量/摩尔质量'};factor=meta.molarMass/(meta.massMg/1000);label=`${normalized.yColumn} / mol`;}
  return {points:normalized.rows.map(row=>[row[xi],row[yi]*factor]).filter(pair=>pair.every(Number.isFinite)),factor,label};
}

export function downsampleDataset(dataset,maxRows=5000) {
  const normalized=normalizeMeasurementDataset(dataset);if(!normalized||normalized.rows.length<=maxRows)return normalized;
  const rows=[];for(let i=0;i<maxRows;i++)rows.push(normalized.rows[Math.min(normalized.rows.length-1,Math.round(i*(normalized.rows.length-1)/(maxRows-1)))]);
  return {...normalized,rows,rowCount:rows.length,sourceRows:normalized.sourceRows||normalized.rows.length,localRawOnly:true};
}

export function measurementCsv(dataset) {
  const normalized=normalizeMeasurementDataset(dataset);if(!normalized)throw new Error('数据集为空。');
  const quote=value=>`"${String(value??'').replaceAll('"','""')}"`;
  return '\uFEFF'+[normalized.columns.map(quote).join(','),...normalized.rows.map(row=>row.map(value=>quote(value??'')).join(','))].join('\r\n');
}

export function normalizePaper(raw = {}, catalog = []) {
  const ref = catalog.find(p => p.id === raw.id || (raw.doi && p.doi?.toLowerCase() === String(raw.doi).toLowerCase())) || {};
  const p = { ...ref, ...raw };
  return {
    id: clean(p.id) || (p.doi ? `doi:${clean(p.doi).toLowerCase()}` : uid('paper')),
    title: clean(p.title) || '待补全文献信息', authors: clean(p.authors), journal: clean(p.journal), year: clean(p.year || p.published?.slice(0,4)), doi: clean(p.doi), url: clean(p.url || p.source || p.fullText), material: clean(p.material), group: clean(p.group || p.collection || '准备复现'), project: clean(p.project), notes: clean(p.notes), tags: Array.isArray(p.tags) ? p.tags.map(clean).filter(Boolean) : [], addedAt: clean(p.addedAt) || now(), updatedAt: clean(p.updatedAt) || now(), archived: Boolean(p.archived)
  };
}

export function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  const input = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  row.push(field); if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function experimentsCsv(records) {
  const keys = [...EXPERIMENT_COLUMNS, 'temperatureProgram'];
  const quote = value => `"${String(value ?? '').replaceAll('"','""')}"`;
  return '\uFEFF' + [keys.join(','), ...records.map(r => keys.map(key => quote(key === 'temperatureProgram' ? formatSchedule(r.schedule || []) : r[key])).join(','))].join('\r\n');
}

export function formatSchedule(stages) {
  return stages.map(s => `${s.label}|${s.hours}|${s.sourceC ?? ''}|${s.growthC ?? ''}`).join('\n');
}

export function parseSchedule(text) {
  if (!clean(text)) return [];
  return String(text).split(/\r?\n/).map((line, i) => {
    const [label, duration, source, growth] = line.split('|').map(clean);
    const hours = Number(duration);
    const sourceC = source === '' ? null : Number(source);
    const growthC = growth === '' ? null : Number(growth);
    if (!label || !Number.isFinite(hours) || hours <= 0 || (sourceC === null && growthC === null) || (sourceC !== null && !Number.isFinite(sourceC)) || (growthC !== null && !Number.isFinite(growthC))) throw new Error(`温度程序第 ${i + 1} 行格式有误。格式：阶段|小时|温区A°C|温区B°C`);
    return { label, hours, sourceC, growthC };
  });
}

export function temperatureSeries(stages) {
  let t = 0; const points = [{ t: 0, sourceC: stages[0]?.sourceC ?? null, growthC: stages[0]?.growthC ?? null, label: '开始' }];
  for (const stage of stages) { t += Number(stage.hours) || 0; points.push({ t, sourceC: stage.sourceC ?? null, growthC: stage.growthC ?? null, label: stage.label }); }
  return points;
}

export function parseImport(text, filename = '', catalog = []) {
  const result = { experiments: [], papers: [], projects: [], tasks: [], profile: null, kind: '' };
  if (/\.csv$/i.test(filename)) {
    const [head, ...rows] = parseCsv(text);
    if (!head?.includes('sampleId')) throw new Error('CSV 缺少 sampleId 列。');
    result.experiments = rows.map(row => { const raw = Object.fromEntries(head.map((h, i) => [h, row[i] ?? ''])); return normalizeExperiment({ ...raw, schedule: raw.temperatureProgram ? parseSchedule(raw.temperatureProgram) : [] }); });
    result.kind = '实验 CSV'; return result;
  }
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('文件不是有效的 JSON 或 CSV。'); }
  if (Array.isArray(data)) { result.experiments = data.map(normalizeExperiment); result.kind = '旧版实验 JSON'; return result; }
  if (!data || typeof data !== 'object') throw new Error('不支持的文件结构。');
  if (data.format === 'yanxi-workbench' && data.vault) {
    for (const key of ['experiments','papers','projects','tasks']) result[key] = Array.isArray(data.vault[key]) ? data.vault[key].map(item => key === 'experiments' ? normalizeExperiment(item) : key === 'papers' ? normalizePaper(item, catalog) : item) : [];
    result.profile = data.vault.profile || null; result.kind = '研析完整备份'; return result;
  }
  if (data.format === 'daily-literature-research-export' || 'favorites' in data || 'collections' in data || 'preferences' in data) {
    result.experiments = Array.isArray(data.experiments) ? data.experiments.map(normalizeExperiment) : [];
    result.profile = data.preferences ? { ...data.preferences, updatedAt: data.preferences.updatedAt || now() } : null;
    const favorites = Array.isArray(data.favorites) ? data.favorites : [];
    const detail = Array.isArray(data.papers) ? data.papers : [];
    result.papers = favorites.map(f => { const id = typeof f === 'string' ? f : f.id; const info = detail.find(p => p.id === id) || (typeof f === 'object' ? f : { id }); return normalizePaper({ ...info, id, group: data.collections?.[id] || info.group }, catalog); });
    result.kind = '原网站研究面板'; return result;
  }
  throw new Error('不支持的文件结构。请选择旧研究面板导出文件或本平台备份。');
}

function mergeItems(current = [], incoming = []) {
  const items = new Map(current.map(x => [x.id, x]));
  for (const next of incoming) {
    const previous = items.get(next.id);
    if (!previous || (next.updatedAt || '') >= (previous.updatedAt || '')) items.set(next.id, next);
  }
  return [...items.values()];
}

export function mergeVault(current, imported) {
  const result = structuredClone(current);
  for (const key of ['experiments','papers','projects','tasks']) result[key] = mergeItems(result[key], imported[key] || []);
  if (imported.profile && (!result.profile || (imported.profile.updatedAt || '') >= (result.profile.updatedAt || ''))) {
    result.profile = { ...result.profile, ...imported.profile };
    for (const key of PROFILE_KEYS) result.profile[key] = Array.isArray(result.profile[key]) ? result.profile[key] : [];
  }
  return result;
}

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export const newId = uid;
