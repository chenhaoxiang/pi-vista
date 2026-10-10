import {strict as assert} from 'node:assert';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify,types} from 'node:util';
import {ROOT,commandEnvironment,isMain,listFiles,parseOptions,readJson} from './release-utils.mjs';
import {prepareGuidanceClient,readGuidanceMetadata,readGuidanceBankPreflight,bufferGuidanceBankPreflight} from './guidance-acceptance-io.mjs';
import {readGuidanceCredential,checkGuidanceServiceFingerprint} from './hindsight-guidance-acceptance.mjs';
import {bindGuidanceTrialPolicy} from './guidance-trial-policy.mjs';
import {validateCaseCounts} from './run-tests.mjs';

const exec=promisify(execFile),ENDPOINT='http://127.0.0.1:8888',BANK='pi-vista-local-test-01a114ab',ALIAS='stage5-isolated-test';
const SCOPE='fixed-local-learning-command-plan-v1',POLICY='local-learning-workflow-v1';
const PLAN=Object.freeze(['source-contract','learning-native','packed-consumer-contract']);
const hash=value=>createHash('sha256').update(value).digest('hex');
const refused=()=>{throw Error('local-workflow-options-refused');};
export function localWorkflowOptions(args){
 let c;try{c=parseOptions(args,['phase','source-sha','namespace','credential-config','service-fingerprint','deadline-ms','timeout-ms'],['allow-bank-write','allow-bank-read','inject-read-fault']);}catch{refused();}delete c.network;
 if(!['write','read'].includes(c.phase)||typeof c['source-sha']!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(c['source-sha'])||
  typeof c.namespace!=='string'||!/^[a-z][a-z0-9-]{0,47}$/.test(c.namespace)||
  ['credential-config','service-fingerprint'].some(k=>typeof c[k]!=='string'||!path.isAbsolute(c[k])||path.normalize(c[k])!==c[k]||/[\x00-\x1f\x7f]/.test(c[k]))||
  !/^[1-9][0-9]{0,6}$/.test(c['deadline-ms']??'')||!/^[1-9][0-9]{0,5}$/.test(c['timeout-ms']??''))refused();
 const deadline=Number(c['deadline-ms']),timeout=Number(c['timeout-ms']);
 if(deadline<1000||deadline>1200000||timeout>180000||timeout>=deadline)refused();
 if(c.phase==='write'&&(c['allow-bank-write']!==true||c['allow-bank-read']!==undefined||c['inject-read-fault']!==undefined)||
  c.phase==='read'&&(c['allow-bank-read']!==true||c['allow-bank-write']!==undefined))refused();
 return Object.freeze({phase:c.phase,source_sha:c['source-sha'],namespace:c.namespace,credential_config:c['credential-config'],service_fingerprint:c['service-fingerprint'],
  deadline_ms:deadline,timeout_ms:timeout,read_fault:c['inject-read-fault']===true});
}
function options(input){
 const keys=['phase','source_sha','namespace','credential_config','service_fingerprint','deadline_ms','timeout_ms','read_fault'];
 if(types.isProxy(input)||input===null||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Reflect.ownKeys(input).length!==keys.length)refused();
 const v=Object.create(null);for(const k of keys){const d=Object.getOwnPropertyDescriptor(input,k);if(!d||!Object.hasOwn(d,'value'))refused();v[k]=d.value;}
 if(['phase','source_sha','namespace','credential_config','service_fingerprint'].some(k=>typeof v[k]!=='string')||!Number.isSafeInteger(v.deadline_ms)||!Number.isSafeInteger(v.timeout_ms)||typeof v.read_fault!=='boolean')refused();
 return localWorkflowOptions([`--phase=${v.phase}`,`--source-sha=${v.source_sha}`,`--namespace=${v.namespace}`,`--credential-config=${v.credential_config}`,`--service-fingerprint=${v.service_fingerprint}`,
  `--deadline-ms=${v.deadline_ms}`,`--timeout-ms=${v.timeout_ms}`,v.phase==='write'?'--allow-bank-write':'--allow-bank-read',...(v.read_fault?['--inject-read-fault']:[])]);
}
export function workflowNativeSuite(value,files){
 validateCaseCounts(value,files);const c=value.counts;if(c.skipped||c.todo)throw Error('local-workflow-native-nonpass');
 return Object.freeze({name:'learning-native',total:c.tests,passed:c.passed,failed:c.failed,cancelled:c.cancelled,skipped:c.skipped,todo:c.todo});
}
export function workflowObservation(source,namespace,env){
 if(typeof source!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(source)||typeof namespace!=='string'||!/^[a-z][a-z0-9-]{0,47}$/.test(namespace)||typeof env!=='string'||!/^[a-f0-9]{64}$/.test(env))refused();
 return {experience_id:`workflow-${namespace}`,run_id:`workflow-${namespace}-write`,repo:'pi-vista',source_sha:source,policy_version:POLICY,env_fingerprint:env,task_type:'metadata-validation',ts:1000,
  script:{task_type:'metadata-validation',description:'The synthetic Fixture Metadata Checker validates fresh source-archive metadata before reusing historical guidance.',preconditions:['source-bound'],steps:['inspect-metadata'],postconditions:['metadata-observed'],known_failures:[{symptom:'stale-compiled-output',mitigation:'fresh-source-archive-build'}],applicable_to:[]},
  steps:[{step_id:`workflow-${namespace}-write_s0`,tool:'metadata-reader',action_description:'Validate synthetic Fixture Metadata Checker metadata with current source-identity and environment bindings.',check_fn_ids:[],expected_result:'observed',on_failure:'stop',depends_on:[]}]};
}
async function privateHistory(file){
 const before=await lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.uid!==process.getuid()||(before.mode&0o7777)!==0o600||before.nlink!==1||before.size>65536)throw Error('local-workflow-history-refused');
 const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const first=await fd.stat(),bytes=await fd.readFile(),after=await fd.stat(),named=await lstat(file);
  if(first.ino!==before.ino||first.dev!==before.dev||['ino','dev','size','mtimeMs','ctimeMs','mode','uid','nlink'].some(k=>after[k]!==first[k])||named.ino!==first.ino||named.dev!==first.dev||bytes.length!==first.size)throw Error('local-workflow-history-refused');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }finally{await fd.close();}
}
async function directory(parent,name){const dir=path.join(parent,name);await mkdir(dir,{recursive:true,mode:0o700});const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid())throw Error('local-workflow-directory-refused');return dir;}

