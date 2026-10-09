import {strict as assert} from 'node:assert';
import {constants} from 'node:fs';
import {lstat,open,mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify,types} from 'node:util';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT,isMain,parseOptions,commandEnvironment} from './release-utils.mjs';
import {prepareGuidanceClient,readGuidanceMetadata} from './guidance-acceptance-io.mjs';

const exec=promisify(execFile),ENDPOINT='http://127.0.0.1:8888',BANK='pi-vista-local-test-01a114ab';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function guidanceAcceptanceOptions(args){
 const raw=parseOptions(args,['phase','source-sha','namespace','credential-config','service-fingerprint','timeout-ms'],['allow-bank-write','allow-bank-read','inject-lost-ack']);delete raw.network;
 // Closed CLI namespace syntax before loading any compiled workspace code.
 // The freshly source-bound core validators additionally check it before effects.
 const safe=s=>typeof s==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(s);
 if(!['write','read'].includes(raw.phase)||typeof raw['source-sha']!=='string'||!(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).test(raw['source-sha'])||!safe(raw.namespace)||
  typeof raw['credential-config']!=='string'||!path.isAbsolute(raw['credential-config'])||path.normalize(raw['credential-config'])!==raw['credential-config']||/[\x00-\x1f\x7f]/.test(raw['credential-config'])||
  typeof raw['service-fingerprint']!=='string'||!path.isAbsolute(raw['service-fingerprint'])||path.normalize(raw['service-fingerprint'])!==raw['service-fingerprint']||/[\x00-\x1f\x7f]/.test(raw['service-fingerprint'])||
  !/^[1-9][0-9]{0,5}$/.test(raw['timeout-ms']??''))throw Error('guidance-explicit-options-required');
 const timeout=Number(raw['timeout-ms']);if(timeout>180000)throw Error('guidance-timeout-refused');
 if(raw.phase==='write'&&(raw['allow-bank-write']!==true||raw['allow-bank-read']!==undefined))throw Error('guidance-write-admission-required');
 if(raw.phase==='read'&&(raw['allow-bank-read']!==true||raw['allow-bank-write']!==undefined||raw['inject-lost-ack']!==undefined))throw Error('guidance-read-admission-required');
 return Object.freeze({phase:raw.phase,source_sha:raw['source-sha'],namespace:raw.namespace,credential_config:raw['credential-config'],service_fingerprint:raw['service-fingerprint'],timeout_ms:timeout,lost_ack:raw['inject-lost-ack']===true});
}
async function checkServiceFingerprint(file){
 const info=await lstat(file);
 if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid()||(info.mode&0o7777)!==0o600||info.nlink!==1||info.size>65536)throw Error('guidance-service-fingerprint-refused');
 const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let value;
 try{const before=await fd.stat();const bytes=await fd.readFile();const after=await fd.stat(),named=await lstat(file);
  if(before.ino!==info.ino||before.dev!==info.dev||after.ino!==before.ino||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||named.ino!==before.ino||bytes.length!==before.size)throw Error('guidance-service-fingerprint-refused');
  value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }finally{await fd.close();}
 if(value.endpoint!==ENDPOINT||value.bank!==BANK||value.api_version!=='0.10.2'||!Array.isArray(value.files)||value.files.length!==5)throw Error('guidance-service-fingerprint-refused');
 const allowed=['api/http.py','engine/memory_engine.py','config.py','main.py','server.py'];const seen=new Set(),result=[];
 for(const item of value.files){
  if(!allowed.includes(item.relative)||seen.has(item.relative)||typeof item.path!=='string'||!path.isAbsolute(item.path)||!item.path.endsWith('/hindsight_api/'+item.relative)||!(/^[a-f0-9]{40}$/).test(item.git_blob))throw Error('guidance-service-fingerprint-refused');
  seen.add(item.relative);const stat=await lstat(item.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw Error('guidance-service-fingerprint-refused');
  const bytes=await readFile(item.path);const blob=createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  if(blob!==item.git_blob)throw Error('guidance-service-fingerprint-drift');result.push({relative:item.relative,git_blob:blob});
 }
 return {api_version:'0.10.2',installedFiles:result.sort((a,b)=>a.relative.localeCompare(b.relative)),inMemoryByteAttestation:false,originGitPinClaim:false};
}
async function credential(file){
 const before=await lstat(file),parent=await lstat(path.dirname(file));
 if(!before.isFile()||before.isSymbolicLink()||before.uid!==process.getuid()||(before.mode&0o7777)!==0o600||before.nlink!==1||before.size>1048576||
  !parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid()||(parent.mode&0o022)!==0)throw Error('guidance-credential-source-refused');
 const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const info=await fd.stat();if(info.ino!==before.ino||info.dev!==before.dev)throw Error('guidance-credential-drift');const bytes=await fd.readFile();const after=await fd.stat(),named=await lstat(file);
  if(after.ino!==info.ino||after.dev!==info.dev||after.size!==info.size||after.mtimeMs!==info.mtimeMs||after.ctimeMs!==info.ctimeMs||named.ino!==info.ino||bytes.length!==info.size)throw Error('guidance-credential-drift');
  const config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));const selected={...config,...(config.harnesses?.pi??{})};
  // Explicit supplied top-level/Pi service source only; no ambient env, bank routing,
  // refresh, command credentials, arbitrary endpoint, or password/Keychain lookup.
  if(selected.apiUrl!==ENDPOINT||typeof selected.apiToken!=='string'||selected.apiToken.length<1||selected.apiToken.length>4096||!/^[A-Za-z0-9._~+/-]+=*$/.test(selected.apiToken))throw Error('guidance-credential-config-refused');
  return selected.apiToken;
 }finally{await fd.close();}
}
async function deterministicReference(document,client){
 const {targetFingerprint}=client.target;
 const {writeRequest,documentId,reference}=client.data;
 const request=writeRequest('isolated-test',document);return reference('isolated-test',documentId(request,targetFingerprint(ENDPOINT,'isolated-test',BANK)));
}
export function guidanceAcceptanceFixture(source,namespace){
 if(typeof source!=='string'||!(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).test(source)||typeof namespace!=='string'||!(/^[a-z][a-z0-9-]{0,63}$/).test(namespace))throw Error('guidance-options-refused');
 // Explicitly synthetic, meaningful guidance rather than identifier-only metadata.
 // Persistence still does not guarantee that a model will extract recall facts.
 return {experience_id:`guidance-${namespace}`,run_id:`trial-${namespace}`,repo:'pi-vista',source_sha:source,
  policy_version:'guidance-local-v1',env_fingerprint:'isolated-test-bank',task_type:'metadata-validation',ts:1000,
  script:{task_type:'metadata-validation',description:'The synthetic Fixture Metadata Checker requires a fresh source-archive rebuild before metadata validation and rejects stale compiled output.',preconditions:['source-bound'],steps:['inspect-metadata'],postconditions:['metadata-observed'],known_failures:[{symptom:'stale-compiled-output',mitigation:'fresh-source-archive-build'}],applicable_to:[]},
  steps:[{step_id:`trial-${namespace}_s0`,tool:'metadata-reader',action_description:'Validate synthetic Fixture Metadata Checker metadata after a fresh source-archive rebuild.',check_fn_ids:[],expected_result:'observed',on_failure:'stop',depends_on:[]}]};
}
async function checkedDirectory(parent,part){
 const result=path.join(parent,part);await mkdir(result,{recursive:true,mode:0o700});const stat=await lstat(result);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid())throw Error('guidance-output-root-refused');return result;
}
/** Actual approved bank only. Ordinary tests/imports never invoke this entry. */
export async function guidanceAcceptance(options){
 if(types.isProxy(options)||options===null||typeof options!=='object'||!Object.isFrozen(options))throw Error('guidance-options-refused');
 const expectedKeys=['phase','source_sha','namespace','credential_config','service_fingerprint','timeout_ms','lost_ack'];
 if(![Object.prototype,null].includes(Object.getPrototypeOf(options))||Object.keys(options).sort().join()!==expectedKeys.sort().join()||Object.getOwnPropertySymbols(options).length||
  expectedKeys.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(options,k)??{},'value'))||
  ['phase','source_sha','namespace','credential_config','service_fingerprint'].some(k=>typeof options[k]!=='string')||!Number.isSafeInteger(options.timeout_ms)||typeof options.lost_ack!=='boolean')throw Error('guidance-options-refused');
 const checked=guidanceAcceptanceOptions([`--phase=${options.phase}`,`--source-sha=${options.source_sha}`,`--namespace=${options.namespace}`,`--credential-config=${options.credential_config}`,`--service-fingerprint=${options.service_fingerprint}`,`--timeout-ms=${options.timeout_ms}`,
  options.phase==='write'?'--allow-bank-write':'--allow-bank-read',...(options.lost_ack?['--inject-lost-ack']:[])]);
 const git=async args=>(await exec('git',['-C',ROOT,...args],{cwd:ROOT,env:commandEnvironment(),shell:false,timeout:30000,maxBuffer:1048576})).stdout.trim();
 if(await git(['rev-parse','HEAD'])!==checked.source_sha||await git(['status','--porcelain','--untracked-files=normal']))throw Error('guidance-source-drift');
 const client=await prepareGuidanceClient(checked.source_sha);
 try{
 if(!client.core.isSafeSegment(checked.namespace)||client.core.hasKnownCredential(checked.namespace))throw Error('guidance-options-refused');
 const {createHindsightGuidanceStore,prepareHistoricalGuidance}=client.guidance;
 let directory=ROOT;for(const part of ['tmp','guidance-acceptance',checked.namespace])directory=await checkedDirectory(directory,part);
 const journal=path.join(directory,'journal');if(checked.phase==='write')await mkdir(journal,{mode:0o700});
 const receiptFile=path.join(directory,'historical-reference.json'),reportFile=path.join(directory,`${checked.phase}-report.json`);
 const report={schema:1,phase:checked.phase,node:process.version,pid:process.pid,source_sha:checked.source_sha,bank:BANK,namespace:checked.namespace,
  status:'not-completed',current_verification:'not-checked',authorization:'none',executable:false,defaultActivation:false,
  acceptedServiceBaseline:'actual-installed0.10.2-fingerprint',originalGitPinDeploymentClaim:false,mainBankRequests:0,
  clientArtifactIdentity:client.identity,
  bankCreationDeletion:false,sharedServiceRestart:false,credentialValueProjected:false,http:[]};
 let store;const actualFetch=globalThis.fetch;let injected=false;
 try{
  report.serviceFingerprint=await checkServiceFingerprint(checked.service_fingerprint);
  await client.check();
  const metadata=await actualFetch(ENDPOINT+'/openapi.json',{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(5000),cache:'no-store'});
  await readGuidanceMetadata(metadata);
  report.serviceMetadataGETs=1;
  const token=await credential(checked.credential_config);
  globalThis.fetch=async(url,init)=>{
   if(typeof url!=='string')throw Error('guidance-network-scope-refused');
   const target=new URL(url);const prefix=`/v1/default/banks/${BANK}/`;
   if(target.origin!==ENDPOINT||!target.pathname.startsWith(prefix)||!['GET','POST'].includes(init.method))throw Error('guidance-network-scope-refused');
   const route=target.pathname.slice(prefix.length);const isOriginal=/^documents\/vista-guidance-v1-[a-f0-9]{16}-[a-f0-9]{64}$/.test(route);
   if(!(init.method==='GET'&&(route==='config'||isOriginal)||init.method==='POST'&&(route==='memories'||route==='memories/recall')))throw Error('guidance-network-scope-refused');
   if(checked.phase==='read'&&route==='memories')throw Error('guidance-restart-write-refused');
   if(route==='memories'&&report.http.some(x=>x.route==='memories'))throw Error('guidance-second-retain-refused');
   const attempt={method:init.method,route:isOriginal?'original-document':route,status:null};report.http.push(attempt);
   const response=await actualFetch(url,init);attempt.status=response.status;
   if(checked.lost_ack&&route==='memories'&&response.status===200&&!injected){injected=true;attempt.deliveredStatus=503;attempt.fault='injected-after-real-success';await response.body?.cancel();return new Response('{}',{status:503});}
   return response;
  };
  store=createHindsightGuidanceStore({mode:'local-guidance',endpoint:ENDPOINT,banks:{'isolated-test':BANK},journal_directory:journal,bearer_token:token,allow_loopback_http:true,timeout_ms:checked.timeout_ms});
  globalThis.fetch=actualFetch;
  const observation=guidanceAcceptanceFixture(checked.source_sha,checked.namespace),document=prepareHistoricalGuidance(observation),abort=new AbortController();
  if(checked.phase==='write'){
   let receipt;
   try{receipt=await store.retain('isolated-test',document,abort.signal);if(checked.lost_ack)throw Error('guidance-expected-uncertainty-missing');}
   catch(error){
    if(!checked.lost_ack||!injected||!['sink-failed','sink-mismatch'].includes(error?.code))throw error;
    const reconciliation=await store.reconcile('isolated-test',document,abort.signal);assert.equal(reconciliation.state,'matched');
    // Read-only reconstruction of this deterministic reference, not a second retain.
    receipt=await deterministicReference(document,client);
    report.injectedLostAckReconciled=true;
   }
   const read=await store.read(receipt,abort.signal);assert.equal(read.document.content,document.content);assert.equal(read.guidance.current_verification,'not-checked');
   await writeFile(receiptFile,JSON.stringify({reference:receipt,content_digest:document.content_digest},null,2)+'\n',{flag:'wx',mode:0o600});
   report.originalByteReadback=true;report.receipt=receipt;
  }else{
   let saved;let info;
   try{info=await lstat(receiptFile);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(info){
    if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid()||(info.mode&0o7777)!==0o600||info.nlink!==1||info.size>65536)throw Error('guidance-history-reference-refused');
    const fd=await open(receiptFile,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let bytes;
    try{const before=await fd.stat();bytes=await fd.readFile();const after=await fd.stat(),named=await lstat(receiptFile);
     if(before.ino!==info.ino||before.dev!==info.dev||after.ino!==before.ino||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||named.ino!==before.ino||bytes.length!==before.size)throw Error('guidance-history-reference-refused');
    }finally{await fd.close();}
    saved=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   }else{
    const prior=await store.reconcile('isolated-test',document,abort.signal);assert.equal(prior.state,'matched');
    saved={reference:await deterministicReference(document,client),content_digest:document.content_digest};report.recoveredUncertainReferenceReadOnly=true;
   }
   const read=await store.read(saved.reference,abort.signal);
   assert.equal(read.document.content,document.content);assert.equal(read.document.content_digest,saved.content_digest);assert.equal(read.guidance.current_verification,'not-checked');assert.equal(read.guidance.executable,false);
   const reconciliation=await store.reconcile('isolated-test',document,abort.signal);assert.equal(reconciliation.state,'matched');
   // Preserve successful substeps even if later semantic recall has no references.
   report.restartedOriginalByteReadback=true;report.readOnlyReconciliationMatched=true;report.receipt=saved.reference;
   const query={repo:observation.repo,source_sha:observation.source_sha,policy_version:observation.policy_version,env_fingerprint:observation.env_fingerprint,task_type:observation.task_type};
   const refs=await store.query('isolated-test',query,abort.signal);report.recallOwnTargetCount=refs.length;report.recallContainsOwnDocument=refs.some(x=>x.document_id===saved.reference.document_id);
   if(!report.recallContainsOwnDocument)throw Error('guidance-recall-reference-missing');
  }
  if(await git(['rev-parse','HEAD'])!==checked.source_sha||await git(['status','--porcelain','--untracked-files=normal']))throw Error('guidance-source-drift');
  assert.deepEqual(await checkServiceFingerprint(checked.service_fingerprint),report.serviceFingerprint);
  await client.check();
  Object.assign(report,{status:'passed',retainCount:report.http.filter(x=>x.route==='memories').length,recallCount:report.http.filter(x=>x.route==='memories/recall').length,
   safeDocumentSHA256:sha(document.content),proofRestored:false,historyOnly:true});
 }catch(error){report.status='failed';report.failure=typeof error?.code==='string'&&/^sink-(failed|timeout|mismatch)$/.test(error.code)?error.code:
  typeof error?.message==='string'&&/^guidance-[a-z-]+$/.test(error.message)?error.message:'guidance-acceptance-failed';process.exitCode=1;}
 finally{globalThis.fetch=actualFetch;await writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
 return reportFile;
 }finally{await client.close();}
}
if(isMain(import.meta.url)){
 try{const options=guidanceAcceptanceOptions(process.argv.slice(2));console.log(`Guidance acceptance: ${await guidanceAcceptance(options)}`);}
 catch(error){console.error(typeof error?.message==='string'&&/^guidance-[a-z-]+$/.test(error.message)?error.message:'guidance-acceptance-failed');process.exitCode=1;}
}
