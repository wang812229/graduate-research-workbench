// Structured run notes are deliberately kept separate from instrument rows.
// This module has no storage or network side effects and is safe to reuse on import.
const clean=value=>String(value??'').trim();
const id=(prefix)=>`${prefix}-${globalThis.crypto?.randomUUID?.()??Math.random().toString(36).slice(2)}`;
const timestamp=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():new Date().toISOString();};
const take=(items,limit,mapper)=>Array.isArray(items)?items.slice(0,limit).map(mapper):[];
export const EVENT_TYPES=['计划','装炉','升温','保温','降温','停电/故障','开炉取晶','切割加工','测量','复盘','其他'];
export const RUN_PARAMETERS=[
  {key:'sourceTemp',label:'源区温度',unit:'°C'},
  {key:'growthTemp',label:'生长区温度',unit:'°C'},
  {key:'peakTemp',label:'峰值温度',unit:'°C'},
  {key:'holdTime',label:'保温时间',unit:'h'},
  {key:'coolingRate',label:'降温速率',unit:'°C/h'}
];
const finite=value=>value===''||value==null?null:Number.isFinite(Number(value))?Number(value):null;
export function normalizeRunComparison(raw={}){
  const fields={};for(const {key} of RUN_PARAMETERS){const item=raw.fields?.[key]||{};fields[key]={planned:finite(item.planned),actual:finite(item.actual),reason:clean(item.reason).slice(0,500)};}
  return {fields,updatedAt:clean(raw.updatedAt)};
}
export function runDeviation(item={}){const planned=finite(item.planned),actual=finite(item.actual);return planned===null||actual===null?null:{absolute:actual-planned,percent:planned===0?null:100*(actual-planned)/Math.abs(planned)};}
export function normalizeRunEvents(raw=[]){return take(raw,300,item=>({id:clean(item.id)||id('event'),occurredAt:timestamp(item.occurredAt),type:EVENT_TYPES.includes(item.type)?item.type:'其他',title:clean(item.title).slice(0,150),description:clean(item.description).slice(0,2000),operator:clean(item.operator).slice(0,100),sampleNodeId:clean(item.sampleNodeId),datasetId:clean(item.datasetId),figureId:clean(item.figureId),recordedAt:timestamp(item.recordedAt||item.occurredAt)})).filter(item=>item.title).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt));}
export function normalizeOutcomeReviews(raw=[]){return take(raw,100,item=>({id:clean(item.id)||id('outcome'),recordedAt:timestamp(item.recordedAt),status:['成功','失败','待确认'].includes(item.status)?item.status:'待确认',hypothesis:clean(item.hypothesis).slice(0,1000),expected:clean(item.expected).slice(0,1000),observed:clean(item.observed).slice(0,1000),cause:clean(item.cause).slice(0,1000),nextVariable:clean(item.nextVariable).slice(0,1000),controlExperimentId:clean(item.controlExperimentId)})).filter(item=>item.hypothesis||item.observed);}
export function normalizeHandovers(raw=[]){return take(raw,100,item=>({id:clean(item.id)||id('handover'),occurredAt:timestamp(item.occurredAt),from:clean(item.from).slice(0,100),to:clean(item.to).slice(0,100),location:clean(item.location).slice(0,200),notes:clean(item.notes).slice(0,500)}));}
export function sampleLink(baseUrl,nodeId){const url=new URL(baseUrl);url.hash=`sample=${encodeURIComponent(nodeId)}`;return url.href;}
