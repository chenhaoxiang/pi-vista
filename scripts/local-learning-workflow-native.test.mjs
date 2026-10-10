import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,copyFile,cp,rm} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {ROOT,npmCli,npmFlags} from './release-utils.mjs';

const exec=promisify(execFile);
const hashBlob=bytes=>createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');

async function nativeWorkflowFixture(missingReference=false){
 const parent=path.join(ROOT,'tmp/local-workflow-native');await mkdir(parent,{recursive:true});const owned=await mkdtemp(path.join(parent,'case-'));
 const checkout=path.join(owned,'fixture-source');await mkdir(checkout);
 const run=(file,args,cwd=checkout,extra={})=>exec(file,args,{cwd,env:{...process.env,...extra},shell:false,timeout:300000,maxBuffer:32*1024*1024});
 const git=async args=>(await run('git',['-C',checkout,...args])).stdout.trim();
 try{
  const archive=path.join(owned,'source.tar');await run('git',['-C',ROOT,'archive','--format=tar',`--output=${archive}`,'HEAD']);await run('tar',['-xf',archive,'-C',checkout]);
  // Only these current new operator/helper bytes overlay the immutable delivered
  // source. Do not copy this test into the fixture: no recursive runner graph.
  for(const file of ['guidance-acceptance-io.mjs','hindsight-guidance-acceptance.mjs','guidance-trial-policy.mjs','local-learning-workflow.mjs'])await copyFile(path.join(ROOT,'scripts',file),path.join(checkout,'scripts',file));
  const temp=path.join(checkout,'tmp');await mkdir(temp,{mode:0o700});
  // A deliberately small synthetic HOST PLAN, not recursive execution of all
  // pre-existing source tests. Target repository gates/assertions stay untouched
  // and are run by the OUTER gate. This fixture still builds the real packages,
  // installs their real tarballs and executes real native LOCAL API assertions.
  const fixtureTests=`import test from 'node:test';import assert from 'node:assert/strict';import {createLocalEvidenceVerifier} from '@pi-vista/evidence/host';import {createLocalLearningLibrary} from '@pi-vista/learning/local';import {createLearningLibrary} from '@pi-vista/learning';
function factory(){let calls=0;const verifier=createLocalEvidenceVerifier({mode:'local-host',scope:'native-fixture-scope',gate_checks:['fixture-build'],gate_version:'b'.repeat(40),gate_config_digest:'c'.repeat(64),test_suites:['fixture-cases'],now:Date.now,sources:['gate','test','guard'].map(kind=>({subject:kind,kind,producer:'fixture-host',collect:async()=>{calls++;throw Error('not expected');}}))});return {verifier,library:createLocalLearningLibrary({mode:'local-learning',scope:'native-fixture-scope',verifier}),calls:()=>calls};}
test('native fixture real LOCAL construction is opt-in without callbacks',()=>{const f=factory();assert.equal(f.calls(),0);assert.equal(typeof f.library.prepareGuidance,'function');f.library.shutdown();f.verifier.shutdown();});
test('native fixture real root keeps its signed verifier domain',()=>{const f=factory();assert.throws(()=>createLearningLibrary({verifier:f.verifier}));assert.equal(f.calls(),0);f.library.shutdown();f.verifier.shutdown();});\n`;
  await writeFile(path.join(checkout,'scripts/fixture-native-source.mjs'),fixtureTests);
  await writeFile(path.join(checkout,'scripts/source-gate.mjs'),`import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {ROOT,npmCli,npmFlags,createRunDirectory,commandEnvironment} from './release-utils.mjs';
const directory=await createRunDirectory('source');await promisify(execFile)(process.execPath,[await npmCli(),'run','build',...npmFlags(directory,false)],{cwd:ROOT,env:commandEnvironment(),shell:false,timeout:120000,maxBuffer:1048576});
const native=path.join(ROOT,'packages/learning/dist-test');await mkdir(native,{recursive:true});await copyFile(path.join(ROOT,'scripts/fixture-native-source.mjs'),path.join(native,'fixture-native.test.js'));await writeFile(path.join(directory,'report.json'),JSON.stringify({status:'passed',network:false,node:process.version,scope:'synthetic-native-compiler-contract',not_full_source_evidence:true}));console.log('Source evidence: '+directory);\n`);
  // No warm registry packument assumption: install REAL runtime tarballs only,
  // use the already source-locked compiler/types explicitly for this FIXTURE.
  // The outer unchanged consumer gate still installs/verifies its own compiler.
  await writeFile(path.join(checkout,'scripts/packed-consumer.mjs'),`import assert from 'node:assert/strict';import {mkdir,writeFile,readFile,realpath} from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {ROOT,npmCli,npmFlags,createRunDirectory,discoverPackages,publicEntrypoints,commandEnvironment} from './release-utils.mjs';
const run=promisify(execFile),directory=await createRunDirectory('consumer'),tarDir=path.join(directory,'tarballs'),consumer=path.join(directory,'installed-fixture-consumer');await mkdir(tarDir);await mkdir(consumer);const npm=await npmCli(),flags=npmFlags(directory,false),packages=await discoverPackages(),tarballs=[],entries=[];
for(const pkg of packages){const p=await run(process.execPath,[npm,'pack','--workspace='+pkg.manifest.name,'--json','--pack-destination='+tarDir,...flags],{cwd:ROOT,env:commandEnvironment(),shell:false,timeout:120000,maxBuffer:1048576});const m=JSON.parse(p.stdout)[0];assert.equal(m.name,pkg.manifest.name);tarballs.push(path.join(tarDir,m.filename));entries.push(...publicEntrypoints(pkg.manifest));}
await writeFile(path.join(consumer,'package.json'),JSON.stringify({name:'native-fixture-tarball-consumer',version:'0.0.0',private:true,type:'module'}));await run(process.execPath,[npm,'install','--workspaces=false','--omit=dev','--save-exact',...flags,...tarballs],{cwd:consumer,env:commandEnvironment(),shell:false,timeout:120000,maxBuffer:1048576});
const sourceCompiler=path.join(ROOT,'node_modules/typescript/bin/tsc'),lock=JSON.parse(await readFile(path.join(ROOT,'package-lock.json'),'utf8')),compiler=JSON.parse(await readFile(path.join(ROOT,'node_modules/typescript/package.json'),'utf8'));assert.equal(compiler.version,lock.packages['node_modules/typescript'].version);
const imports=entries.map((e,i)=>'import * as value'+i+' from '+JSON.stringify(e.specifier)+';').join('\\n');await writeFile(path.join(consumer,'consumer.mts'),imports+'\\nexport const namespaces=['+entries.map((_,i)=>'value'+i).join(',')+'];\\n');await writeFile(path.join(consumer,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,skipLibCheck:false,types:['node'],typeRoots:[path.join(ROOT,'node_modules/@types')],outDir:'dist'},include:['consumer.mts']}));await run(process.execPath,[sourceCompiler,'-p','tsconfig.json'],{cwd:consumer,env:commandEnvironment(),shell:false,timeout:120000,maxBuffer:1048576});
await run(process.execPath,['--input-type=module','-e','const {namespaces}=await import(\"./dist/consumer.mjs\");if(namespaces.length!=='+entries.length+')throw Error(\"fixture imports missing\");'],{cwd:consumer,env:commandEnvironment(),shell:false,timeout:30000,maxBuffer:1048576});await writeFile(path.join(directory,'report.json'),JSON.stringify({status:'passed',network:false,node:process.version,scope:'synthetic-real-tarballs-source-locked-compiler',not_full_consumer_evidence:true,packages:packages.map(p=>p.manifest.name),exports:entries.map(e=>e.specifier)}));console.log('Packed-consumer evidence: '+directory);\n`);
  const config=path.join(temp,'synthetic-config.json'),fingerprint=path.join(temp,'synthetic-service.json'),stateFile=path.join(temp,'http-state.json');
  await writeFile(config,JSON.stringify({apiUrl:'http://127.0.0.1:8888',apiToken:'synthetic-fixture-bearer'}),{mode:0o600});
  const files=[];
  for(const relative of ['api/http.py','engine/memory_engine.py','config.py','main.py','server.py']){
   const file=path.join(temp,'synthetic-service/hindsight_api',relative);await mkdir(path.dirname(file),{recursive:true});const bytes=Buffer.from('synthetic fixture service\n');await writeFile(file,bytes);files.push({relative,path:file,git_blob:hashBlob(bytes)});
  }
  await writeFile(fingerprint,JSON.stringify({endpoint:'http://127.0.0.1:8888',bank:'pi-vista-local-test-01a114ab',api_version:'0.10.2',files}),{mode:0o600});
  await writeFile(stateFile,JSON.stringify({documents:{},retains:0,recalls:0,config:0,originals:0,realNetwork:0}),{mode:0o600});
  const loader=path.join(temp,'fixture-fetch.mjs');
  await writeFile(loader,`import {readFileSync,writeFileSync} from 'node:fs';
const file=${JSON.stringify(stateFile)};const state=()=>JSON.parse(readFileSync(file,'utf8'));const save=v=>writeFileSync(file,JSON.stringify(v));
globalThis.fetch=async(url,init={})=>{const s=state(),target=new URL(url),prefix='/v1/default/banks/pi-vista-local-test-01a114ab/';
 if(target.origin!=='http://127.0.0.1:8888')throw Error('fixture refuses real network');
 if(target.pathname==='/openapi.json')return new Response(JSON.stringify({info:{version:'0.10.2'}}));
 if(!target.pathname.startsWith(prefix))throw Error('fixture refuses other bank');const route=target.pathname.slice(prefix.length);
 if(route==='config'){s.config++;save(s);return new Response(JSON.stringify({bank_id:'pi-vista-local-test-01a114ab',config:{retain_extraction_mode:'chunks',enable_observations:false,retain_default_strategy:null},overrides:{retain_extraction_mode:'chunks'}}));}
 if(route.startsWith('documents/')){s.originals++;save(s);const id=route.slice('documents/'.length),text=s.documents[id];return new Response(JSON.stringify(text===undefined?{}:{id,bank_id:'pi-vista-local-test-01a114ab',original_text:text,content_hash:null,created_at:'fixture-time',updated_at:'fixture-time',memory_unit_count:1}),{status:text===undefined?404:200});}
 if(route==='memories'&&init.method==='POST'){s.retains++;const body=JSON.parse(init.body);for(const item of body.items)s.documents[item.document_id]=item.content;save(s);return new Response(JSON.stringify({success:true,bank_id:'pi-vista-local-test-01a114ab',items_count:1,async:false}));}
 if(route==='memories/recall'&&init.method==='POST'){s.recalls++;save(s);return new Response(JSON.stringify({results:Object.keys(s.documents).map(document_id=>({id:'fixture-world',text:'not a context source',document_id}))}));}
 throw Error('fixture refuses other route');};\n`);
  await git(['init','--quiet']);await git(['config','user.name','Synthetic Fixture']);await git(['config','user.email','fixture@example.invalid']);
  await git(['add','--','.gitignore','.github','AGENTS.md','README.md','LICENSE','package.json','package-lock.json','tsconfig.base.json','tsconfig.integration.json','packages','scripts','tests','docs','openspec']);
  await git(['-c','core.hooksPath=/dev/null','commit','--quiet','-m','synthetic LOCAL fixture']);const source=await git(['rev-parse','HEAD']);
  await run(process.execPath,[await npmCli(),'ci',...npmFlags(owned,false)]);
  // A malicious ignored module must never be imported by operator startup.
  const marker=path.join(temp,'stale-core-imported');await mkdir(path.join(checkout,'packages/core/dist'),{recursive:true});await writeFile(path.join(checkout,'packages/core/dist/index.js'),`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'stale ignored output');throw Error('stale module executed');`);
  await assert.rejects(()=>run(process.execPath,['--import',loader,path.join(checkout,'scripts/local-learning-workflow.mjs'),'--phase=write',`--source-sha=${'b'.repeat(40)}`,'--namespace=fixture-local-native',`--credential-config=${config}`,`--service-fingerprint=${fingerprint}`,'--deadline-ms=240000','--timeout-ms=10000','--allow-bank-write']),e=>e.stderr.trim()==='local-workflow-source-drift');
  assert.equal(JSON.parse(await readFile(stateFile,'utf8')).retains,0);await assert.rejects(()=>readFile(marker));
  const invoke=async phase=>{
   let output;try{output=await run(process.execPath,['--import',loader,path.join(checkout,'scripts/local-learning-workflow.mjs'),`--phase=${phase}`,`--source-sha=${source}`,'--namespace=fixture-local-native',`--credential-config=${config}`,`--service-fingerprint=${fingerprint}`,'--deadline-ms=240000','--timeout-ms=10000',phase==='write'?'--allow-bank-write':'--allow-bank-read',...(phase==='read'?['--inject-read-fault']:[])]);}
   catch(error){
    const evidence=await mkdtemp(path.join(parent,'failure-evidence-'));
    await cp(path.join(temp,'local-learning-workflow'),path.join(evidence,'workflow'),{recursive:true});
    await cp(path.join(temp,'release-contract'),path.join(evidence,'release-contract'),{recursive:true});
    await writeFile(path.join(evidence,'child-output.log'),`${error.stdout??''}\n${error.stderr??''}`);
    const failure=JSON.parse(await readFile(path.join(temp,'local-learning-workflow/fixture-local-native',phase+'-report.json'),'utf8'));
    throw Error(`fixture operator ${phase} failed: ${failure.failure}; preserved ${evidence}`);
   }
   assert.equal(output.stderr,'');const report=JSON.parse(await readFile(path.join(temp,'local-learning-workflow/fixture-local-native',phase+'-report.json'),'utf8'));assert.equal(report.status,'passed');return report;
  };
  const write=await invoke('write');
  if(missingReference)await rm(path.join(temp,'local-learning-workflow/fixture-local-native/historical-reference.json'));
  const read=await invoke('read');assert.notEqual(write.pid,read.pid);await assert.rejects(()=>readFile(marker));
  if(missingReference)assert.equal(read.missingReferenceRecoveredReadOnly,true);
  assert.equal(write.oneShotPersisted,true);assert.equal(write.retainCount,1);assert.equal(write.deprecationInvalidatesSelection,true);
  assert.equal(read.retainCount,0);assert.equal(read.clientReadFaultRecoveredReadOnly,true);assert.equal(read.injectedReadFailed,'sink-failed');assert.equal(read.recallContainsOwnDocument,true);
  assert.equal(read.historyImportedObserved,true);assert.equal(read.historyCannotRestoreCurrentProof,true);assert.equal(read.freshReadRunVerification,true);assert.equal(read.currentContextItems,1);assert.equal(read.rejectionInvalidatesSelection,true);
  assert.equal(write.clientArtifactIdentity.sha256,read.clientArtifactIdentity.sha256);assert.equal(write.trialPolicy.policy_digest,read.trialPolicy.policy_digest);assert.equal(write.trialPolicy.client_artifact_sha256,write.clientArtifactIdentity.sha256);assert.equal(write.safeDocumentSHA256,read.safeDocumentSHA256);
  assert.ok(write.clientArtifactIdentity.files.some(x=>x.path==='scripts/local-host-acceptance.mjs'));
  assert.equal(write.guard.coverage,'complete');assert.equal(write.guard.event_count,6);assert.equal(read.guard.event_count,6);assert.equal(write.nativeSuite.total,2);assert.equal(write.nativeSuite.name,'learning-native');
  assert.equal(read.currentVerificationAfterShutdown,'not-current');assert.equal(read.authorization,'none');assert.equal(read.executable,false);assert.equal(read.defaultActivation,false);
  const state=JSON.parse(await readFile(stateFile,'utf8'));assert.equal(state.retains,1);assert.equal(Object.keys(state.documents).length,1);assert.equal(state.realNetwork,0);
  // Policy admission and source SHA remain exact even though each process
  // independently rebuilds and collects its own current host evidence.
  assert.equal(write.source_sha,source);assert.equal(read.source_sha,source);assert.equal(read.bankModeUnchanged,true);
 }finally{await rm(owned,{recursive:true,force:true});}
}
test('LOCAL actual compiled source/operator native write+independent read composes fresh proof and readonly recovery with zero real network',{timeout:600000},()=>nativeWorkflowFixture());
test('LOCAL missing saved reference plus read fault composes only readonly recovery',{timeout:600000},()=>nativeWorkflowFixture(true));
