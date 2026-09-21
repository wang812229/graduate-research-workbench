export const PROFILE_KEYS = ['materials','methods','measurements','journals','authors'];
export const PAPER_GROUPS = ['准备复现','实验方法参考','生长方法参考','待组会汇报','与当前结果冲突','需要获取全文','需要补看SI'];
export const MEASUREMENT_TYPES = ['电阻/电输运','磁化/磁矩','比热','霍尔效应','I–V曲线','XRD/衍射','光谱','自定义'];
export const ANALYSIS_TYPES = ['RRR','超导转变温度','Curie–Weiss 拟合','C/T–T² 拟合','Debye–Einstein 联合拟合','霍尔系数与迁移率','双载流子霍尔模型','低温电阻 ρ₀+AT²','弱局域化/Kondo 对数拟合','磁滞回线参数','超导屏蔽体积分数','ZFC/FC 分叉温度','比热跃变 ΔC/γTc','Bloch–Grüneisen 拟合'];
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
    id:clean(item.id)||uid('analysis'),type:ANALYSIS_TYPES.includes(item.type)?item.type:clean(item.type),version:Math.max(1,Number(item.version)||1),createdAt:clean(item.createdAt)||now(),xColumn:clean(item.xColumn),yColumn:clean(item.yColumn),errorColumn:clean(item.errorColumn),referenceColumn:clean(item.referenceColumn),qualityColumn:clean(item.qualityColumn),window:item.window&&typeof item.window==='object'?{min:numeric(item.window.min),max:numeric(item.window.max)}:{min:null,max:null},parameters:item.parameters&&typeof item.parameters==='object'?item.parameters:{},formula:clean(item.formula),method:clean(item.method),assumptions:Array.isArray(item.assumptions)?item.assumptions.map(clean).filter(Boolean).slice(0,20):[],summary:clean(item.summary),metrics:item.metrics&&typeof item.metrics==='object'?item.metrics:{},fit:item.fit&&typeof item.fit==='object'?item.fit:null,quality:item.quality&&typeof item.quality==='object'?item.quality:{},exclusionRules:Array.isArray(item.exclusionRules)?item.exclusionRules.map(clean).filter(Boolean).slice(0,20):[],steps:Array.isArray(item.steps)?item.steps.map(clean).filter(Boolean).slice(0,20):[]
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
  const errorColumn=normalized.columns.includes(request.errorColumn)?request.errorColumn:'',ei=normalized.columns.indexOf(errorColumn),qualityColumn=normalized.columns.includes(request.qualityColumn)?request.qualityColumn:'',qi=normalized.columns.indexOf(qualityColumn),min=numeric(request.xMin),max=numeric(request.xMax);
  const allPairs=normalized.rows.map((row,index)=>[row[xi],row[yi],index,ei>=0?row[ei]:null]).filter(([x,y])=>Number.isFinite(x)&&Number.isFinite(y));
  const pairs=allPairs.filter(([x])=>(min===null||x>=min)&&(max===null||x<=max));
  if(pairs.length<3)throw new Error('拟合窗口内至少需要 3 个有效数据点。');
  const seen=new Set();let duplicates=0,reversals=0,lastDirection=0,rangeSwitches=0,lastQuality=null;for(let i=0;i<allPairs.length;i++){const x=allPairs[i][0],key=String(x);if(seen.has(key))duplicates++;else seen.add(key);if(i){const direction=Math.sign(x-allPairs[i-1][0]);if(direction&&lastDirection&&direction!==lastDirection)reversals++;if(direction)lastDirection=direction;}if(qi>=0){const q=normalized.rows[allPairs[i][2]]?.[qi];if(Number.isFinite(q)&&lastQuality!==null&&q!==lastQuality)rangeSwitches++;if(Number.isFinite(q))lastQuality=q;}}
  return {normalized,xColumn,yColumn,errorColumn,qualityColumn,pairs,allPairs,min,max,quality:{validPoints:allPairs.length,includedPoints:pairs.length,excludedByWindow:allPairs.length-pairs.length,duplicateX:duplicates,directionReversals:reversals,missingSelected:normalized.rows.length-allPairs.length,rangeSwitches}};
}

export function linearRegression(pairs=[]) {
  const valid=pairs.filter(pair=>pair.length>=2&&Number.isFinite(pair[0])&&Number.isFinite(pair[1]));if(valid.length<2)throw new Error('线性拟合至少需要 2 个点。');
  const n=valid.length,sx=valid.reduce((s,p)=>s+p[0],0),sy=valid.reduce((s,p)=>s+p[1],0),sxx=valid.reduce((s,p)=>s+p[0]*p[0],0),sxy=valid.reduce((s,p)=>s+p[0]*p[1],0),den=n*sxx-sx*sx;
  if(Math.abs(den)<Number.EPSILON)throw new Error('X 数据没有足够变化，无法线性拟合。');
  const slope=(n*sxy-sx*sy)/den,intercept=(sy-slope*sx)/n,mean=sy/n;
  const ssTot=valid.reduce((s,p)=>s+(p[1]-mean)**2,0),ssRes=valid.reduce((s,p)=>s+(p[1]-(slope*p[0]+intercept))**2,0),dof=Math.max(1,n-2),variance=ssRes/dof,rmse=Math.sqrt(ssRes/n),slopeStdError=Math.sqrt(variance*n/den),interceptStdError=Math.sqrt(variance*sxx/den),critical=n<=3?12.706:n<=5?2.776:n<=10?2.262:n<=20?2.093:n<=30?2.045:1.96;
  return {slope,intercept,r2:ssTot?1-ssRes/ssTot:1,n,rmse,slopeStdError,interceptStdError,slopeCI95:[slope-critical*slopeStdError,slope+critical*slopeStdError],interceptCI95:[intercept-critical*interceptStdError,intercept+critical*interceptStdError]};
}

