import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const catalogPath=join(root,'catalog.json');
const sourceRepo='wang812229/crystal-growth-property-control';
const briefBase='https://wang812229.github.io/crystal-growth-property-control';

function paperId(paper,reportDate,index){
  const source=String(paper.doi||paper.source||paper.fullText||'').trim();
  const doi=source.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').toLowerCase();
  if(/^10\.\d{4,9}\//.test(doi))return `doi:${doi}`;
  const arxiv=source.match(/(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:)(\d{4}\.\d{4,5})/i);
  if(arxiv)return `arxiv:${arxiv[1]}`;
  return `${reportDate}:${index}`;
}

export function mergeReports(reports,existing=[]){
  if(!Array.isArray(reports)||!Array.isArray(existing))throw new Error('文献数据格式错误');
  const merged=new Map();
  const seenTitles=new Set();
  for(const report of [...reports].sort((a,b)=>String(b.date).localeCompare(String(a.date)))){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(report.date)||!Array.isArray(report.papers))throw new Error('简报缺少日期或论文列表');
    for(const [index,p] of report.papers.entries()){
      if(!p.title)continue;
      const id=paperId(p,report.date,index+1);
      const title=String(p.title).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
      if(merged.has(id)||seenTitles.has(title))continue;
      seenTitles.add(title);
      const old=existing.find(item=>item.id===id)||{};
      const doi=id.startsWith('doi:')?id.slice(4):'';
      merged.set(id,{
        ...old,id,title:p.title,authors:p.authors||old.authors||'',journal:p.journal||old.journal||'',
        year:Number(String(p.date||report.date).slice(0,4)),doi,
        url:p.doi||p.fullText||old.url||'',material:p.material||old.material||'',
        tags:[...new Set([...(p.tags||[]),p.category].filter(Boolean))],
        category:p.category||'',date:report.date,access:p.access||'',
        summary:p.conclusion||'',reportUrl:`${briefBase}/reports/${report.date}/#paper-${index+1}`
      });
    }
  }
  for(const item of existing)if(item?.id&&!merged.has(item.id))merged.set(item.id,item);
  return [...merged.values()];
}

async function getJson(url){
  const response=await fetch(url,{headers:{'User-Agent':'GraduateResearchWorkbench/1.0','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`获取公开简报失败：HTTP ${response.status} ${url}`);
  return response.json();
}

async function remoteReports(){
  const listing=await getJson(`https://api.github.com/repos/${sourceRepo}/contents/content/reports?ref=main`);
  if(!Array.isArray(listing))throw new Error('公开简报目录无效');
  const files=listing.filter(item=>/^\d{4}-\d{2}-\d{2}\.json$/.test(item.name)&&item.download_url);
  if(!files.length)throw new Error('公开简报目录为空，保留现有书目');
  const reports=[];
  for(let offset=0;offset<files.length;offset+=5){
    reports.push(...await Promise.all(files.slice(offset,offset+5).map(item=>getJson(item.download_url))));
  }
  return reports;
}

async function localReports(folder){
  const files=(await readdir(folder)).filter(name=>/^\d{4}-\d{2}-\d{2}\.json$/.test(name));
  return Promise.all(files.map(async name=>JSON.parse(await readFile(join(folder,name),'utf8'))));
}

async function main(){
  const local=process.argv.find(arg=>arg.startsWith('--local-source='))?.slice('--local-source='.length);
  const reports=local?await localReports(resolve(local)):await remoteReports();
  const existing=JSON.parse(await readFile(catalogPath,'utf8'));
  const merged=mergeReports(reports,existing);
  const content=JSON.stringify(merged,null,2)+'\n';
  if(content!==await readFile(catalogPath,'utf8')){
    const temp=catalogPath+'.tmp';
    await writeFile(temp,content,'utf8');
    await rename(temp,catalogPath);
  }
  console.log(`同步 ${reports.length} 期公开简报；目录现有 ${existing.length} 篇，更新后 ${merged.length} 篇；最新 ${reports.map(r=>r.date).sort().at(-1)}。`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
