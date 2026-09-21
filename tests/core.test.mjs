import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyVault, normalizeExperiment, parseCsv, experimentsCsv, parseImport, mergeVault, parseSchedule, temperatureSeries, parseMeasurementText, measurementCsv, analyzeDataset, analysisProjection, analysisCsv, comparisonSeries, downsampleDataset } from '../core.mjs';
import { mergeReports } from '../scripts/sync-literature.mjs';

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

test('measurement import recognizes transport columns and survives experiment normalization',()=>{
  const dataset=parseMeasurementText('Temperature (K),Resistance (Ohm),Field (T)\n300,1.2,0\n100,0.8,0\n2,0.03,0','sample-resistance.csv');
  assert.equal(dataset.type,'电阻/电输运');
  assert.equal(dataset.xColumn,'Temperature (K)');
  assert.equal(dataset.yColumn,'Resistance (Ohm)');
  assert.equal(dataset.rows.length,3);
  const record=normalizeExperiment({sampleId:'R-01',datasets:[dataset]});
  assert.equal(record.datasets[0].rows[2][1],0.03);
  assert.match(measurementCsv(record.datasets[0]),/"Temperature \(K\)","Resistance \(Ohm\)"/);
});

test('measurement import accepts whitespace instrument files and rejects oversized tables',()=>{
  const dataset=parseMeasurementText('# PPMS export\nT_K Moment_emu\n2 1.2D-5\n5 1.5D-5\n10 2.1D-5','magnetization.dat');
  assert.equal(dataset.type,'磁化/磁矩');
  assert.equal(dataset.instrument,'Quantum Design PPMS');
  assert.equal(dataset.rows[0][1],1.2e-5);
  const tooLarge=['x y',...Array.from({length:250001},(_,i)=>`${i} ${i}`)].join('\n');
  assert.throws(()=>parseMeasurementText(tooLarge,'large.txt'),/250,000/);
});

test('PPMS data section is recognized without treating header metadata as rows',()=>{
  const text='[Header]\nINFO,APPNAME,PPMS\nINFO,FILEOPENTIME,9/21/2026\n[Data]\nTemperature (K),Resistance (Ohm)\n2,0.1\n100,1\n300,2';
  const dataset=parseMeasurementText(text,'QD_export.dat');
  assert.equal(dataset.instrument,'Quantum Design PPMS');
  assert.equal(dataset.rows.length,3);
  assert.deepEqual(dataset.columns,['Temperature (K)','Resistance (Ohm)']);
});

test('automatic analyses produce traceable transport, magnetic, heat capacity and Hall results',()=>{
  const resistance={name:'R-T',columns:['T','R'],xColumn:'T',yColumn:'R',type:'电阻/电输运',rows:Array.from({length:20},(_,i)=>[i+1,i<2?1:10+i])};
  const rrr=analyzeDataset(resistance,{type:'RRR'});
  assert.ok(rrr.metrics.rrr>20);
  assert.match(rrr.formula,/RRR/);
  const tc=analyzeDataset({name:'Tc',columns:['T','R'],xColumn:'T',yColumn:'R',rows:[[1,0],[2,0],[3,1],[4,5],[5,9],[6,10],[7,10],[8,10],[9,10],[10,10]]},{type:'超导转变温度'});
  assert.ok(tc.metrics.tcMidK>3&&tc.metrics.tcMidK<5);

  const magnetic={name:'chi',columns:['T','chi'],xColumn:'T',yColumn:'chi',rows:[10,20,30,40,50].map(t=>[t,2/(t+10)])};
  const cw=analyzeDataset(magnetic,{type:'Curie–Weiss 拟合'});
  assert.ok(Math.abs(cw.metrics.thetaK+10)<1e-9);
  assert.ok(cw.metrics.r2>.999999);

  const heat={name:'Cp',columns:['T','C'],xColumn:'T',yColumn:'C',rows:[1,2,3,4,5].map(t=>[t,3*t+.2*t**3])};
  const ct=analyzeDataset(heat,{type:'C/T–T² 拟合',atomsPerFormula:3});
  assert.ok(Math.abs(ct.metrics.gamma-3)<1e-9);
  assert.ok(Math.abs(ct.metrics.beta-.2)<1e-9);

  const hall={name:'Hall',columns:['B','rho_xy'],xColumn:'B',yColumn:'rho_xy',rows:[-2,-1,0,1,2].map(b=>[b,2e-9*b])};
  const result=analyzeDataset(hall,{type:'霍尔系数与迁移率',rhoXx:1e-6});
  assert.ok(Math.abs(result.metrics.hallCoefficient-2e-9)<1e-15);
  assert.ok(result.metrics.mobilityM2Vs>0);
  assert.ok(result.steps.length>=3);
});

