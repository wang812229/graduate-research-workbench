import { ANALYSIS_TYPES, PIPELINE_STEP_TYPES, BUILTIN_PIPELINE_TEMPLATES, runProcessingPipeline, createPipelineVersion, newId } from './core.mjs';

const analysisGroups = ['输运与霍尔','磁性与超导','比热'];
const groupForAnalysis = type => /比热|C\/T|Debye/.test(type) ? '比热' : /Curie|磁滞|屏蔽|ZFC/.test(type) ? '磁性与超导' : '输运与霍尔';
const descriptions = {
  'RRR':'比较高温与低温电阻，记录温度窗口和残余电阻比。',
  '超导转变温度':'从电阻转变提取起始、中点、零电阻判据与转变宽度。',
  'Curie–Weiss 拟合':'在指定温区拟合逆磁化率，提取 Curie 常数与 Weiss 温度。',
  'C/T–T² 拟合':'拟合低温 C/T 对 T²，估算电子项 γ 与晶格项 β。',
  'Debye–Einstein 联合拟合':'用电子、Debye 与 Einstein 项描述温度依赖比热。',
  '霍尔系数与迁移率':'拟合磁场与横向信号，结合厚度和纵向电阻率估算载流子参数。',
  '双载流子霍尔模型':'比较非线性霍尔曲线与电子、空穴双载流子模型。',
  '低温电阻 ρ₀+AT²':'在低温窗口拟合残余电阻和 T² 项。',
  '弱局域化/Kondo 对数拟合':'检查低温电阻对 ln(T) 的变化；拟合不能独自区分机制。',
  '磁滞回线参数':'从正反扫磁场提取矫顽场与剩磁，保留支路信息。',
  '超导屏蔽体积分数':'结合样品几何和退磁因子估算屏蔽信号。',
  'ZFC/FC 分叉温度':'对比 ZFC 与 FC 两列信号，按设定阈值寻找分叉。',
  '比热跃变 ΔC/γTc':'以 Tc 和正常态电子项为参照估算比热跃变。',
  'Bloch–Grüneisen 拟合':'拟合电阻的声子散射温度依赖并检查残差。',
  '裁剪启动阶段':'按时间轴去除仪器启动阶段；必须先确认 X 轴是秒。',
  '按 X 升序排序':'按当前 X 列排序，保留原始数据与重复测量点。',
  '按 X 降序排序':'按当前 X 列逆序排列，用于比较扫描方向。',
  '筛选 X 窗口':'保留指定 X 范围，保存筛选参数与输出行数。',
  '扣除常数背景':'从 Y 列扣除指定常数；背景值由测量或研究者确定。',
  '按质量归一化':'用样品质量 mg 将 Y 换算为每克信号。',
  '按摩尔数归一化':'结合质量与摩尔质量，将 Y 换算为每摩尔信号。',
  '电阻换算电阻率':'按样品长、宽、厚度把电阻 Ω 换算为电阻率 Ω·m。',
  '霍尔正反场反对称化':'配对正负磁场，计算横向信号的反对称部分。',
  'XRD 最低值背景扣除':'扣除全谱最低强度常数；仅作简单预处理，不等于 Rietveld 背景建模。'
};
export const PROCESSING_METHODS = [
  ...ANALYSIS_TYPES.map((type,index)=>({id:`analysis-${index}`,kind:'analysis',name:type,group:groupForAnalysis(type),description:descriptions[type],type})),
  ...PIPELINE_STEP_TYPES.map((type,index)=>({id:`step-${index}`,kind:'step',name:type,group:type.startsWith('XRD')?'XRD':type.startsWith('霍尔')||type.startsWith('电阻')?'输运与霍尔':'数据整理与归一化',description:descriptions[type],type})),
  ...BUILTIN_PIPELINE_TEMPLATES.map(template=>({id:`recipe-${template.id}`,kind:'recipe',name:template.name,group:'组合处理流程',description:template.steps.map(step=>step.type).join(' → '),steps:template.steps})),
  {id:'xrd-rietveld',kind:'xrd',name:'XRD 全谱 Rietveld 精修',group:'XRD',description:'实测衍射谱 + 结构 CIF + 校准参数；使用真实 GSAS-II 和分支审计，导出 Origin 曲线。'},
  {id:'comparison',kind:'comparison',name:'多数据叠图与归一化比较',group:'数据整理与归一化',description:'最多选择五组独立或实验数据，按质量、摩尔数或几何归一化后比较，并导出 Origin 成对列。'},
  {id:'growth-correlation',kind:'correlation',name:'生长参数与物性关联',group:'组合处理流程',description:'从实验记录的生长条件和样品质量指标构建散点图，导出逐样品的实际数值。'},
  {id:'dataset-quality',kind:'quality',name:'数据质量与来源检查',group:'数据整理与归一化',description:'检查原文件校验值、单位、样品身份、缺失值、重复 X 和误差列；记录问题而不改写原始行。'}
];
export const PROCESSING_GROUPS = ['全部','数据整理与归一化',...analysisGroups,'XRD','组合处理流程'];
export function processingEntries(vault){
  return [
    ...(vault.processingDatasets||[]).filter(dataset=>!dataset.archived).map(dataset=>({dataset,record:null,source:'独立导入'})),
    ...(vault.experiments||[]).filter(record=>!record.archived).flatMap(record=>(record.datasets||[]).map(dataset=>({dataset,record,source:`实验 ${record.sampleId||record.id}`})))
  ];
}
export function locateProcessingDataset(vault,id){
  const index=(vault.processingDatasets||[]).findIndex(dataset=>dataset.id===id);
  if(index>=0)return {dataset:vault.processingDatasets[index],experiment:null,index,scope:'processing'};
  for(const experiment of vault.experiments||[]){const index=(experiment.datasets||[]).findIndex(dataset=>dataset.id===id);if(index>=0)return {dataset:experiment.datasets[index],experiment,index,scope:'experiment'};}
  return null;
}
export function runWorkspaceMethod(dataset,method,values={}){
  if(dataset.localRawOnly)throw new Error('请先恢复完整数据。');
  if(!method||!['step','recipe'].includes(method.kind))throw new Error('请先选择处理方法。');
  const base=method.kind==='recipe'?method.steps:[{type:method.type,params:{}}];
  const steps=base.map((step,index)=>{const params={};for(const key of ['seconds','min','max','value']){const raw=values[`step_${index}_${key}`];if(raw!==undefined&&String(raw).trim()!==''){const value=Number(raw);if(!Number.isFinite(value))throw new Error('处理参数必须是有限数值。');params[key]=value;}}return {id:newId('step'),type:step.type,params,enabled:true};});
  const result=runProcessingPipeline(dataset,steps),version=createPipelineVersion(dataset,steps,method.name);
  dataset.processing||={steps:[],versions:[]};dataset.processing.steps=steps;dataset.processing.templateName=method.name;
  dataset.processing.versions=[...(dataset.processing.versions||[]),version].slice(-30);dataset.processing.lastRunAt=version.createdAt;
  dataset.processing.lastResult={columns:result.columns,rows:result.rows.slice(0,5000),rowCount:result.rows.length,summary:result.summary};
  return result;
}