const average=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const sci=value=>Number.isFinite(value)?Number(value.toPrecision(6)):null;
function crossing(sorted,threshold){
  for(let i=1;i<sorted.length;i++){const [x0,y0]=sorted[i-1],[x1,y1]=sorted[i];if((y0-threshold)*(y1-threshold)<=0&&y0!==y1)return x0+(threshold-y0)*(x1-x0)/(y1-y0);}
  return null;
}

function fitDiagnostics(fit,pairs,sigmaLimit=3){
  const residuals=pairs.map(([x,y])=>y-(fit.slope*x+fit.intercept)),sigma=Math.sqrt(residuals.reduce((sum,value)=>sum+value*value,0)/Math.max(1,residuals.length-2)),outlierIndexes=[];
  residuals.forEach((value,index)=>{if(sigma>0&&Math.abs(value)>sigmaLimit*sigma)outlierIndexes.push(pairs[index][2]??index);});
  return {residualSigma:sci(sigma),residualOutliers:outlierIndexes.length,outlierIndexes,sigmaLimit};
}
function interpolateAtX(pairs,target){for(let i=1;i<pairs.length;i++){const [x0,y0]=pairs[i-1],[x1,y1]=pairs[i];if((x0-target)*(x1-target)<=0&&x0!==x1)return y0+(target-x0)*(y1-y0)/(x1-x0);}return null;}
function bgIntegral(z){const upper=Math.min(60,Math.max(0,z)),steps=60,h=upper/steps;let sum=0;for(let i=0;i<=steps;i++){const x=i*h,exp=Math.exp(Math.min(60,x)),den=(exp-1)*(1-Math.exp(-x)),f=x===0?0:x**5/(den||Infinity),weight=i===0||i===steps?1:i%2?4:2;sum+=weight*f;}return sum*h/3;}
function bgShape(t,theta){return t>0&&theta>0?(t/theta)**5*bgIntegral(theta/t):0;}
function fitBlochGruneisen(pairs,initial){
  const sampled=pairs.filter((_,i)=>i%Math.max(1,Math.ceil(pairs.length/350))===0),temps=sampled.map(p=>p[0]).filter(t=>t>0),low=Math.max(5,Math.min(...temps)*1.2),high=Math.max(low*1.5,Math.max(...temps)*8);let center=numeric(initial)||Math.sqrt(low*high),span=Math.log(high/low)/2,best=null;
  for(let round=0;round<4;round++){for(let i=-12;i<=12;i++){const theta=Math.exp(Math.log(center)+span*i/12);try{const transformed=sampled.filter(([t])=>t>0).map(([t,y,index])=>[bgShape(t,theta),y,index]),fit=linearRegression(transformed);if(!best||fit.rmse<best.fit.rmse)best={theta,fit,transformed};}catch{}}center=best.theta;span*=.35;}
  return best;
}
function debyeIntegral(z){const upper=Math.min(60,Math.max(0,z)),steps=48,h=upper/steps;let sum=0;for(let i=0;i<=steps;i++){const x=i*h,exp=Math.exp(Math.min(60,x)),den=(exp-1)**2,f=x===0?0:x**4*exp/(den||Infinity),weight=i===0||i===steps?1:i%2?4:2;sum+=weight*f;}return sum*h/3;}
function debyeEinsteinModel(t,[gamma,thetaD,thetaE,fraction],atoms=1){if(!(t>0))return 0;const R=8.314462618,zd=thetaD/t,ze=Math.min(60,thetaE/t),debye=9*atoms*R*(t/thetaD)**3*debyeIntegral(zd),exp=Math.exp(ze),einstein=3*atoms*R*ze**2*exp/(exp-1)**2;return gamma*t+fraction*debye+(1-fraction)*einstein;}
function twoBandHallModel(field,[logNe,logNh,logMue,logMuh]){const e=1.602176634e-19,ne=10**logNe,nh=10**logNh,mue=10**logMue,muh=10**logMuh,numerator=(nh*muh**2-ne*mue**2)+(nh-ne)*(muh*mue*field)**2,denominator=e*((nh*muh+ne*mue)**2+((nh-ne)*muh*mue*field)**2);return field*numerator/denominator;}
function coordinateFit(pairs,initial,steps,bounds,model,iterations=110){
  const sampled=pairs.filter((_,i)=>i%Math.max(1,Math.ceil(pairs.length/100))===0),mean=average(sampled.map(p=>p[1])),score=params=>sampled.reduce((sum,[x,y])=>{const predicted=model(x,params),residual=y-predicted;return sum+residual*residual;},0),params=[...initial],delta=[...steps];let best=score(params);
  for(let iteration=0;iteration<iterations;iteration++){let improved=false;for(let j=0;j<params.length;j++){for(const direction of [-1,1]){const candidate=[...params];candidate[j]=Math.min(bounds[j][1],Math.max(bounds[j][0],candidate[j]+direction*delta[j]));const value=score(candidate);if(value<best){params.splice(0,params.length,...candidate);best=value;improved=true;}}}if(!improved)for(let j=0;j<delta.length;j++)delta[j]*=.72;}
  const ssTot=sampled.reduce((sum,p)=>sum+(p[1]-mean)**2,0);return {params,rmse:Math.sqrt(best/sampled.length),r2:ssTot?1-best/ssTot:1,n:sampled.length};
}
function nonlinearDiagnostics(pairs,model,params,sigmaLimit=3){const residuals=pairs.map(([x,y])=>y-model(x,params)),sigma=Math.sqrt(residuals.reduce((sum,value)=>sum+value*value,0)/Math.max(1,residuals.length-params.length)),outlierIndexes=[];residuals.forEach((value,index)=>{if(sigma>0&&Math.abs(value)>sigmaLimit*sigma)outlierIndexes.push(pairs[index][2]??index);});return {residualSigma:sci(sigma),residualOutliers:outlierIndexes.length,outlierIndexes,sigmaLimit};}

