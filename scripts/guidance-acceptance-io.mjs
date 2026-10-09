import {strict as assert} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,realpath,lstat,rm,writeFile,chmod} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,commandEnvironment,createRunDirectory,discoverPackages,listFiles,npmCli,npmFlags,runLogged,sha256,validateLockedCompiler,allowedPackagePath} from './release-utils.mjs';

const exec=promisify(execFile);
/** Operator-only: build a fresh exact Git archive, never import ignored checkout outputs. */
export async function prepareGuidanceClient(sourceSha){
 if(typeof sourceSha!=='string'||!(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).test(sourceSha))throw Error('guidance-source-drift');
 const git=async args=>(await exec('git',['-C',ROOT,...args],{cwd:ROOT,env:commandEnvironment(),shell:false,timeout:30000,maxBuffer:1048576})).stdout.trim();
 const sourceCheck=async()=>{if(await git(['rev-parse','HEAD'])!==sourceSha||await git(['status','--porcelain','--untracked-files=normal']))throw Error('guidance-source-drift');};
 await sourceCheck();
 const directory=await createRunDirectory('guidance-client');await chmod(directory,0o700);
 const built=path.join(directory,'exact-source');await mkdir(built,{mode:0o700});
 const archive=path.join(directory,'source.tar');
 const close=async()=>{await rm(built,{recursive:true,force:true});};
 try{
  await git(['archive','--format=tar',`--output=${archive}`,sourceSha]);
  await exec('tar',['-xf',archive,'-C',built],{cwd:ROOT,env:commandEnvironment(),shell:false,timeout:30000,maxBuffer:1048576});
  const packages=await discoverPackages(built);
  for(const pkg of packages){
   try{await lstat(path.join(pkg.directory,'dist'));throw Error('guidance-archive-compiled-content-refused');}
   catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const npm=await npmCli(),flags=npmFlags(directory,false);
  await runLogged(directory,'npm-ci',process.execPath,[npm,'ci',...flags],built);
  const lock=await validateLockedCompiler(built);
  await runLogged(directory,'build',process.execPath,[npm,'run','build',...flags],built);
  await sourceCheck();
  for(const pkg of packages)assert.equal(await realpath(path.join(built,'node_modules',pkg.manifest.name)),await realpath(pkg.directory));
  const snapshot=async()=>{
   const files=[];
   // A source build may include legacy tests that publication excludes. Hash
   // them as build-only artifacts; never weaken the original package allowlist.
   const buildOnlyTest=/(?:^|\/)[A-Za-z0-9_.-]+\.(?:test|spec)\.(?:d\.ts(?:\.map)?|[mc]?js(?:\.map)?)$/;
   const record=async(file,test=false)=>{
    const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw Error('guidance-client-artifact-refused');
    files.push({path:path.relative(built,file).split(path.sep).join('/'),sha256:sha256(await readFile(file)),...(test?{build_only_test:true}:{})});
   };
   await record(path.join(built,'package.json'));await record(path.join(built,'package-lock.json'));
   for(const pkg of packages){
    await record(path.join(pkg.directory,'package.json'));
    for(const file of await listFiles(path.join(pkg.directory,'dist'))){
     if(!allowedPackagePath('dist/'+file)&&!buildOnlyTest.test(file))throw Error('guidance-client-artifact-refused');
     if(/\.[mc]?js$/.test(file))await record(path.join(pkg.directory,'dist',file),buildOnlyTest.test(file));
    }
   }
   files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
   if(files.length>2048)throw Error('guidance-client-artifact-refused');
   return {schema:1,source_sha:sourceSha,fresh_archive:true,compiler:lock.packages['node_modules/typescript'].version,files};
  };
  const identity=await snapshot(),serialized=JSON.stringify(identity);
  const load=relative=>import(pathToFileURL(path.join(built,relative)).href);
  const core=await load('packages/core/dist/index.js');
  const guidance=await load('packages/learning/dist/guidance/index.js');
  const target=await load('packages/learning/dist/hindsight/data.js');
  const data=await load('packages/learning/dist/guidance/data.js');
  for(const [module,names] of [[core,['hasKnownCredential','isSafeSegment']],[guidance,['createHindsightGuidanceStore','prepareHistoricalGuidance']],
   [target,['targetFingerprint']],[data,['writeRequest','documentId','reference']]]){
   for(const name of names)if(typeof module[name]!=='function')throw Error('guidance-client-api-refused');
  }
  const check=async()=>{await sourceCheck();if(JSON.stringify(await snapshot())!==serialized)throw Error('guidance-client-artifact-drift');};
  await check();
  const artifactIdentity=Object.freeze({...identity,files:Object.freeze(identity.files.map(file=>Object.freeze(file))),sha256:sha256(serialized)});
  await writeFile(path.join(directory,'client-artifacts.json'),JSON.stringify(artifactIdentity,null,2)+'\n',{flag:'wx',mode:0o600});
  return Object.freeze({core,guidance,target,data,identity:artifactIdentity,check,close});
 }catch(error){await close();throw Error(/^guidance-[a-z-]+$/.test(error.message??'')?error.message:'guidance-client-build-refused');}
}

/** Fixed one-MiB byte bound, fatal decoding and cancellation, including rejected status. */
async function readBoundedGuidanceJSON(response,code,withBytes=false){
 if(response.status!==200||!response.body){await response.body?.cancel().catch(()=>{});throw Error(code);}
 const reader=response.body.getReader(),chunks=[];let bytes=0;
 try{
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>1048576))throw Error();
  for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1048576)throw Error();chunks.push(part.value);}
  const raw=Buffer.concat(chunks,bytes),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  return withBytes?{value,bytes:raw}:value;
 }catch{throw Error(code);}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function readGuidanceMetadata(response){
 const metadata=await readBoundedGuidanceJSON(response,'guidance-service-version-refused');
 if(metadata?.info?.version!=='0.10.2')throw Error('guidance-service-version-refused');
 return metadata;
}
/** Operator policy only, not a library default or source of current proof. */
function bankPreflight(value){
 const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 if(!record(value)||value.bank_id!=='pi-vista-local-test-01a114ab'||!record(value.config)||!record(value.overrides)||
  value.config.retain_extraction_mode!=='chunks'||value.config.enable_observations!==false||
  value.config.retain_default_strategy!==undefined&&value.config.retain_default_strategy!==null)throw Error('guidance-bank-mode-refused');
 const canonical=v=>v!==null&&typeof v==='object'?(Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'):JSON.stringify(v);
 // Only a digest of the bank's noncredential public config; no mission/body is projected.
 return Object.freeze({bank:value.bank_id,extraction_mode:'chunks',observations:false,default_strategy:null,
  bank_state_sha256:sha256(canonical({config:value.config,overrides:value.overrides}))});
}
export async function readGuidanceBankPreflight(response){
 return bankPreflight(await readBoundedGuidanceJSON(response,'guidance-bank-mode-refused'));
}
/** Consume one bounded stream: no tee cancellation wait on an unread branch. */
export async function bufferGuidanceBankPreflight(response){
 const buffered=await readBoundedGuidanceJSON(response,'guidance-bank-mode-refused',true);
 const state=bankPreflight(buffered.value);
 return Object.freeze({state,response:new Response(buffered.bytes,{status:200,headers:{'content-type':'application/json'}})});
}
