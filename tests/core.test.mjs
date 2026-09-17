import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyVault, normalizeExperiment, parseCsv, experimentsCsv, parseImport, mergeVault, parseSchedule, temperatureSeries } from '../core.mjs';

test('old experiment JSON and CSV import preserve quoted multiline fields',()=>{
  const old={id:'exp-1',sampleId:'CVT-01',material:'α-RuCl₃',method:'CVT',notes:'第一行\n第二行, 含逗号'};
  const fromJson=parseImport(JSON.stringify([old]),'experiment-records.json');
  assert.equal(fromJson.experiments[0].notes,old.notes);
  const csv=experimentsCsv(fromJson.experiments);
  assert.equal(parseCsv(csv).length,2);
  const fromCsv=parseImport(csv,'experiment-records.csv');
  assert.equal(fromCsv.experiments[0].notes,old.notes);
});

test('old paper project export resolves public catalog metadata without inventing missing titles',()=>{
  const catalog=[{id:'doi:10.1/abc',title:'Observed title',authors:'A; B',journal:'PRB',doi:'10.1/abc'}];
  const data={favorites:['doi:10.1/abc','unknown-id'],collections:{'doi:10.1/abc':'待组会汇报'}};
  const result=parseImport(JSON.stringify(data),'paper-projects.json',catalog);
  assert.equal(result.papers[0].title,'Observed title');
  assert.equal(result.papers[0].group,'待组会汇报');
  assert.equal(result.papers[1].title,'待补全文献信息');
});

test('full migration bundle and merge keep independent records',()=>{
  const source={format:'daily-literature-research-export',version:1,preferences:{materials:['UTe₂']},experiments:[{id:'exp-1',sampleId:'A',material:'UTe₂'}],favorites:[{id:'paper-1',title:'Paper A'}],collections:{'paper-1':'准备复现'}};
  const imported=parseImport(JSON.stringify(source),'bundle.json');
  const vault=mergeVault(emptyVault(),imported);
  assert.equal(vault.experiments.length,1);
  assert.equal(vault.papers[0].title,'Paper A');
  assert.deepEqual(vault.profile.materials,['UTe₂']);
  assert.equal(mergeVault(vault,imported).experiments.length,1);
  assert.equal(parseImport(JSON.stringify({format:'yanxi-workbench',vault}),'backup.json').papers.length,1);
});

test('temperature program parses both zones and rejects ambiguous rows',()=>{
  const stages=parseSchedule('升温|10|850|800\n保温|48|850|800\n降温|24|700|650');
  const series=temperatureSeries(stages);
  assert.deepEqual(series.map(p=>p.t),[0,10,58,82]);
  assert.equal(series.at(-1).growthC,650);
  assert.throws(()=>parseSchedule('保温|未知|850|800'),/第 1 行/);
  assert.equal(normalizeExperiment({schedule:stages}).schedule.length,3);
});