export function analyzeDataset(dataset,request={}) {
  const {normalized,xColumn,yColumn,errorColumn,qualityColumn,pairs,allPairs,min,max,quality}=finitePairs(dataset,request),type=ANALYSIS_TYPES.includes(request.type)?request.type:ANALYSIS_TYPES[0],sorted=[...pairs].sort((a,b)=>a[0]-b[0]),sigmaLimit=Math.max(1,numeric(request.outlierSigma)||3),referenceColumn=normalized.columns.includes(request.referenceColumn)?request.referenceColumn:'';
  const base={id:uid('analysis'),type,version:(normalized.analyses.filter(item=>item.type===type).at(-1)?.version||0)+1,createdAt:now(),xColumn,yColumn,errorColumn,referenceColumn,qualityColumn,window:{min,max},parameters:{},formula:'',method:'',assumptions:[],summary:'',metrics:{},fit:null,quality,exclusionRules:[...(min!==null||max!==null?[`仅纳入 ${xColumn} 位于 ${min??'−∞'} 至 ${max??'+∞'} 的数据点`]:[]),`残差超过 ${sigmaLimit}σ 的点只标记为异常，不从原始数据删除`],steps:[`从 ${normalized.name} 选择 ${xColumn} 为 X、${yColumn} 为 Y`,`窗口内纳入 ${pairs.length} 个点，窗口外保留 ${allPairs.length-pairs.length} 个原始点`]};
  const linearResult=(transformed,fit,extra={})=>({...base,...extra,fit:{...fit},quality:{...quality,...fitDiagnostics(fit,transformed,sigmaLimit)}});
  if(type==='RRR'){
    const count=Math.max(1,Math.ceil(sorted.length*.1)),low=average(sorted.slice(0,count).map(p=>p[1])),high=average(sorted.slice(-count).map(p=>p[1])),rrr=high/low;
    if(!Number.isFinite(rrr)||low===0)throw new Error('低温电阻为零或无效，无法计算 RRR。');
    return {...base,method:'窗口两端稳健平均比值',formula:'RRR = ρ(T_high) / ρ(T_low)',assumptions:['高低温数据来自相同接线和几何因子','窗口两端各 10% 数据代表稳定平台'],summary:`RRR = ${sci(rrr)}；低温端与高温端分别取窗口内约 10% 数据平均。`,metrics:{rrr:sci(rrr),rhoLow:sci(low),rhoHigh:sci(high),points:pairs.length},steps:[...base.steps,'分别平均低温端和高温端 10% 数据，以降低单点噪声','计算高温端/低温端电阻比；请确认 Y 已换算为同一几何条件下的电阻率']};
  }
  if(type==='超导转变温度'){
    const count=Math.max(2,Math.ceil(sorted.length*.1)),residual=average(sorted.slice(0,count).map(p=>p[1])),normal=average(sorted.slice(-count).map(p=>p[1])),delta=normal-residual;
    if(Math.abs(delta)<Number.EPSILON)throw new Error('所选窗口内没有可识别的电阻转变。');
    const onset=crossing(sorted,residual+.9*delta),mid=crossing(sorted,residual+.5*delta),zero=crossing(sorted,residual+.1*delta),derivatives=sorted.slice(1).map((point,index)=>[(point[0]+sorted[index][0])/2,(point[1]-sorted[index][1])/(point[0]-sorted[index][0])]).filter(p=>p.every(Number.isFinite)),peak=derivatives.reduce((best,p)=>Math.abs(p[1])>Math.abs(best?.[1]??-Infinity)?p:best,null),width=onset!==null&&zero!==null?Math.abs(onset-zero):null;
    return {...base,method:'归一化电阻阈值 + 数值微分峰',formula:'Tc,90% / Tc,50% / Tc,10% 由阈值插值；ΔTc = |Tc,90%−Tc,10%|；Tc,dR/dT = argmax|dR/dT|',assumptions:['窗口高温端代表正常态、低温端代表剩余电阻平台','数据点顺序不用于判定，按温度排序后计算'],summary:`Tc,onset = ${sci(onset)} K；Tc,mid = ${sci(mid)} K；Tc,10% = ${sci(zero)} K；ΔTc = ${sci(width)} K；dR/dT 峰位于 ${sci(peak?.[0])} K。`,metrics:{tcOnsetK:sci(onset),tcMidK:sci(mid),tc10K:sci(zero),transitionWidthK:sci(width),derivativePeakK:sci(peak?.[0]),derivativePeak:sci(peak?.[1]),normalResistance:sci(normal),residualResistance:sci(residual),points:pairs.length},steps:[...base.steps,'以低温端和高温端各 10% 数据估计剩余电阻与正常态电阻','在 90%、50%、10% 阈值附近线性插值','用相邻点差分寻找 |dR/dT| 峰；原始数据噪声会放大微分误差']};
  }
  if(type==='Curie–Weiss 拟合'){
    const transformed=pairs.filter(([,y])=>y!==0).map(([x,y,index])=>[x,1/y,index]),fit=linearRegression(transformed),C=1/fit.slope,theta=-fit.intercept/fit.slope,muEff=C>0?2.828*Math.sqrt(C):null;
    return linearResult(transformed,{...fit,xTransform:'T',yTransform:'1/χ'},{method:'普通最小二乘线性回归（1/χ–T）',formula:'1/χ = (T − θCW) / C；μeff = 2.828√C',assumptions:['χ 已扣除与温度无关背景','μeff 公式要求 χ 单位为 emu·mol⁻¹·Oe⁻¹'],summary:`θCW = ${sci(theta)} K，C = ${sci(C)}，R² = ${sci(fit.r2)}${muEff?`，条件满足时 μeff = ${sci(muEff)} μB`:''}。`,metrics:{thetaK:sci(theta),curieConstant:sci(C),muEffBohr:sci(muEff),r2:sci(fit.r2),points:fit.n},steps:[...base.steps,'将磁化率转换为 1/χ 后线性回归','由斜率与截距计算 C 和 θCW；置信区间来自回归标准误差']});
  }
  if(type==='C/T–T² 拟合'){
    const transformed=pairs.filter(([t])=>t!==0).map(([t,c,index])=>[t*t,c/t,index]),fit=linearRegression(transformed),atoms=Math.max(1,numeric(request.atomsPerFormula)||1),betaJ=fit.slope/1000,thetaD=betaJ>0?(12*Math.PI**4*atoms*8.314462618/(5*betaJ))**(1/3):null;
    return linearResult(transformed,{...fit,xTransform:'T²',yTransform:'C/T'},{parameters:{atomsPerFormula:atoms},method:'普通最小二乘线性回归（C/T–T²）',formula:'C/T = γ + βT²；ΘD = [12π⁴nR/(5β)]^(1/3)',assumptions:['低温区只有电子 γT 与 Debye βT³ 项','C 使用 mJ·mol⁻¹·K⁻¹时才能按此式给出 ΘD'],summary:`γ = ${sci(fit.intercept)}，β = ${sci(fit.slope)}，R² = ${sci(fit.r2)}${thetaD?`，估算 ΘD = ${sci(thetaD)} K`:''}。`,metrics:{gamma:sci(fit.intercept),beta:sci(fit.slope),debyeK:sci(thetaD),r2:sci(fit.r2),points:fit.n},steps:[...base.steps,'逐点构造 T² 与 C/T','线性拟合得到 γ 和 β，并计算回归置信区间','按每化学式原子数与 β 估算 Debye 温度']});
  }
  if(type==='Debye–Einstein 联合拟合'){
    const positive=pairs.filter(([t])=>t>0),atoms=Math.max(1,numeric(request.atomsPerFormula)||1),minT=positive.reduce((smallest,p)=>Math.min(smallest,p[0]),Infinity),maxY=positive.reduce((largest,p)=>Math.max(largest,Math.abs(p[1])),1),gamma0=Math.max(0,numeric(request.gammaInitial)??numeric(request.gamma)??maxY/Math.max(minT,1)*.01),initial=[gamma0,numeric(request.thetaDInitial)||300,numeric(request.thetaEInitial)||120,Math.min(1,Math.max(0,numeric(request.debyeFraction)??.7))],fit=coordinateFit(positive,initial,[Math.max(.001,gamma0*.5),100,60,.2],[[0,Math.max(1,maxY/Math.max(minT,.1))],[5,2000],[5,2000],[0,1]],(t,params)=>debyeEinsteinModel(t,params,atoms),90),[gammaFit,thetaD,thetaE,fraction]=fit.params;
    return {...base,quality:{...quality,...nonlinearDiagnostics(positive,(t,params)=>debyeEinsteinModel(t,params,atoms),fit.params,sigmaLimit)},parameters:{atomsPerFormula:atoms,gammaInitial:gamma0,thetaDInitial:initial[1],thetaEInitial:initial[2],debyeFractionInitial:initial[3]},method:'有界坐标下降非线性最小二乘（最多 100 个等距采样点）',formula:'C=γT+f·9nR(T/ΘD)³∫₀^(ΘD/T)x⁴eˣ/(eˣ−1)²dx+(1−f)·3nR(ΘE/T)²e^(ΘE/T)/(e^(ΘE/T)−1)²',assumptions:['C 的单位为 J·mol⁻¹·K⁻¹，n 为每化学式原子数','单一 Debye 温度与单一 Einstein 温度足以描述晶格项','非线性结果依赖初值，应改变初值和窗口检查稳定性'],summary:`γ = ${sci(gammaFit)}，ΘD = ${sci(thetaD)} K，ΘE = ${sci(thetaE)} K，Debye 权重 f = ${sci(fraction)}，R² = ${sci(fit.r2)}。`,metrics:{gamma:sci(gammaFit),thetaD:sci(thetaD),thetaE:sci(thetaE),debyeFraction:sci(fraction),r2:sci(fit.r2),rmse:sci(fit.rmse),points:fit.n},fit:{model:'Debye–Einstein',parameters:{gamma:gammaFit,thetaD,thetaE,debyeFraction:fraction,atoms},r2:fit.r2,rmse:fit.rmse,n:fit.n,xTransform:'T',yTransform:'C'},steps:[...base.steps,'按用户初值建立 γ、ΘD、ΘE 和 Debye 权重','有界坐标下降最小化 C(T) 残差平方和','结果是局部最优解，必须用不同初值复核']};
  }
  if(type==='霍尔系数与迁移率'){
    const fit=linearRegression(pairs),thicknessMm=numeric(request.thicknessMm),rhoXx=numeric(request.rhoXx),yIsResistance=Boolean(request.yIsResistance),hallCoefficient=yIsResistance&&thicknessMm?fit.slope*thicknessMm*1e-3:fit.slope,e=1.602176634e-19,carrier=hallCoefficient?1/(e*Math.abs(hallCoefficient)):null,mobility=rhoXx?Math.abs(hallCoefficient)/rhoXx:null;
    return linearResult(pairs,{...fit,xTransform:xColumn,yTransform:yColumn},{parameters:{thicknessMm,rhoXx,yIsResistance},method:'霍尔信号对磁场的普通最小二乘线性回归',formula:yIsResistance?'RH = (dRxy/dB)·t；n = 1/(e|RH|)；μ = |RH|/ρxx':'RH = dρxy/dB；n = 1/(e|RH|)；μ = |RH|/ρxx',assumptions:['单一主导载流子、所选磁场区间近似线性','ρxy 已反对称化；若输入 Rxy 则厚度准确'],summary:`RH = ${sci(hallCoefficient)} m³/C，|n| = ${sci(carrier)} m⁻³${mobility?`，μ = ${sci(mobility)} m²·V⁻¹·s⁻¹`:''}，R² = ${sci(fit.r2)}。`,metrics:{hallCoefficient:sci(hallCoefficient),carrierDensityM3:sci(carrier),mobilityM2Vs:sci(mobility),r2:sci(fit.r2),points:fit.n},steps:[...base.steps,'对霍尔信号随磁场线性回归并计算标准误差',yIsResistance?'按厚度把 Rxy 斜率换算为 RH':'假定 Y 已为 ρxy',rhoXx?'用输入的 ρxx 计算迁移率':'未提供 ρxx，不计算迁移率']});
  }
  if(type==='双载流子霍尔模型'){
    const initial=[Math.log10(numeric(request.electronDensityInitial)||1e26),Math.log10(numeric(request.holeDensityInitial)||2e26),Math.log10(numeric(request.electronMobilityInitial)||.01),Math.log10(numeric(request.holeMobilityInitial)||.02)],fit=coordinateFit(pairs,initial,[1,1,.7,.7],[[18,30],[18,30],[-6,2],[-6,2]],twoBandHallModel,140),[logNe,logNh,logMue,logMuh]=fit.params,ne=10**logNe,nh=10**logNh,mue=10**logMue,muh=10**logMuh;
    return {...base,quality:{...quality,...nonlinearDiagnostics(pairs,twoBandHallModel,fit.params,sigmaLimit)},parameters:{electronDensityInitial:10**initial[0],holeDensityInitial:10**initial[1],electronMobilityInitial:10**initial[2],holeMobilityInitial:10**initial[3]},method:'四参数有界坐标下降非线性最小二乘（对数参数空间）',formula:'ρxy(B)=B/e·[(nhμh²−neμe²)+(nh−ne)(μhμeB)²]/[(nhμh+neμe)²+((nh−ne)μhμeB)²]',assumptions:['Y 是 SI 单位 Ω·m 的反对称化霍尔电阻率','两个独立载流子带、迁移率在拟合磁场区间恒定','四参数强相关，必须结合 ρxx(B) 或其他约束验证唯一性'],summary:`ne = ${sci(ne)} m⁻³，nh = ${sci(nh)} m⁻³，μe = ${sci(mue)} m²/Vs，μh = ${sci(muh)} m²/Vs，R² = ${sci(fit.r2)}。`,metrics:{electronDensityM3:sci(ne),holeDensityM3:sci(nh),electronMobilityM2Vs:sci(mue),holeMobilityM2Vs:sci(muh),r2:sci(fit.r2),rmse:sci(fit.rmse),points:fit.n},fit:{model:'two-band-hall',parameters:{ne,nh,mue,muh},r2:fit.r2,rmse:fit.rmse,n:fit.n,xTransform:'B',yTransform:'ρxy'},steps:[...base.steps,'在 log10(ne)、log10(nh)、log10(μe)、log10(μh) 空间设置物理边界','用有界坐标下降最小化 ρxy 残差','四参数可能存在多组近似解，必须改变初值并与纵向电导联合检查']};
  }
  if(type==='低温电阻 ρ₀+AT²'){
    const transformed=pairs.map(([t,r,index])=>[t*t,r,index]),fit=linearRegression(transformed);
    return linearResult(transformed,{...fit,xTransform:'T²',yTransform:'ρ'},{method:'普通最小二乘线性回归（ρ–T²）',formula:'ρ(T) = ρ₀ + AT²',assumptions:['所选温区处于费米液体 T² 区间','几何因子和接触状态不随温度变化'],summary:`ρ₀ = ${sci(fit.intercept)}，A = ${sci(fit.slope)}，R² = ${sci(fit.r2)}。`,metrics:{rho0:sci(fit.intercept),A:sci(fit.slope),r2:sci(fit.r2),points:fit.n},steps:[...base.steps,'把温度平方后拟合 ρ–T²','截距作为 ρ₀、斜率作为 A；应通过改变窗口检查稳定性']});
  }
  if(type==='弱局域化/Kondo 对数拟合'){
    const transformed=pairs.filter(([t])=>t>0).map(([t,r,index])=>[Math.log(t),r,index]),fit=linearRegression(transformed);
    return linearResult(transformed,{...fit,xTransform:'ln T',yTransform:'ρ'},{method:'普通最小二乘线性回归（ρ–lnT）',formula:'ρ(T) = ρ₀ + B ln(T/T₀)',assumptions:['对数项只用于识别经验标度，不能单独区分 Kondo 与弱局域化','T 必须为正且所选区间没有结构或磁相变'],summary:`ρ₀（取 T₀=1 K）= ${sci(fit.intercept)}，B = ${sci(fit.slope)}，R² = ${sci(fit.r2)}。`,metrics:{rho0At1K:sci(fit.intercept),logCoefficient:sci(fit.slope),r2:sci(fit.r2),points:fit.n},steps:[...base.steps,'构造 ln(T) 后线性拟合','对数行为本身不是唯一机制证据，需结合磁场依赖和尺度分析']});
  }
  if(type==='Bloch–Grüneisen 拟合'){
    const result=fitBlochGruneisen(pairs,request.thetaDInitial);if(!result)throw new Error('Bloch–Grüneisen 拟合失败。');const {theta,fit,transformed}=result;
    return linearResult(transformed,{...fit,xTransform:`BG(T, ΘR=${sci(theta)} K)`,yTransform:'ρ',model:'Bloch–Grüneisen',thetaR:theta},{parameters:{thetaDInitial:numeric(request.thetaDInitial)},method:'ΘR 对数网格搜索 + 给定 ΘR 下的线性最小二乘',formula:'ρ(T)=ρ₀+A(T/ΘR)⁵∫₀^(ΘR/T) x⁵/[(eˣ−1)(1−e⁻ˣ)]dx',assumptions:['电阻主要来自单一 Debye 声子谱和温度无关剩余项','积分使用 Simpson 数值积分，ΘR 通过多轮网格细化'],summary:`ρ₀ = ${sci(fit.intercept)}，A = ${sci(fit.slope)}，ΘR = ${sci(theta)} K，R² = ${sci(fit.r2)}。`,metrics:{rho0:sci(fit.intercept),A:sci(fit.slope),thetaR:sci(theta),r2:sci(fit.r2),points:fit.n},steps:[...base.steps,'对 ΘR 进行四轮对数网格搜索','每个候选 ΘR 数值计算 Bloch–Grüneisen 积分并线性求 ρ₀、A','选择 RMSE 最小结果；需与替代散射模型比较']});
  }
  if(type==='磁滞回线参数'){
    const sequence=pairs,zeroM=[],zeroH=[];for(let i=1;i<sequence.length;i++){const a=sequence[i-1],b=sequence[i];if(a[1]*b[1]<=0&&a[1]!==b[1])zeroM.push(a[0]+(0-a[1])*(b[0]-a[0])/(b[1]-a[1]));if(a[0]*b[0]<=0&&a[0]!==b[0])zeroH.push(a[1]+(0-a[0])*(b[1]-a[1])/(b[0]-a[0]));}const top=[...sequence].sort((a,b)=>Math.abs(b[0])-Math.abs(a[0])).slice(0,Math.max(2,Math.ceil(sequence.length*.1))),ms=average(top.map(p=>Math.abs(p[1]))),hc=zeroM.length?average(zeroM.map(Math.abs)):null,mr=zeroH.length?average(zeroH.map(Math.abs)):null;
    return {...base,method:'相邻点过零线性插值 + 高场端平均',formula:'Hc = mean(|H at M=0|)；Mr = mean(|M at H=0|)；Ms ≈ mean(|M| at top 10% |H|)',assumptions:['数据按实际扫场顺序保存','最高场已足够接近饱和；未做顺磁背景扣除'],summary:`Hc = ${sci(hc)}，Mr = ${sci(mr)}，高场 Ms 估计 = ${sci(ms)}；识别 ${zeroM.length} 个 M=0 交点。`,metrics:{coerciveField:sci(hc),remanence:sci(mr),saturationEstimate:sci(ms),magnetizationCrossings:zeroM.length,fieldCrossings:zeroH.length},steps:[...base.steps,'保持原始扫场顺序寻找 M=0 和 H=0 交点','对交点做线性插值，高场 |H| 最大的 10% 点估计 Ms']};
  }
  if(type==='超导屏蔽体积分数'){
    const count=Math.max(2,Math.ceil(sorted.length*.1)),chi=average(sorted.slice(0,count).map(p=>p[1])),demag=Math.min(.99,Math.max(0,numeric(request.demagFactor)||0)),corrected=chi/(1-demag*chi),fraction=-4*Math.PI*corrected*100;
    return {...base,parameters:{demagFactor:demag},method:'低温端磁化率平均与可选退磁修正',formula:'χint = χmeas/(1−Nχmeas)；shielding = −4πχint×100%（cgs 体磁化率）',assumptions:['Y 已是无量纲 cgs 体磁化率 M/H','已扣除样品托与正常态背景；退磁因子 N 的定义与公式一致'],summary:`低温 χ = ${sci(chi)}，退磁修正后 χ = ${sci(corrected)}，屏蔽体积分数估计 = ${sci(fraction)}%。`,metrics:{chiLow:sci(chi),chiCorrected:sci(corrected),shieldingPercent:sci(fraction),points:count},steps:[...base.steps,'平均最低温 10% 数据','按输入退磁因子修正并换算 −4πχ；单位或形状不满足时该百分比无物理意义']};
  }
  if(type==='ZFC/FC 分叉温度'){
    if(!referenceColumn)throw new Error('ZFC/FC 分叉分析需要选择参考曲线列。');const xi=normalized.columns.indexOf(xColumn),yi=normalized.columns.indexOf(yColumn),ri=normalized.columns.indexOf(referenceColumn),threshold=Math.max(0,numeric(request.branchThreshold)??.02),rows=normalized.rows.map((row,index)=>[row[xi],row[yi],row[ri],index]).filter(row=>row.slice(0,3).every(Number.isFinite)&&(min===null||row[0]>=min)&&(max===null||row[0]<=max)),scale=rows.reduce((largest,row)=>Math.max(largest,Math.abs(row[1]),Math.abs(row[2])),Number.EPSILON),limit=threshold*scale,candidates=rows.filter(row=>Math.abs(row[1]-row[2])>=limit),bifurcation=candidates.length?candidates.reduce((largest,row)=>Math.max(largest,row[0]),-Infinity):null;
    return {...base,referenceColumn,parameters:{branchThreshold:threshold},method:'两曲线差值阈值法',formula:'Tbif = max{T: |YZFC−YFC| ≥ p·max(|Y|)}',assumptions:['两列数据在相同温度点或足够接近','阈值 p 为相对全幅比例，默认 2%'],summary:`${referenceColumn} 与 ${yColumn} 的 ${threshold*100}% 阈值分叉温度为 ${sci(bifurcation)} K。`,metrics:{bifurcationK:sci(bifurcation),relativeThreshold:threshold,absoluteThreshold:sci(limit),points:rows.length},steps:[...base.steps,`逐点比较 ${yColumn} 与 ${referenceColumn}`,'超过相对全幅阈值的最高温度定义为分叉温度']};
  }
  if(type==='比热跃变 ΔC/γTc'){
    const tc=numeric(request.tcK),gamma=numeric(request.gamma);if(!(tc>0&&gamma>0))throw new Error('比热跃变分析需要输入 Tc 和 γ。');const below=pairs.filter(([t])=>t>=.8*tc&&t<=.98*tc).map(p=>p[1]),above=pairs.filter(([t])=>t>=1.02*tc&&t<=1.2*tc).map(p=>p[1]);if(!below.length||!above.length)throw new Error('Tc 两侧数据不足，请扩大拟合窗口或检查 Tc。');const yIsCOverT=Boolean(request.yIsCOverT),jumpRaw=average(below)-average(above),deltaC=yIsCOverT?jumpRaw*tc:jumpRaw,ratio=deltaC/(gamma*tc);
    return {...base,parameters:{tcK:tc,gamma,yIsCOverT},method:'Tc 两侧局部平均差',formula:'ΔC = <Cbelow>−<Cabove>；ΔC/(γTc)；若 Y=C/T 则 ΔC=Tc·Δ(C/T)',assumptions:['0.80–0.98Tc 和 1.02–1.20Tc 的平均值可代表跃变两侧','γ 与 C 使用一致的摩尔和能量单位'],summary:`ΔC = ${sci(deltaC)}，ΔC/(γTc) = ${sci(ratio)}。`,metrics:{deltaC:sci(deltaC),deltaCOverGammaTc:sci(ratio),tcK:tc,gamma,belowPoints:below.length,abovePoints:above.length},steps:[...base.steps,'分别平均 Tc 下方与上方规定窗口','按 Y 是 C 还是 C/T 换算 ΔC，再除以 γTc；精密分析应采用熵守恒构造']};
  }
  throw new Error('当前分析类型尚未实现。');
}

