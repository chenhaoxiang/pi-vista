import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {localWorkflowOptions,localLearningWorkflow,workflowNativeSuite,workflowObservation} from './local-learning-workflow.mjs';
import {prepareHistoricalGuidance} from '@pi-vista/learning/guidance';

const args=['--phase=write',`--source-sha=${'a'.repeat(40)}`,'--namespace=fixture-workflow','--credential-config=/fixture/credential.json','--service-fingerprint=/fixture/service.json','--deadline-ms=900000','--timeout-ms=120000','--allow-bank-write'];
const counts={tests:2,passed:2,failed:0,cancelled:0,skipped:0,todo:0,suites:0,file_wrappers:1};
const native=()=>({schema:1,files:['/fixture/owned.test.js'],counts:{...counts}});

test('LOCAL workflow parser is explicit closed and permits only the approved write or readonly phase',()=>{
 const c=localWorkflowOptions(args);assert.ok(Object.isFrozen(c));assert.equal(c.phase,'write');assert.equal(c.read_fault,false);
 const read=args.map(x=>x==='--phase=write'?'--phase=read':x==='--allow-bank-write'?'--allow-bank-read':x);
 assert.equal(localWorkflowOptions([...read,'--inject-read-fault']).read_fault,true);
 for(const bad of [[],args.slice(0,-1),[...args,'--allow-bank-write'],[...args,'--allow-bank-read'],[...args,'--inject-read-fault'],[...read,'--allow-bank-write'],
  [...args,'--network'],[...args,'--bank=main'],[...args,'--endpoint=http://elsewhere.invalid'],[...args,'--command=anything'],
  args.map(x=>x.startsWith('--source-sha')?'--source-sha=short':x),args.map(x=>x.startsWith('--namespace')?'--namespace=../outside':x),
  args.map(x=>x.startsWith('--namespace')?'--namespace=wrapped_ghp_abcdefghijklmnop':x),args.map(x=>x.startsWith('--namespace')?'--namespace='+ 'a'.repeat(49):x),
  args.map(x=>x.startsWith('--credential-config')?'--credential-config=relative':x),args.map(x=>x.startsWith('--deadline')?'--deadline-ms=1200001':x),
  args.map(x=>x.startsWith('--timeout')?'--timeout-ms=180001':x),args.map(x=>x.startsWith('--timeout')?'--timeout-ms=900000':x)])
  assert.throws(()=>localWorkflowOptions(bad),/local-workflow-options-refused/);
});
test('LOCAL actual entry rejects proxy/accessor/coercion/unknown before source, credential or bank effects',async()=>{
 let traps=0;const proxy=new Proxy({}, {get(){traps++;throw Error();},ownKeys(){traps++;throw Error();}});
 const accessor=Object.defineProperty({...localWorkflowOptions(args)},'namespace',{get(){traps++;throw Error();}});
 const coercion={toString(){traps++;throw Error();}};
 for(const value of [proxy,accessor,null,{},Object.assign(Object.create({}),localWorkflowOptions(args)),{...localWorkflowOptions(args),namespace:coercion},
  {...localWorkflowOptions(args),extra:true},{...localWorkflowOptions(args),read_fault:true},{...localWorkflowOptions(args),timeout_ms:Infinity}])await assert.rejects(()=>localLearningWorkflow(value),/local-workflow-options-refused/);
 assert.equal(traps,0);
});
test('LOCAL native suite accepts native-case coverage without treating file wrappers or suites as tests',()=>{
 const raw=native();raw.counts.file_wrappers=10;raw.counts.suites=4;
 assert.deepEqual(workflowNativeSuite(raw,raw.files),{name:'learning-native',total:2,passed:2,failed:0,cancelled:0,skipped:0,todo:0});
});
for(const field of ['failed','cancelled','skipped','todo'])test('LOCAL native '+field+' cannot become successful current evidence',()=>{
 const raw=native();raw.counts[field]=1;raw.counts.passed=1;assert.throws(()=>workflowNativeSuite(raw,raw.files));
});
test('LOCAL native zero/mismatched/forged case records refuse',()=>{
 for(const change of [r=>{r.counts.tests=0;r.counts.passed=0;},r=>{r.stdout_passed=true;},r=>{r.schema=2;},r=>{r.counts.tests=4;}]){const raw=native();change(raw);assert.throws(()=>workflowNativeSuite(raw,raw.files));}
 const raw=native();assert.throws(()=>workflowNativeSuite(raw,['/fixture/foreign.test.js']));
});
test('LOCAL synthetic document is deterministic across processes but carries no current proof or authority',()=>{
 const raw=workflowObservation('a'.repeat(40),'fixture-workflow','b'.repeat(64)),doc=prepareHistoricalGuidance(raw),saved=JSON.parse(doc.content);
 assert.deepEqual(workflowObservation('a'.repeat(40),'fixture-workflow','b'.repeat(64)),raw);assert.match(raw.script.description,/synthetic Fixture Metadata Checker/);
 assert.equal(saved.current_verification,'not-checked');assert.equal(saved.authorization,'none');assert.equal(saved.executable,false);
 assert.equal(Object.hasOwn(saved.experience,'status'),false);assert.equal(Object.hasOwn(saved.experience,'verification'),false);assert.equal(raw.run_id,'workflow-fixture-workflow-write');
 let traps=0;const hostile={toString(){traps++;throw Error();}};
 for(const tuple of [[hostile,'fixture-workflow','b'.repeat(64)],['a'.repeat(40),hostile,'b'.repeat(64)],['a'.repeat(40),'fixture-workflow',hostile],['bad','fixture-workflow','b'.repeat(64)]])assert.throws(()=>workflowObservation(...tuple));
 assert.equal(traps,0);
});
test('LOCAL operator import graph contains no startup compiled workspace dependency or default execution',async()=>{
 const main=await readFile(new URL('./local-learning-workflow.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(main,/from\s+['"]@pi-vista\//);assert.doesNotMatch(main,/from\s+['"].*local-host-acceptance/);
 assert.match(main,/prepareGuidanceClient\(c.source_sha,true\)/);assert.match(main,/client.plan.createHostPlanLedger\(PLAN\)/);
 const helper=await readFile(new URL('./guidance-acceptance-io.mjs',import.meta.url),'utf8');
 assert.match(helper,/if\(localWorkflow\)for\(const helper of \['local-host-acceptance.mjs','release-utils.mjs','run-tests.mjs'\]\)/);
 assert.match(helper,/localWorkflow\?await load\('packages\/learning\/dist\/local\/index.js'\):undefined/);
 assert.match(helper,/localWorkflow\?await load\('packages\/evidence\/dist\/host.js'\):undefined/);
 assert.match(helper,/localWorkflow\?await load\('scripts\/local-host-acceptance.mjs'\):undefined/);
});
test('LOCAL hermetic native import/malformed call never performs discovery, commands, fetch or timers', {timeout:15000},async()=>{
 const root=fileURLToPath(new URL('../tmp/local-workflow-import/',import.meta.url));await mkdir(root,{recursive:true});const owned=await mkdtemp(path.join(root,'case-'));
 try{
  const target=new URL('./local-learning-workflow.mjs',import.meta.url).href;
  const source=`import assert from 'node:assert/strict';import child from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';let called=0;const deny=()=>{called++;throw Error('fixture effect forbidden');};child.execFile=deny;child.spawn=deny;syncBuiltinESMExports();globalThis.fetch=deny;globalThis.setTimeout=deny;const module=await import(${JSON.stringify(target)});await assert.rejects(()=>module.localLearningWorkflow({}),/local-workflow-options-refused/);assert.equal(called,0);console.log(JSON.stringify({effects:called}));`;
  const result=await promisify(execFile)(process.execPath,['--input-type=module','-e',source],{cwd:owned,env:{PATH:path.dirname(process.execPath),HOME:owned,TMPDIR:owned},shell:false,timeout:10000,maxBuffer:8192});
  assert.equal(result.stderr,'');assert.deepEqual(JSON.parse(result.stdout),{effects:0});
 }finally{await rm(owned,{recursive:true,force:true});}
});
