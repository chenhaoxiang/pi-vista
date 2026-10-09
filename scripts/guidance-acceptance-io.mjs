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
   const record=async file=>{
    const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw Error('guidance-client-artifact-refused');
    files.push({path:path.relative(built,file).split(path.sep).join('/'),sha256:sha256(await readFile(file))});
   };
   await record(path.join(built,'package.json'));await record(path.join(built,'package-lock.json'));
   for(const pkg of packages){
    await record(path.join(pkg.directory,'package.json'));
    for(const file of await listFiles(path.join(pkg.directory,'dist'))){
     if(!allowedPackagePath('dist/'+file))throw Error('guidance-client-artifact-refused');
     if(/\.[mc]?js$/.test(file))await record(path.join(pkg.directory,'dist',file));
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
export async function readGuidanceMetadata(response){
 if(response.status!==200||!response.body){await response.body?.cancel().catch(()=>{});throw Error('guidance-service-version-refused');}
 const reader=response.body.getReader(),chunks=[];let bytes=0;
 try{
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>1048576))throw Error();
  for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1048576)throw Error();chunks.push(part.value);}
  const metadata=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
  if(metadata.info?.version!=='0.10.2')throw Error();
  return metadata;
 }catch{throw Error('guidance-service-version-refused');}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