function transformedPoint(type,x,y,analysis){
  if(type==='Curie–Weiss 拟合')return y!==0?[x,1/y]:[null,null];
  if(type==='C/T–T² 拟合')return x!==0?[x*x,y/x]:[null,null];
  if(type==='低温电阻 ρ₀+AT²')return [x*x,y];
  if(type==='弱局域化/Kondo 对数拟合')return x>0?[Math.log(x),y]:[null,null];
  if(type==='Bloch–Grüneisen 拟合')return x>0?[bgShape(x,analysis.fit?.thetaR),y]:[null,null];
  return [x,y];
}
function analysisPrediction(analysis,x,fitX){
  if(analysis.fit?.model==='Debye–Einstein'){const p=analysis.fit.parameters;return debyeEinsteinModel(x,[p.gamma,p.thetaD,p.thetaE,p.debyeFraction],p.atoms);}
  if(analysis.fit?.model==='two-band-hall'){const p=analysis.fit.parameters;return twoBandHallModel(x,[Math.log10(p.ne),Math.log10(p.nh),Math.log10(p.mue),Math.log10(p.muh)]);}
  return analysis.fit&&Number.isFinite(fitX)?analysis.fit.intercept+analysis.fit.slope*fitX:null;
}

export function analysisProjection(dataset,analysis){
  const normalized=normalizeMeasurementDataset(dataset);if(!normalized||!analysis)return [];
  const xi=normalized.columns.indexOf(analysis.xColumn||normalized.xColumn),yi=normalized.columns.indexOf(analysis.yColumn||normalized.yColumn),ei=normalized.columns.indexOf(analysis.errorColumn),qi=normalized.columns.indexOf(analysis.qualityColumn),min=numeric(analysis.window?.min),max=numeric(analysis.window?.max),outliers=new Set(analysis.quality?.outlierIndexes||[]);
  return normalized.rows.map((row,index)=>{
    const x=row[xi],y=row[yi],valid=Number.isFinite(x)&&Number.isFinite(y),included=valid&&(min===null||x>=min)&&(max===null||x<=max),[fitX,fitY]=valid?transformedPoint(analysis.type,x,y,analysis):[null,null],predicted=included&&analysis.fit?analysisPrediction(analysis,x,fitX):null,residual=Number.isFinite(predicted)&&Number.isFinite(fitY)?fitY-predicted:null,rawError=ei>=0?row[ei]:null,fitError=!Number.isFinite(rawError)?null:analysis.type==='Curie–Weiss 拟合'&&y!==0?Math.abs(rawError/y**2):analysis.type==='C/T–T² 拟合'&&x!==0?Math.abs(rawError/x):Math.abs(rawError);
    return {index,x,y,rawError,fitError,qualityValue:qi>=0?row[qi]:null,included,fitX,fitY,predicted,residual,qualityFlag:!valid?'missing':outliers.has(index)?'residual_outlier':included?'included':'outside_window'};
  });
}

