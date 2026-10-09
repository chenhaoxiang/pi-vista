import test from 'node:test';
import assert from 'node:assert/strict';
import {readGuidanceBankPreflight} from './guidance-acceptance-io.mjs';
const raw=()=>({bank_id:'pi-vista-local-test-01a114ab',config:{retain_extraction_mode:'chunks',enable_observations:false,retain_default_strategy:null,retain_chunk_size:2048},overrides:{retain_extraction_mode:'chunks'}});
const response=value=>new Response(JSON.stringify(value));
test('guidance chunks admission returns only explicit fixed bank/mode and immutable config digest',async()=>{
 const first=await readGuidanceBankPreflight(response(raw()));
 assert.equal(first.bank,'pi-vista-local-test-01a114ab');assert.equal(first.extraction_mode,'chunks');assert.equal(first.default_strategy,null);assert.equal(first.observations,false);assert.ok(Object.isFrozen(first));
 assert.equal(first.bank_state_sha256.length,64);assert.equal(Object.hasOwn(first,'config'),false);assert.equal(Object.hasOwn(first,'authorization'),false);
 const next=await readGuidanceBankPreflight(response({...raw(),config:{...raw().config,retain_chunk_size:4096}}));assert.notEqual(first.bank_state_sha256,next.bank_state_sha256);
});
for(const value of [{...raw(),bank_id:'main'},{...raw(),config:{...raw().config,retain_extraction_mode:'concise'}},{...raw(),config:{...raw().config,enable_observations:true}},{...raw(),config:{...raw().config,retain_default_strategy:'other-strategy'}},{...raw(),config:null},{...raw(),overrides:[]}]){
 test('guidance bank chunks admission rejects incompatible target/mode/strategy/shape',async()=>{
  await assert.rejects(()=>readGuidanceBankPreflight(response(value)),/guidance-bank-mode-refused/);
 });
}
test('guidance bank preflight rejects/cancels oversized or rejected-status bodies',async()=>{
 for(const status of [404,200]){
  let cancelled=false;
  const body=new ReadableStream({cancel(){cancelled=true;}});
  const reply=new Response(body,{status,headers:{'content-length':'1048577'}});
  await assert.rejects(()=>readGuidanceBankPreflight(reply),/guidance-bank-mode-refused/);assert.equal(cancelled,true);
 }
});
