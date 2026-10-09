import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile,symlink,chmod} from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './release-utils.mjs';
import {bufferGuidanceBankPreflight} from './guidance-acceptance-io.mjs';
import {bindGuidanceTrialPolicy} from './guidance-trial-policy.mjs';
const binding=()=>({source_sha:'a'.repeat(40),namespace:'fixture-policy',bank:{bank:'pi-vista-local-test-01a114ab',extraction_mode:'chunks',observations:false,default_strategy:null,bank_state_sha256:'b'.repeat(64)}});
async function fixture(){const parent=path.join(ROOT,'tmp','guidance-policy-regressions');await mkdir(parent,{recursive:true});const owned=await mkdtemp(path.join(parent,'case-'));await chmod(owned,0o700);return{owned,close:()=>rm(owned,{recursive:true,force:true})};}
for(const status of [404,200]){
 test('guidance config refusal cancels its one open response stream without tee waiting '+status,{timeout:3000},async()=>{
  let cancelled=false;const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{status,headers:{'content-length':'1048577'}});
  await assert.rejects(()=>bufferGuidanceBankPreflight(response),/guidance-bank-mode-refused/);assert.equal(cancelled,true);assert.equal(response.body.locked,false);
 });
}
test('guidance guarded config preserves original bytes for unchanged library validation',async()=>{
 const raw=' {"bank_id":"pi-vista-local-test-01a114ab", "config":{"retain_extraction_mode":"chunks","enable_observations":false,"retain_default_strategy":null},"overrides":{}}\n';
 const result=await bufferGuidanceBankPreflight(new Response(raw));assert.equal(await result.response.text(),raw);assert.equal(result.state.extraction_mode,'chunks');assert.ok(Object.isFrozen(result.state));
});
test('guidance private immutable trial policy matches across restart and rejects source/bank-state drift',async()=>{
 const f=await fixture();try{
  const value=binding(),first=await bindGuidanceTrialPolicy(f.owned,'write',value),bytes=await readFile(path.join(f.owned,'trial-policy.json'),'utf8');
  assert.deepEqual(await bindGuidanceTrialPolicy(f.owned,'read',value),first);assert.equal(first.bank_state_sha256,value.bank.bank_state_sha256);
  for(const changed of [{...value,source_sha:'c'.repeat(40)},{...value,namespace:'other-fixture'},{...value,bank:{...value.bank,bank_state_sha256:'c'.repeat(64)}}]){
   await assert.rejects(()=>bindGuidanceTrialPolicy(f.owned,'read',changed),/guidance-trial-policy-mismatch/);
   await assert.rejects(()=>bindGuidanceTrialPolicy(f.owned,'write',changed),/guidance-trial-policy-mismatch/);
  }
  assert.equal(await readFile(path.join(f.owned,'trial-policy.json'),'utf8'),bytes);assert.equal(Object.hasOwn(first,'authorization'),false);
 }finally{await f.close();}
});
test('guidance missing/corrupt trial policy is not created or overwritten by restarted read',async()=>{
 const f=await fixture();try{
  await assert.rejects(()=>bindGuidanceTrialPolicy(f.owned,'read',binding()),/guidance-trial-policy-refused/);
  const file=path.join(f.owned,'trial-policy.json');await writeFile(file,'partial',{mode:0o600});
  await assert.rejects(()=>bindGuidanceTrialPolicy(f.owned,'read',binding()),/guidance-trial-policy-mismatch/);
  await assert.rejects(()=>bindGuidanceTrialPolicy(f.owned,'write',binding()),/guidance-trial-policy-mismatch/);
  assert.equal(await readFile(file,'utf8'),'partial');
 }finally{await f.close();}
});
test('guidance policy symlink/accessor/unsafe-mode input refuses without hooks or arbitrary target mutation',async()=>{
 const f=await fixture();try{
  let hooks=0;const value=binding(),accessor=Object.defineProperty({...value},'bank',{get(){hooks++;throw Error();}});
  await assert.rejects(()=>bindGuidanceTrialPolicy(f.owned,'write',accessor),/guidance-trial-policy-refused/);assert.equal(hooks,0);
  const target=path.join(f.owned,'fixture-target');await writeFile(target,'synthetic sentinel',{mode:0o600});await symlink(target,path.join(f.owned,'trial-policy.json'));
  await assert.rejects(()=>bindGuidanceTrialPolicy(f.owned,'write',value),/guidance-trial-policy-refused/);assert.equal(await readFile(target,'utf8'),'synthetic sentinel');
  await chmod(f.owned,0o755);await assert.rejects(()=>bindGuidanceTrialPolicy(f.owned,'read',value),/guidance-trial-policy-refused/);
 }finally{await f.close();}
});