test('comparison normalization and cloud downsampling preserve provenance',()=>{
  const dataset={name:'sample',columns:['T','R'],xColumn:'T',yColumn:'R',rows:Array.from({length:10001},(_,i)=>[i,2]),sampleMeta:{massMg:10,lengthMm:2,widthMm:1,thicknessMm:.1,molarMass:100}};
  assert.equal(comparisonSeries(dataset,'mass').points[0][1],200);
  assert.equal(comparisonSeries(dataset,'geometry').points[0][1],.0001);
  assert.equal(comparisonSeries(dataset,'molar').points[0][1],20000);
  const sampled=downsampleDataset(dataset,5000);
  assert.equal(sampled.rows.length,5000);
  assert.equal(sampled.sourceRows,10001);
  assert.equal(sampled.localRawOnly,true);
});

test('fit windows preserve excluded points and Origin export includes errors, residuals and method',()=>{
  const dataset={name:'fit-source',columns:['T','rho','sigma','range'],xColumn:'T',yColumn:'rho',rows:Array.from({length:12},(_,i)=>[i+1,2+3*(i+1)**2,.1,i<6?1:2])};
  const fit=analyzeDataset(dataset,{type:'低温电阻 ρ₀+AT²',xMin:3,xMax:10,errorColumn:'sigma',qualityColumn:'range'});
  assert.ok(Math.abs(fit.metrics.rho0-2)<1e-9);
  assert.ok(Math.abs(fit.metrics.A-3)<1e-9);
  assert.equal(fit.quality.excludedByWindow,4);
  assert.equal(fit.quality.rangeSwitches,1);
  assert.equal(fit.fit.slopeCI95.length,2);
  const projection=analysisProjection(dataset,fit);
  assert.equal(projection.filter(row=>row.included).length,8);
  assert.equal(projection[0].qualityFlag,'outside_window');
  const csv=analysisCsv(dataset,fit);
  assert.match(csv,/Y_Error_Original/);
  assert.match(csv,/Residual/);
  assert.match(csv,/普通最小二乘线性回归/);
});

