import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,writeFile,copyFile,symlink,rm,access} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT,commandEnvironment,discoverPackages} from './release-utils.mjs';
import {readGuidanceMetadata} from './guidance-acceptance-io.mjs';

const exec=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const core='export const hasKnownCredential=()=>false;export const isSafeSegment=()=>true;\n';
const guidance=content=>`export const prepareHistoricalGuidance=()=>({content:${JSON.stringify(content)},content_digest:${JSON.stringify(hash(content))}});
export const createHindsightGuidanceStore=()=>({retain:async()=>({bank:'isolated-test',document_id:'fixture-id',current_verification:'not-checked',authorization:'none',executable:false}),read:async()=>({document:prepareHistoricalGuidance(),guidance:{current_verification:'not-checked',authorization:'none',executable:false}})});\n`;

async function fixture(mode='normal'){
 const parent=path.join(ROOT,'tmp','guidance-harness-regressions');await mkdir(parent,{recursive:true});
 const owned=await mkdtemp(path.join(parent,'case-'));await mkdir(path.join(owned,'scripts'));
 const temporary=path.join(owned,'tmp');await mkdir(temporary,{mode:0o700});
 const run=async(command,args)=>(await exec(command,args,{cwd:owned,env:{...commandEnvironment(),TMPDIR:temporary},shell:false,timeout:120000,maxBuffer:1048576})).stdout.trim();
 const git=async args=>run('git',['-C',owned,...args]);
 const manifest=JSON.parse(await readFile(path.join(ROOT,'package.json'),'utf8'));
 manifest.scripts={build:'node scripts/fixture-build.mjs'};
 await writeFile(path.join(owned,'package.json'),JSON.stringify(manifest));
 await copyFile(path.join(ROOT,'package-lock.json'),path.join(owned,'package-lock.json'));
 await copyFile(path.join(ROOT,'.gitignore'),path.join(owned,'.gitignore'));
 const packages=await discoverPackages();
 for(const pkg of packages){
  const target=path.join(owned,path.relative(ROOT,pkg.directory));await mkdir(target,{recursive:true});
  await copyFile(path.join(pkg.directory,'package.json'),path.join(target,'package.json'));
 }
 for(const file of ['hindsight-guidance-acceptance.mjs','release-utils.mjs','guidance-acceptance-io.mjs']){
  try{await copyFile(path.join(ROOT,'scripts',file),path.join(owned,'scripts',file));}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const learning=path.join(owned,'packages','learning');const corePath=path.join(owned,'packages','core');
 await mkdir(path.join(learning,'dist','guidance'),{recursive:true});await mkdir(path.join(corePath,'dist'),{recursive:true});
 await writeFile(path.join(corePath,'dist','index.js'),core);
 const marker=path.join(temporary,'stale-client-loaded');
 await writeFile(path.join(learning,'dist','guidance','index.js'),`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'stale');\n`+guidance('fixture-stale-code'));
 await mkdir(path.join(owned,'node_modules','@pi-vista'),{recursive:true});
 for(const pkg of packages)await symlink(path.join(owned,path.relative(ROOT,pkg.directory)),path.join(owned,'node_modules',pkg.manifest.name),'dir');
 const relativePackages=packages.map(pkg=>path.relative(ROOT,pkg.directory));
 await writeFile(path.join(owned,'scripts','fixture-build.mjs'),`import {mkdir,writeFile,readFile} from 'node:fs/promises';
 for(const directory of ${JSON.stringify(relativePackages)}){
  const pkg=JSON.parse(await readFile(directory+'/package.json','utf8'));
  for(const entry of Object.values(pkg.exports))for(const target of Object.values(entry)){
   const file=directory+'/'+target.slice(2);await mkdir(file.slice(0,file.lastIndexOf('/')),{recursive:true});await writeFile(file,file.endsWith('.d.ts')?'export {};\\n':'export {};\\n');
  }
 }
 await writeFile('packages/core/dist/index.js',${JSON.stringify(core)});
 await writeFile('packages/learning/dist/guidance/index.js',${JSON.stringify(guidance('fixture-fresh-code'))});
 await mkdir('packages/learning/dist/hindsight',{recursive:true});
 await writeFile('packages/learning/dist/hindsight/data.js','export const targetFingerprint=()=>"f".repeat(64);');
 await writeFile('packages/learning/dist/guidance/data.js','export const writeRequest=()=>({});export const documentId=()=>"fixture-id";export const reference=()=>({});');\n`);
 const stateFile=path.join(temporary,'fetch-state.json');
 await writeFile(path.join(owned,'scripts','fixture-fetch.mjs'),`import {writeFileSync} from 'node:fs';
 const state={mode:${JSON.stringify(mode)},pulls:0,cancelled:false,networkCalls:0};
 const save=()=>writeFileSync(${JSON.stringify(stateFile)},JSON.stringify(state));save();
 globalThis.fetch=async url=>{
  if(url!=='http://127.0.0.1:8888/openapi.json')throw Error('fixture refuses actual network');state.networkCalls++;save();
  if(state.mode==='normal')return new Response(JSON.stringify({info:{version:'0.10.2'}}));
  if(state.mode==='rejected-status')return new Response(new ReadableStream({cancel(){state.cancelled=true;save();}}),{status:503});
  const chunks=[new TextEncoder().encode('{"info":{"version":"0.10.2"},"padding":"'),...Array.from({length:20},()=>new Uint8Array(100000).fill(97)),new TextEncoder().encode('"}')];
  return new Response(new ReadableStream({pull(controller){state.pulls++;save();if(chunks.length)controller.enqueue(chunks.shift());else controller.close();},cancel(){state.cancelled=true;save();}}));
 };\n`);
 const config=path.join(temporary,'synthetic-config.json');
 await writeFile(config,JSON.stringify({apiUrl:'http://127.0.0.1:8888',apiToken:'synthetic-fixture-bearer'}),{mode:0o600});
 const files=[];
 for(const relative of ['api/http.py','engine/memory_engine.py','config.py','main.py','server.py']){
  const file=path.join(temporary,'synthetic-service','hindsight_api',relative);await mkdir(path.dirname(file),{recursive:true});
  const bytes=Buffer.from('synthetic service fixture\n');await writeFile(file,bytes);
  files.push({relative,path:file,git_blob:createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')});
 }
 const fingerprint=path.join(temporary,'service.json');
 await writeFile(fingerprint,JSON.stringify({endpoint:'http://127.0.0.1:8888',bank:'pi-vista-local-test-01a114ab',api_version:'0.10.2',files}),{mode:0o600});
 await git(['init','--quiet']);await git(['config','user.name','Synthetic Fixture']);await git(['config','user.email','fixture@example.invalid']);
 await git(['add','--','package.json','package-lock.json','.gitignore','packages','scripts']);await git(['-c','core.hooksPath=/dev/null','commit','--quiet','-m','synthetic fixture']);
 const head=await git(['rev-parse','HEAD']);
 const invoke=async(source=head)=>{
  let code=0;
  try{await run(process.execPath,['--import',path.join(owned,'scripts','fixture-fetch.mjs'),path.join(owned,'scripts','hindsight-guidance-acceptance.mjs'),
   '--phase=write','--source-sha='+source,'--namespace=fixture-guidance','--credential-config='+config,'--service-fingerprint='+fingerprint,'--timeout-ms=1000','--allow-bank-write']);}
  catch(error){code=error.code;}
  let report;
  try{report=JSON.parse(await readFile(path.join(temporary,'guidance-acceptance','fixture-guidance','write-report.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const state=JSON.parse(await readFile(stateFile,'utf8'));return{code,report,state};
 };
 return{owned,head,marker,invoke,close:()=>rm(owned,{recursive:true,force:true})};
}

test('guidance exact-source harness rebuilds an isolated client instead of executing stale ignored dist', {timeout:120000},async()=>{
 const f=await fixture();try{
  const result=await f.invoke();assert.equal(result.code,0);assert.equal(result.report.status,'passed');
  await assert.rejects(()=>access(f.marker));
  assert.equal(result.report.safeDocumentSHA256,hash('fixture-fresh-code'));
  assert.equal(result.report.clientArtifactIdentity.source_sha,f.head);assert.equal(result.report.clientArtifactIdentity.fresh_archive,true);
  assert.ok(result.report.clientArtifactIdentity.files.some(file=>file.path==='packages/learning/dist/guidance/index.js'&&file.sha256===hash(guidance('fixture-fresh-code'))));
  assert.equal(result.state.networkCalls,1);
 }finally{await f.close();}
});

test('guidance metadata preflight cancels chunked oversized bodies before fully buffering them', {timeout:120000},async()=>{
 const f=await fixture('oversized');try{
  const result=await f.invoke();assert.equal(result.report.status,'failed');assert.equal(result.report.failure,'guidance-service-version-refused');
  assert.equal(result.state.cancelled,true);assert.ok(result.state.pulls<20);assert.equal(result.state.networkCalls,1);
 }finally{await f.close();}
});

test('guidance metadata preflight cancels rejected-status bodies', {timeout:120000},async()=>{
 const f=await fixture('rejected-status');try{
  const result=await f.invoke();assert.equal(result.report.status,'failed');assert.equal(result.state.cancelled,true);assert.equal(result.state.networkCalls,1);
 }finally{await f.close();}
});

test('guidance mismatched source admission imports no stale client and performs no metadata requests', {timeout:120000},async()=>{
 const f=await fixture();try{
  const result=await f.invoke('b'.repeat(40));assert.notEqual(result.code,0);assert.equal(result.report,undefined);
  assert.equal(result.state.networkCalls,0);await assert.rejects(()=>access(f.marker));
 }finally{await f.close();}
});

test('guidance metadata rejects a declared oversized response without pulling its body',async()=>{
 let cancelled=false,pulls=0;
 const response=new Response(new ReadableStream({pull(){pulls++;},cancel(){cancelled=true;}}),{headers:{'content-length':'1048577'}});
 await assert.rejects(()=>readGuidanceMetadata(response),/guidance-service-version-refused/);
 assert.equal(cancelled,true);assert.ok(pulls<=1);assert.equal(response.body.locked,false);
});

test('guidance metadata fatal UTF-8 refusal releases the reader',async()=>{
 const response=new Response(new Uint8Array([0xff,0xfe]));
 await assert.rejects(()=>readGuidanceMetadata(response),/guidance-service-version-refused/);
 assert.equal(response.body.locked,false);
});