export function analysisCsv(dataset,analysis){
  const rows=analysisProjection(dataset,analysis),quote=value=>`"${String(value??'').replaceAll('"','""')}"`,headers=['Analysis_Type','Version','Method','Formula','X_Original','Y_Original','Y_Error_Original','Instrument_Quality_Value','X_Fit_Space','Y_Fit_Space','Y_Error_Fit_Space','Y_Fitted','Residual','Included','Quality_Flag','Original_Row'];
  return '\uFEFF'+[headers.map(quote).join(','),...rows.map((row,index)=>[index===0?analysis.type:'',index===0?analysis.version:'',index===0?analysis.method:'',index===0?analysis.formula:'',row.x,row.y,row.rawError,row.qualityValue,row.fitX,row.fitY,row.fitError,row.predicted,row.residual,row.included?1:0,row.qualityFlag,row.index+1].map(quote).join(','))].join('\r\n');
}

export function analysisMethodText(dataset,analysis){
  const lines=[`分析：${analysis.type}`,`数据集：${dataset.name}`,`版本：v${analysis.version}`,`方法：${analysis.method||'—'}`,`公式：${analysis.formula||'—'}`,`X / Y：${analysis.xColumn} / ${analysis.yColumn}`,`拟合窗口：${analysis.window?.min??'−∞'} 至 ${analysis.window?.max??'+∞'}`,`结果：${analysis.summary||'—'}`,'','适用条件与假设：',...(analysis.assumptions||[]).map((item,index)=>`${index+1}. ${item}`),'','处理步骤：',...(analysis.steps||[]).map((item,index)=>`${index+1}. ${item}`),'','排除与质量规则：',...(analysis.exclusionRules||[]).map((item,index)=>`${index+1}. ${item}`),'','拟合统计：',JSON.stringify(analysis.fit||{},null,2),'','质量摘要：',JSON.stringify(analysis.quality||{},null,2)];
  return lines.join('\r\n');
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
