export const PROFILE_KEYS = ['materials','methods','measurements','journals','authors'];
export const PAPER_GROUPS = ['准备复现','实验方法参考','生长方法参考','待组会汇报','与当前结果冲突','需要获取全文','需要补看SI'];
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
  result.archived = Boolean(raw.archived);
  return result;
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