/** Effectful explicit fixed plan. Ordinary imports/tests do not invoke this entry. */
export async function localLearningWorkflow(input){
 const c=options(input),end=performance.now()+c.deadline_ms,env=commandEnvironment();
 const remaining=()=>{const n=Math.floor(end-performance.now());if(n<=0)throw Error('local-workflow-deadline-exceeded');return n;};
 const git=async args=>(await exec('git',['-C',ROOT,...args],{cwd:ROOT,env,shell:false,timeout:Math.min(30000,remaining()),maxBuffer:1048576})).stdout.trim();
 if(await git(['rev-parse','HEAD'])!==c.source_sha||await git(['status','--porcelain','--untracked-files=normal']))throw Error('local-workflow-source-drift');
 const client=await prepareGuidanceClient(c.source_sha,true);let verifier,library;
 const actualFetch=globalThis.fetch;let dir=ROOT;
 try{
 if(!client.core.isSafeSegment(c.namespace)||client.core.hasKnownCredential(c.namespace))refused();
 for(const part of ['tmp','local-learning-workflow',c.namespace])dir=await directory(dir,part);
 const reportFile=path.join(dir,`${c.phase}-report.json`),historyFile=path.join(dir,'historical-reference.json'),journal=path.join(dir,'journal');
 try{await lstat(reportFile);throw Error('local-workflow-phase-already-recorded');}catch(e){if(e.code!=='ENOENT')throw e;}
 const report={schema:1,mode:'local-learning',phase:c.phase,pid:process.pid,node:process.version,source_sha:c.source_sha,namespace:c.namespace,bank:BANK,status:'failed',
  scope:SCOPE,guardCoverage:'fixed host command admissions only',authorization:'none',executable:false,defaultActivation:false,current_verification:'not-checked',
  mainBankRequests:0,clientArtifactIdentity:client.identity,http:[],credentialValueProjected:false,sharedServiceRestart:false,bankConfigChanged:false};
 try{
  const nativeDir=await mkdtemp(path.join(dir,'native-')),temp=await directory(nativeDir,'process-tmp'),ledger=client.plan.createHostPlanLedger(PLAN);
  const admitted=async(name,args,extra={})=>{ledger.admit(name);try{
   const result=await exec(process.execPath,args,{cwd:ROOT,env:{...env,...extra,TMPDIR:temp},shell:false,timeout:remaining(),maxBuffer:32*1024*1024,killSignal:'SIGKILL'});
   await writeFile(path.join(nativeDir,name+'.log'),`exit:0\n${result.stdout}\n${result.stderr}`,{flag:'wx',mode:0o600});ledger.settle(name,true);return result;
  }catch(e){ledger.settle(name,false);await writeFile(path.join(nativeDir,name+'.log'),`exit:${Number.isSafeInteger(e.code)?e.code:'unknown'}\n${e.stdout??''}\n${e.stderr??''}`,{flag:'wx',mode:0o600});throw Error('local-workflow-command-failed');}};
  const reportFrom=async(result,prefix,pattern)=>{const lines=result.stdout.split(/\r?\n/).filter(x=>x.startsWith(prefix));if(lines.length!==1)throw Error('local-workflow-command-report-refused');
   const owned=lines[0].slice(prefix.length);if(path.dirname(owned)!==path.join(ROOT,'tmp/release-contract')||!pattern.test(path.basename(owned)))throw Error('local-workflow-command-report-refused');
   const value=await readJson(path.join(owned,'report.json'));if(value.status!=='passed'||value.network!==false||value.node!==process.version)throw Error('local-workflow-command-report-refused');return {path:path.relative(ROOT,owned),value};};
  const source=await reportFrom(await admitted(PLAN[0],[path.join(ROOT,'scripts/source-gate.mjs')]),'Source evidence: ',/^source-[A-Za-z0-9_-]+$/);
  const files=(await listFiles(path.join(ROOT,'packages/learning/dist-test'))).filter(x=>x.endsWith('.test.js')).map(x=>path.join(ROOT,'packages/learning/dist-test',x));
  const countsFile=path.join(nativeDir,'native-counts.json');await admitted(PLAN[1],['--test',`--test-reporter=${path.join(ROOT,'scripts/test-count-reporter.mjs')}`,...files],{PI_VISTA_TEST_COUNT_FILE:countsFile,PI_VISTA_TEST_FILES:JSON.stringify(files)});
  const suite=workflowNativeSuite(await readJson(countsFile),files);
  const consumer=await reportFrom(await admitted(PLAN[2],[path.join(ROOT,'scripts/packed-consumer.mjs')]),'Packed-consumer evidence: ',/^consumer-[A-Za-z0-9_-]+$/);
  await client.check();remaining();
  const envFingerprint=hash(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,scope:SCOPE,plan:PLAN}));
  const raw=workflowObservation(c.source_sha,c.namespace,envFingerprint),expected={run_id:c.phase==='write'?raw.run_id:`workflow-${c.namespace}-read`,repo:raw.repo,source_sha:raw.source_sha,policy_version:POLICY,env_fingerprint:envFingerprint};
  const stamp=Date.now(),configDigest=hash(JSON.stringify({scope:SCOPE,plan:PLAN,policy:POLICY,suite:suite.name}));
  const observations=Object.fromEntries(['gate','test','guard'].map(kind=>[kind,{schema:1,scope:SCOPE,kind,producer:`local-workflow-${kind}`,...expected,result_ref:`${c.namespace}-${c.phase}-${kind}`,observed_at:stamp,expires_at:stamp+300000,
   details:kind==='gate'?{verdict:'pass',gate_version:c.source_sha,config_digest:configDigest,checks:[{name:PLAN[0],outcome:'pass'},{name:PLAN[2],outcome:'pass'},{name:'source-identity',outcome:'pass'}]}:kind==='test'?{suites:[suite]}:ledger.details()}]));
  verifier=client.host.createLocalEvidenceVerifier({mode:'local-host',scope:SCOPE,sources:['gate','test','guard'].map(kind=>({subject:kind,kind,producer:`local-workflow-${kind}`,collect:async()=>{await client.check();return observations[kind];}})),
   gate_checks:[PLAN[0],PLAN[2],'source-identity'],gate_version:c.source_sha,gate_config_digest:configDigest,test_suites:[suite.name],now:Date.now,max_age_ms:300000,timeout_ms:10000});
  Object.assign(report,{expected,nativeSuite:suite,guard:ledger.details(),sourceReport:source.path,consumerReport:consumer.path,nativeEvidenceDirectory:path.relative(ROOT,nativeDir)});
  report.serviceFingerprint=await checkGuidanceServiceFingerprint(c.service_fingerprint);await readGuidanceMetadata(await actualFetch(ENDPOINT+'/openapi.json',{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)}));
  const token=await readGuidanceCredential(c.credential_config);let baseline,faultInjected=false,faultArmed=false;
  const scopedFetch=async(url,init)=>{
   if(typeof url!=='string'||!init)throw Error('local-workflow-network-scope-refused');const target=new URL(url),prefix=`/v1/default/banks/${BANK}/`,route=target.pathname.slice(prefix.length);
   const original=/^documents\/vista-guidance-v1-[a-f0-9]{16}-[a-f0-9]{64}$/.test(route);
   if(target.origin!==ENDPOINT||!target.pathname.startsWith(prefix)||target.search||target.hash||!(init.method==='GET'&&(route==='config'||original)||init.method==='POST'&&['memories','memories/recall'].includes(route)))throw Error('local-workflow-network-scope-refused');
   if(route==='memories'&&(c.phase!=='write'||report.http.some(x=>x.route==='memories')))throw Error('local-workflow-repeat-retain-refused');
   const record={method:init.method,route:original?'original-document':route,status:null};report.http.push(record);const response=await actualFetch(url,init);record.status=response.status;
   if(route==='config'){const buffered=await bufferGuidanceBankPreflight(response);if(baseline&&baseline.bank_state_sha256!==buffered.state.bank_state_sha256){await buffered.response.body?.cancel();throw Error('local-workflow-bank-state-drift');}return buffered.response;}
   if(c.read_fault&&faultArmed&&original&&response.status===200&&!faultInjected){faultInjected=true;record.deliveredStatus=503;record.fault='client-injected-after-real-read-success';await response.body?.cancel();return new Response('{}',{status:503});}
   return response;
  };
  const bankState=async()=>readGuidanceBankPreflight(await scopedFetch(ENDPOINT+`/v1/default/banks/${BANK}/config`,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)}));
  baseline=await bankState();report.bankPreflight=baseline;report.trialPolicy=await bindGuidanceTrialPolicy(dir,c.phase,{source_sha:c.source_sha,namespace:c.namespace,bank:baseline},client.identity.sha256);
  if(c.phase==='write')await mkdir(journal,{mode:0o700});
  globalThis.fetch=scopedFetch;const store=client.guidance.createHindsightGuidanceStore({mode:'local-guidance',endpoint:ENDPOINT,banks:{[ALIAS]:BANK},journal_directory:journal,bearer_token:token,allow_loopback_http:true,timeout_ms:c.timeout_ms});globalThis.fetch=actualFetch;
  library=client.local.createLocalLearningLibrary({mode:'local-learning',scope:SCOPE,verifier,store,timeout_ms:c.timeout_ms});
  const document=client.guidance.prepareHistoricalGuidance(raw),request=client.data.writeRequest(ALIAS,document),ref=client.data.reference(ALIAS,client.data.documentId(request,client.target.targetFingerprint(ENDPOINT,ALIAS,BANK)));
  const query={repo:raw.repo,source_sha:raw.source_sha,policy_version:raw.policy_version,env_fingerprint:raw.env_fingerprint,task_type:raw.task_type},subjects={gate:'gate',test:'test',guard:'guard'};
  if(c.phase==='write'){
   const candidate=library.nominate(library.observe(raw)),proof=await verifier.verify(expected,subjects),verified=library.verifyCandidate(candidate,proof),preview=library.prepareGuidance(verified,ALIAS);
   assert.equal(preview.document.content,document.content);const persisted=await library.commitGuidance(preview,{preview_digest:preview.preview_digest});assert.equal(persisted.status,'persisted');
   const history=await library.readGuidance(persisted.persistence);assert.equal(history.document.content,document.content);
   const selection=library.retrieve([persisted],query);assert.equal(library.compileContext(selection).item_count,1);
   const copyProbe=await verifier.verify(expected,subjects);assert.equal(verifier.isCurrent(copyProbe,expected),true);assert.equal(verifier.isCurrent(JSON.parse(JSON.stringify(copyProbe)),expected),false);
   await writeFile(historyFile,JSON.stringify({reference:persisted.persistence,content_digest:document.content_digest,handle_projection:persisted,proof_projection:copyProbe,preview_projection:preview,snapshotWasCurrentBeforeSerialization:true},null,2)+'\n',{flag:'wx',mode:0o600});
   library.deprecate(persisted);assert.throws(()=>library.compileContext(selection));
   Object.assign(report,{candidateVerified:true,exactPreviewConfirmed:true,oneShotPersisted:true,exactOriginalReadback:true,currentContextItems:1,deprecationInvalidatesSelection:true,reference:persisted.persistence});
  }else{
   let saved;try{saved=await privateHistory(historyFile);}catch(e){if(e.code!=='ENOENT')throw e;const r=await library.reconcileGuidance(ALIAS,document);assert.equal(r.state,'matched');saved={reference:ref,content_digest:document.content_digest};report.missingReferenceRecoveredReadOnly=true;}
   faultArmed=true;
   let history;try{history=await library.readGuidance(saved.reference);}catch(e){if(!c.read_fault||!faultInjected||e.code!=='sink-failed')throw e;report.injectedReadFailed=e.code;const r=await library.reconcileGuidance(ALIAS,document);assert.equal(r.state,'matched');history=await library.readGuidance(saved.reference);report.clientReadFaultRecoveredReadOnly=true;}
   assert.equal(history.document.content,document.content);assert.equal(history.content_digest,saved.content_digest);assert.equal((await library.reconcileGuidance(ALIAS,document)).state,'matched');
   const rows=await library.recallGuidance(ALIAS,query);assert.ok(rows.some(r=>r.document_id===ref.document_id));
   const imported=library.importGuidance(history,{...expected,experience_id:`reused-${c.namespace}`,ts:Date.now()});assert.equal(imported.status,'observed');assert.equal(imported.verification,undefined);assert.equal(library.retrieve([imported],query).handles.length,0);
   const candidate=library.nominate(imported);if(saved.proof_projection){assert.equal(verifier.isCurrent(saved.proof_projection,expected),false);assert.throws(()=>library.verifyCandidate(candidate,saved.proof_projection));assert.throws(()=>library.nominate(saved.handle_projection));await assert.rejects(()=>library.commitGuidance(saved.preview_projection,{preview_digest:saved.preview_projection.preview_digest}));}
   const proof=await verifier.verify(expected,subjects),verified=library.verifyCandidate(candidate,proof),selection=library.retrieve([verified],query),context=library.compileContext(selection);assert.equal(context.item_count,1);
   library.reject(verified);assert.throws(()=>library.compileContext(selection));
   Object.assign(report,{restartedOriginalReadback:true,readOnlyReconciliationMatched:true,recallOwnReferenceCount:rows.length,recallContainsOwnDocument:true,historyImportedObserved:true,historyCannotRestoreCurrentProof:true,
    freshReadRunVerification:true,currentContextItems:context.item_count,rejectionInvalidatesSelection:true,reference:saved.reference});
  }
  assert.deepEqual(await bankState(),baseline);assert.deepEqual(await checkGuidanceServiceFingerprint(c.service_fingerprint),report.serviceFingerprint);
  assert.deepEqual(await bindGuidanceTrialPolicy(dir,'read',{source_sha:c.source_sha,namespace:c.namespace,bank:baseline},client.identity.sha256),report.trialPolicy);await client.check();remaining();
  library.shutdown();verifier.shutdown();Object.assign(report,{status:'passed',retainCount:report.http.filter(x=>x.route==='memories').length,recallCount:report.http.filter(x=>x.route==='memories/recall').length,
   currentVerificationAfterShutdown:'not-current',safeDocumentSHA256:document.content_digest,historyOnly:true,bankModeUnchanged:true,sourceArtifactRechecked:true});
 }catch(e){report.failure=typeof e?.code==='string'&&/^(?:sink-|invalid-|unverified-|promotion-|stale-)[a-z-]+$/.test(e.code)?e.code:typeof e?.message==='string'&&/^(?:local-workflow|guidance)-[a-z-]+$/.test(e.message)?e.message:'local-workflow-acceptance-failed';process.exitCode=1;}
 finally{globalThis.fetch=actualFetch;library?.shutdown();verifier?.shutdown();await writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
 return reportFile;
 }finally{globalThis.fetch=actualFetch;library?.shutdown();verifier?.shutdown();await client.close();}
}
if(isMain(import.meta.url)){
 try{console.log(`Local learning workflow: ${await localLearningWorkflow(localWorkflowOptions(process.argv.slice(2)))}`);}
 catch(e){console.error(typeof e?.message==='string'&&/^(?:local-workflow|guidance)-[a-z-]+$/.test(e.message)?e.message:'local-workflow-acceptance-failed');process.exitCode=1;}
}
