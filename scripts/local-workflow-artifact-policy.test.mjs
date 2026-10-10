import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bindGuidanceTrialPolicy} from './guidance-trial-policy.mjs';

const root=fileURLToPath(new URL('../tmp/local-artifact-policy/',import.meta.url));
const binding={source_sha:'a'.repeat(40),namespace:'artifact-fixture',bank:{bank:'pi-vista-local-test-01a114ab',extraction_mode:'chunks',observations:false,default_strategy:null,bank_state_sha256:'c'.repeat(64)}};
async function owned(call){await mkdir(root,{recursive:true});const dir=await mkdtemp(path.join(root,'case-'));try{await call(dir);}finally{await rm(dir,{recursive:true,force:true});}}

test('LOCAL explicit artifact policy stores actual digest before effects and accepts only same bytes',async()=>owned(async dir=>{
 const write=await bindGuidanceTrialPolicy(dir,'write',binding,'d'.repeat(64));assert.equal(write.client_artifact_sha256,'d'.repeat(64));
 const bytes=await readFile(path.join(dir,'trial-policy.json'));assert.match(bytes.toString(),/client_artifact_sha256/);
 assert.deepEqual(await bindGuidanceTrialPolicy(dir,'read',binding,'d'.repeat(64)),write);
 await assert.rejects(()=>bindGuidanceTrialPolicy(dir,'read',binding,'e'.repeat(64)),/guidance-trial-policy-mismatch/);
 await assert.rejects(()=>bindGuidanceTrialPolicy(dir,'write',binding,'e'.repeat(64)),/guidance-trial-policy-mismatch/);
 assert.deepEqual(await readFile(path.join(dir,'trial-policy.json')),bytes);
}));
test('LOCAL artifact mode cannot import a legacy source-only baseline or create missing read baseline',async()=>owned(async dir=>{
 await assert.rejects(()=>bindGuidanceTrialPolicy(dir,'read',binding,'d'.repeat(64)),/guidance-trial-policy-refused/);
 const old=await bindGuidanceTrialPolicy(dir,'write',binding);assert.equal(Object.hasOwn(old,'client_artifact_sha256'),false);
 await assert.rejects(()=>bindGuidanceTrialPolicy(dir,'read',binding,'d'.repeat(64)),/guidance-trial-policy-mismatch/);
 assert.deepEqual(await bindGuidanceTrialPolicy(dir,'read',binding),old);
}));
test('LOCAL invalid artifact input refuses before file creation without getters or coercion',async()=>owned(async dir=>{
 let traps=0;const hostile={toString(){traps++;throw Error();}},proxy=new Proxy({}, {get(){traps++;throw Error();}});
 for(const artifact of [null,true,hostile,proxy,'bad','d'.repeat(40)])await assert.rejects(()=>bindGuidanceTrialPolicy(dir,'write',binding,artifact),/guidance-trial-policy-refused/);
 await assert.rejects(()=>readFile(path.join(dir,'trial-policy.json')));assert.equal(traps,0);
}));
test('LOCAL independent process rejects artifact drift without restoring a new write baseline',async()=>owned(async dir=>{
 const execute=async(phase,artifact)=>{
  const code=`import {bindGuidanceTrialPolicy} from ${JSON.stringify(new URL('./guidance-trial-policy.mjs',import.meta.url).href)};let result;try{const p=await bindGuidanceTrialPolicy(${JSON.stringify(dir)},${JSON.stringify(phase)},${JSON.stringify(binding)},${JSON.stringify(artifact)});result={pid:process.pid,status:'passed',policy:p};}catch(e){result={pid:process.pid,status:'failed',code:e.message};}console.log(JSON.stringify(result));`;
  const r=await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{cwd:dir,env:{PATH:path.dirname(process.execPath),HOME:dir,TMPDIR:dir},shell:false,timeout:10000,maxBuffer:8192});assert.equal(r.stderr,'');return JSON.parse(r.stdout);
 };
 const write=await execute('write','d'.repeat(64)),read=await execute('read','e'.repeat(64));assert.notEqual(write.pid,read.pid);assert.equal(write.status,'passed');assert.equal(read.status,'failed');assert.equal(read.code,'guidance-trial-policy-mismatch');
 assert.equal((await execute('read','d'.repeat(64))).status,'passed');
}));
