export const PROFILE_KEYS = ['materials','methods','measurements','journals','authors'];
export const PAPER_GROUPS = ['准备复现','实验方法参考','生长方法参考','待组会汇报','与当前结果冲突','需要获取全文','需要补看SI'];
export const MEASUREMENT_TYPES = ['电阻/电输运','磁化/磁矩','比热','霍尔效应','I–V曲线','XRD/衍射','光谱','自定义'];
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
  const columns=uniqueColumns(Array.isArray(raw.columns)?raw.columns:[]).slice(0,32);
  if(columns.length<2)return null;
  const rows=(Array.isArray(raw.rows)?raw.rows:[]).slice(0,20000).map(row=>columns.map((_,i)=>numeric(row?.[i]))).filter(row=>row.filter(Number.isFinite).length>=2);
  if(!rows.length)return null;
  const xColumn=columns.includes(raw.xColumn)?raw.xColumn:columns[0];
  const yColumn=columns.includes(raw.yColumn)&&raw.yColumn!==xColumn?raw.yColumn:(columns.find(c=>c!==xColumn)||columns[1]);
  return {id:clean(raw.id)||uid('data'),name:clean(raw.name)||'未命名数据',type:MEASUREMENT_TYPES.includes(raw.type)?raw.type:inferMeasurementType(columns,raw.name),columns,xColumn,yColumn,rows,rowCount:Number(raw.rowCount)||rows.length,importedAt:clean(raw.importedAt)||now(),notes:clean(raw.notes)};
}

function splitMeasurementLine(line,delimiter){
  if(delimiter===',')return parseCsv(line)[0]||[];
  if(delimiter===';')return line.split(';').map(clean);
  if(delimiter==='\t')return line.split('\t').map(clean);
  return line.trim().split(/\s+/).map(clean);
}

export function parseMeasurementText(text,filename='measurement.txt') {
  const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!/^(?:#|\/\/)/.test(line));
  if(lines.length<2)throw new Error('数据文件至少需要两行。');
  const sample=lines.slice(0,8).join('\n');
  const counts=[['\t',(sample.match(/\t/g)||[]).length],[',',(sample.match(/,/g)||[]).length],[';',(sample.match(/;/g)||[]).length]];
  const delimiter=counts.sort((a,b)=>b[1]-a[1])[0][1]>0?counts[0][0]:'whitespace';
  const rawRows=lines.map(line=>splitMeasurementLine(line,delimiter));
  const width=Math.max(...rawRows.map(row=>row.length));
  if(width<2)throw new Error('没有识别到至少两列数据。请使用逗号、制表符、分号或空格分隔。');
  const first=rawRows[0];
  const firstNumeric=first.filter(value=>numeric(value)!==null).length;
  const hasHeader=firstNumeric<Math.max(2,Math.ceil(first.length*.65));
  const columns=uniqueColumns(hasHeader?first:Array.from({length:width},(_,i)=>`Column ${i+1}`));
  const body=rawRows.slice(hasHeader?1:0);
  const rows=body.map(row=>columns.map((_,i)=>numeric(row[i]))).filter(row=>row.filter(Number.isFinite).length>=2);
  if(!rows.length)throw new Error('文件中没有可绘图的数值行。');
  if(rows.length>20000)throw new Error('单个文件最多导入 20,000 行；请先分段或降采样。');
  const xRank=columns.map((name,index)=>({index,score:axisScore(name,'x')})).filter(x=>x.score>=0).sort((a,b)=>a.score-b.score)[0]?.index??0;
  const yRank=columns.map((name,index)=>({index,score:axisScore(name,'y')})).filter(x=>x.index!==xRank&&x.score>=0).sort((a,b)=>a.score-b.score)[0]?.index;
  const yIndex=yRank??columns.findIndex((_,i)=>i!==xRank);
  return normalizeMeasurementDataset({name:filename.replace(/\.[^.]+$/,''),type:inferMeasurementType(columns,filename),columns,xColumn:columns[xRank],yColumn:columns[yIndex],rows,rowCount:rows.length});
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
