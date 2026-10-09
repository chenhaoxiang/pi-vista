import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm,chmod} from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './release-utils.mjs';
import {bindGuidanceTrialPolicy} from './guidance-trial-policy.mjs';
const binding=()=>({source_sha:'a'.repeat(40),namespace:'fixture-bytes',bank:{bank:'pi-vista-local-test-01a114ab',extraction_mode:'chunks',observations:false,default_strategy:null,bank_state_sha256:'b'.repeat(64)}});
for(const variant of ['bom','trailing-space','invalid-utf8']){
 test('guidance private policy rejects '+variant+' bytes in read and write-match paths without overwrite',async()=>{
  const root=path.join(ROOT,'tmp','policy-byte-format');await mkdir(root,{recursive:true});const owned=await mkdtemp(path.join(root,'case-'));await chmod(owned,0o700);
  try{
   const value=binding();await bindGuidanceTrialPolicy(owned,'write',value);const file=path.join(owned,'trial-policy.json'),original=await readFile(file);
   const bytes=variant==='bom'?Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),original]):variant==='trailing-space'?Buffer.concat([original,Buffer.from(' ')]):Buffer.concat([Buffer.from([0xff]),original]);
   await writeFile(file,bytes,{mode:0o600});
   for(const phase of ['read','write'])await assert.rejects(()=>bindGuidanceTrialPolicy(owned,phase,value),/guidance-trial-policy-mismatch/);
   assert.deepEqual(await readFile(file),bytes);
  }finally{await rm(owned,{recursive:true,force:true});}
 });
}