test('specialized magnetic, heat-capacity and nonlinear models report assumptions',()=>{
  const loop={name:'loop',columns:['H','M'],xColumn:'H',yColumn:'M',rows:[[-2,-1],[-1,-.4],[0,.2],[1,.6],[2,1],[1,.4],[0,-.2],[-1,-.6],[-2,-1]]};
  const hysteresis=analyzeDataset(loop,{type:'磁滞回线参数'});
  assert.ok(hysteresis.metrics.coerciveField>0);
  assert.match(hysteresis.formula,/Hc/);

  const chi={name:'chi',columns:['T','chi'],xColumn:'T',yColumn:'chi',rows:[[2,-.08],[3,-.079],[4,-.078],[5,-.07],[6,-.05]]};
  const shielding=analyzeDataset(chi,{type:'超导屏蔽体积分数',demagFactor:.1});
  assert.ok(shielding.metrics.shieldingPercent>0);
  assert.match(shielding.assumptions.join(' '),/cgs/);

  const zfc={name:'zfc-fc',columns:['T','ZFC','FC'],xColumn:'T',yColumn:'ZFC',rows:[[2,.1,.3],[4,.12,.31],[6,.2,.3],[8,.29,.3],[10,.3,.3]]};
  const bif=analyzeDataset(zfc,{type:'ZFC/FC 分叉温度',referenceColumn:'FC',branchThreshold:.05});
  assert.ok(bif.metrics.bifurcationK>=6);

  const cp={name:'jump',columns:['T','C'],xColumn:'T',yColumn:'C',rows:Array.from({length:81},(_,i)=>{const t=6+i*.1;return [t,t<10?30:20];})};
  const jump=analyzeDataset(cp,{type:'比热跃变 ΔC/γTc',tcK:10,gamma:1});
  assert.ok(Math.abs(jump.metrics.deltaCOverGammaTc-1)<1e-9);

  const bg={name:'metal',columns:['T','rho'],xColumn:'T',yColumn:'rho',rows:[10,20,40,80,120,180,240,300].map(t=>[t,1+.002*t])};
  const bgFit=analyzeDataset(bg,{type:'Bloch–Grüneisen 拟合',thetaDInitial:200});
  assert.equal(bgFit.fit.model,'Bloch–Grüneisen');
  assert.ok(Number.isFinite(bgFit.metrics.thetaR));

  const lattice={name:'lattice',columns:['T','C'],xColumn:'T',yColumn:'C',rows:[5,10,20,40,80,120].map(t=>[t,.01*t+.0002*t**3])};
  const de=analyzeDataset(lattice,{type:'Debye–Einstein 联合拟合',atomsPerFormula:2,gamma:.01,thetaDInitial:250,thetaEInitial:100});
  assert.equal(de.fit.model,'Debye–Einstein');
  assert.match(de.assumptions.join(' '),/初值/);

  const e=1.602176634e-19,ne=1e26,nh=2e26,mue=.01,muh=.02,twoBand=b=>b*((nh*muh**2-ne*mue**2)+(nh-ne)*(muh*mue*b)**2)/(e*((nh*muh+ne*mue)**2+((nh-ne)*muh*mue*b)**2));
  const hall2={name:'two-band',columns:['B','rho'],xColumn:'B',yColumn:'rho',rows:[-9,-6,-3,0,3,6,9].map(b=>[b,twoBand(b)])};
  const two=analyzeDataset(hall2,{type:'双载流子霍尔模型',electronDensityInitial:ne,holeDensityInitial:nh,electronMobilityInitial:mue,holeMobilityInitial:muh});
  assert.equal(two.fit.model,'two-band-hall');
  assert.ok(two.metrics.r2>.99);
});

test('daily report sync adds new papers once and retains personal-library match IDs',()=>{
  const old=[{id:'doi:10.1234/old',title:'Old paper',journal:'PRB'}];
  const reports=[{date:'2026-09-18',papers:[
    {title:'New crystal',doi:'https://doi.org/10.1234/new',authors:'A; B',journal:'PRL',material:'UTe₂',category:'重费米子与量子临界',conclusion:'新结论',tags:['Flux']},
    {title:'New crystal',doi:'https://doi.org/10.1234/new',authors:'A; B'},
    {title:'Preprint',doi:'https://arxiv.org/abs/2609.20093v1',authors:'C',tags:['单晶']}
  ]}];
  const merged=mergeReports(reports,old);
  assert.equal(merged.length,3);
  assert.equal(merged[0].id,'doi:10.1234/new');
  assert.equal(merged[0].reportUrl,'https://wang812229.github.io/crystal-growth-property-control/reports/2026-09-18/#paper-1');
  assert.equal(merged[0].summary,'新结论');
  assert.equal(merged[1].id,'arxiv:2609.20093');
  assert.equal(merged[2].id,'doi:10.1234/old');
});
