import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregatePairedMeasurements,caseTruth,expectedFixtureContract,pairedFixture,pairedOrder,pairDigest,snapshotPairMeasurement,strictPairedDecision,PAIR_CASES,PAIR_SOURCE_SHA,PAIR_HISTORY_DIGEST,PAIR_TIMEOUT_MS,PAIR_ROUND_BUDGET} from './paired-evaluation-data.mjs';

const env='b'.repeat(64),digest=(value)=>pairDigest(value),token=(n)=>({input:n,output:n,cacheRead:0,cacheWrite:0,reasoning:1,total:n*2+1});
function measurement(case_id,arm,success=true,offset=0){
 const guided=arm==='guided';
 return {case_id,arm,source_sha:PAIR_SOURCE_SHA,harness_source_sha:digest('harness'),provider:'codex-local-8319',model:'gpt-6.1-sol',thinking:'max',sdk:'1.0.4',runtime_digest:digest('runtime'),system_prompt_digest:digest('system'),tool_definition_digest:digest('tools'),task_prompt_digest:digest(`task:${case_id}`),timeout_ms:PAIR_TIMEOUT_MS,round_budget:PAIR_ROUND_BUDGET,run_identity_digest:digest(`${case_id}:${arm}:run`),session_identity_digest:digest(`${case_id}:${arm}:session`),guidance_mode:guided?'historical-observed':'none',history_digest:guided?PAIR_HISTORY_DIGEST:null,context_digest:guided?digest(`context:${case_id}`):null,history_current_verification:guided?'not-checked':'none',guidance_reimported:guided,guidance_currently_verified:guided,authorization:'none',executable:false,success,failure_category:success?'none':'fixture-mismatch',trace_accuracy:success,decision_parsed:success,disagreement_count:0,elapsed_ms:100+offset,request_attempts:1,retry_count:0,cancelled:false,tool_calls:1,human_interventions:0,tokens:token(2+offset),sdk_cost:null,cost_priced:false,output_digest:digest(`${case_id}:${arm}:output`)};
}

test('paired contract has four fixed cases, balanced order and no hidden current authority',()=>{
 assert.deepEqual(PAIR_CASES,['healthy-metadata','stale-artifact','environment-drift','missing-metadata']);assert.equal(pairedOrder().length,8);assert.equal(pairedFixture('healthy-metadata','a'.repeat(40),env).source_sha,'a'.repeat(40));assert.equal(pairedFixture('stale-artifact','a'.repeat(40),env).source_sha.length,40);assert.match(pairedFixture('environment-drift','a'.repeat(40),env).env_fingerprint,/^[a-f0-9]{64}$/);assert.equal(expectedFixtureContract('a'.repeat(40),env).format_version,1);assert.equal(caseTruth('healthy-metadata').decision,'accept');assert.equal(strictPairedDecision('{"case_id":"healthy-metadata","decision":"accept","reason_code":"metadata-current"}','healthy-metadata').decision,'accept');
});
test('paired digest and closed measurements reject unsafe/unknown data',()=>{
 assert.equal(pairDigest('fixture').length,64);assert.throws(()=>pairedFixture('unknown','a'.repeat(40),env));assert.throws(()=>strictPairedDecision('{"case_id":"healthy-metadata","decision":"accept","reason_code":"metadata-current","raw":"secret"}','healthy-metadata'));
 assert.throws(()=>snapshotPairMeasurement({...measurement('healthy-metadata','baseline'),sdk:'1.0.4-fork.1'}));assert.throws(()=>snapshotPairMeasurement({...measurement('healthy-metadata','baseline'),sdk_cost:0,cost_priced:false}));assert.throws(()=>snapshotPairMeasurement({...measurement('healthy-metadata','baseline'),sdk_cost:0,cost_priced:true}));assert.throws(()=>snapshotPairMeasurement({...measurement('healthy-metadata','guided'),guidance_mode:'none',history_digest:null,context_digest:null,guidance_reimported:false,guidance_currently_verified:false,history_current_verification:'none'}));assert.throws(()=>snapshotPairMeasurement({...measurement('healthy-metadata','baseline'),success:true,failure_category:'timeout'}));
});
test('paired aggregate enforces equal conditions, fresh identities, bounded requests and preserves unknown/unpriced cost',()=>{
 const rows=[];for(const id of PAIR_CASES){rows.push(measurement(id,'baseline',id!=='missing-metadata'));rows.push(measurement(id,'guided',true,1));}const out=aggregatePairedMeasurements(rows);assert.equal(out.pair_count,4);assert.equal(out.baseline.successes,3);assert.equal(out.guided.successes,4);assert.equal(out.pairs.find(x=>x.case_id==='missing-metadata').success_delta,1);assert.equal(out.guided.sdk_cost,null);assert.equal(out.evaluation_status,'measured');assert.equal(out.capability_claim,'none');assert.equal(out.authorization,'none');assert.equal(out.executable,false);assert.equal(out.guided.reasoning_tokens,4);
 assert.throws(()=>aggregatePairedMeasurements(rows.slice(0,7)));assert.throws(()=>aggregatePairedMeasurements([...rows,measurement('healthy-metadata','baseline')]));assert.throws(()=>aggregatePairedMeasurements(rows.map((row,index)=>index===1?{...row,task_prompt_digest:digest('different')}:row)));assert.throws(()=>aggregatePairedMeasurements(rows.map((row,index)=>index===0?{...row,request_attempts:3}:row)));assert.throws(()=>aggregatePairedMeasurements(rows.map((row,index)=>index===1?{...row,run_identity_digest:rows[0].run_identity_digest}:row)));
});
test('F1 equal-condition descriptors cannot be missing, mismatched or outside the fixed pilot budget',()=>{
 const good=measurement('healthy-metadata','baseline');
 for(const key of ['runtime_digest','system_prompt_digest','tool_definition_digest','task_prompt_digest','session_identity_digest','run_identity_digest','timeout_ms','round_budget','harness_source_sha']){const bad={...good};delete bad[key];assert.throws(()=>snapshotPairMeasurement(bad));}
 for(const extra of [{source_sha:'f'.repeat(40)},{timeout_ms:1},{round_budget:3},{request_attempts:3},{retry_count:1},{run_identity_digest:good.session_identity_digest}])assert.throws(()=>snapshotPairMeasurement({...good,...extra}));
 const rows=pairedOrder().map(({case_id,arm})=>measurement(case_id,arm));
 for(const key of ['harness_source_sha','runtime_digest','system_prompt_digest','tool_definition_digest'])assert.throws(()=>aggregatePairedMeasurements(rows.map((row,index)=>index===1?{...row,[key]:digest('other')}:row)));
});
test('F2 guided metadata requires the accepted history plus new observed import/current context labels, never restores authority',()=>{
 const good=measurement('healthy-metadata','guided');
 for(const extra of [{context_digest:null},{history_digest:digest('other-history')},{history_current_verification:'verified'},{guidance_reimported:false},{guidance_currently_verified:false},{authorization:'approved'},{executable:true}])assert.throws(()=>snapshotPairMeasurement({...good,...extra}));
 assert.throws(()=>snapshotPairMeasurement({...measurement('healthy-metadata','baseline'),guidance_mode:'historical-observed',history_digest:PAIR_HISTORY_DIGEST,context_digest:digest('unexpected'),history_current_verification:'not-checked',guidance_reimported:true,guidance_currently_verified:true}));
});
test('F3 failure and unknown outcomes stay non-success and remain categorized in aggregate',()=>{
 for(const category of ['timeout','provider-unavailable','cancelled','fixture-mismatch'])assert.throws(()=>snapshotPairMeasurement({...measurement('healthy-metadata','baseline'),failure_category:category}));
 assert.throws(()=>snapshotPairMeasurement({...measurement('healthy-metadata','baseline',false),failure_category:'none'}));
 const rows=pairedOrder().map(({case_id,arm})=>measurement(case_id,arm));const bad=rows.findIndex(x=>x.arm==='guided');rows[bad]={...rows[bad],success:false,trace_accuracy:false,failure_category:'provider-unavailable',tokens:{...rows[bad].tokens,reasoning:null}};
 const out=aggregatePairedMeasurements(rows);assert.equal(out.evaluation_status,'unknown');assert.equal(out.unknown_runs,1);assert.equal(out.guided.successes,3);assert.equal(out.guided.failure_categories['provider-unavailable'],1);assert.equal(out.guided.reasoning_tokens,null);assert.equal(out.pairs[0].guided_failure_category,'provider-unavailable');assert.equal(out.pairs[0].reasoning_tokens_delta,null);
});
test('F4 zero/unconfigured SDK pricing stays unknown; positive estimates never claim billing',()=>{
 const good=measurement('healthy-metadata','baseline');assert.throws(()=>snapshotPairMeasurement({...good,sdk_cost:0,cost_priced:true}));assert.throws(()=>snapshotPairMeasurement({...good,sdk_cost:null,cost_priced:true}));assert.equal(snapshotPairMeasurement({...good,sdk_cost:0.01,cost_priced:true}).sdk_cost,0.01);
 const rows=pairedOrder().map(({case_id,arm})=>({...measurement(case_id,arm),sdk_cost:0.01,cost_priced:true}));assert.match(aggregatePairedMeasurements(rows).cost_basis,/not-independent-billing/);
});
test('F5 trace, cancellation, reasoning and disagreement metadata are required and retained',()=>{
 const good=measurement('healthy-metadata','baseline');for(const key of ['trace_accuracy','decision_parsed','cancelled','retry_count','disagreement_count']){const bad={...good};delete bad[key];assert.throws(()=>snapshotPairMeasurement(bad));}
 assert.throws(()=>snapshotPairMeasurement({...good,cancelled:true}));assert.throws(()=>snapshotPairMeasurement({...good,trace_accuracy:false}));assert.throws(()=>snapshotPairMeasurement({...good,decision_parsed:false}));assert.throws(()=>snapshotPairMeasurement({...good,disagreement_count:1}));
 assert.equal(snapshotPairMeasurement({...good,tokens:{...good.tokens,reasoning:null}}).tokens.reasoning,null);const {reasoning,...oldTokens}=good.tokens;assert.throws(()=>snapshotPairMeasurement({...good,tokens:oldTokens}));
});
test('F6 same-shape stale/environment fixtures differ even for all-e/f and 64-byte hash labels',()=>{
 for(const len of [40,64])for(const char of ['e','f']){const source=char.repeat(len),fixture=pairedFixture('stale-artifact',source,env);assert.equal(fixture.source_sha.length,len);assert.match(fixture.source_sha,/^[a-f0-9]+$/);assert.notEqual(fixture.source_sha,source);}
 const fixture=pairedFixture('environment-drift',PAIR_SOURCE_SHA,env);assert.match(fixture.env_fingerprint,/^[a-f0-9]{64}$/);assert.notEqual(fixture.env_fingerprint,env);
});
test('successful rows require at least one model request while zero-request failures remain admissible',()=>{
 const good=measurement('healthy-metadata','baseline');assert.throws(()=>snapshotPairMeasurement({...good,request_attempts:0}));const failed=snapshotPairMeasurement({...good,success:false,decision_parsed:false,request_attempts:0,failure_category:'provider-unavailable'});assert.equal(failed.request_attempts,0);
});
test('zero strict semantic decisions cannot be an affirmative measured quality result',()=>{
 const rows=pairedOrder().map(({case_id,arm})=>({...measurement(case_id,arm,false),trace_accuracy:true,decision_parsed:false}));
 const out=aggregatePairedMeasurements(rows);assert.equal(out.evaluation_status,'unknown');assert.equal(out.decision_parsed,0);assert.equal(out.baseline.successes,0);assert.equal(out.guided.successes,0);assert.equal(out.baseline.trace_accurate,4);assert.equal(out.baseline.failure_categories['fixture-mismatch'],4);assert.equal(out.capability_claim,'none');
});
test('closed metadata refuses getters/proxies/sparse rows without invoking them and freezes all aggregates',()=>{
 let calls=0;const good=measurement('healthy-metadata','baseline');const getter=Object.defineProperty({...good},'success',{get(){calls++;throw Error();}});const proxy=new Proxy(good,{get(){calls++;throw Error();},ownKeys(){calls++;throw Error();}});
 assert.throws(()=>snapshotPairMeasurement(getter));assert.throws(()=>snapshotPairMeasurement(proxy));const rows=pairedOrder().map(({case_id,arm})=>measurement(case_id,arm));const sparse=[...rows];delete sparse[1];assert.throws(()=>aggregatePairedMeasurements(sparse));const accessor=[...rows];Object.defineProperty(accessor,'0',{get(){calls++;throw Error();}});assert.throws(()=>aggregatePairedMeasurements(accessor));assert.equal(calls,0);
 const result=aggregatePairedMeasurements(rows);assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.pairs)&&Object.isFrozen(result.baseline.failure_categories));assert.equal(Object.isFrozen(snapshotPairMeasurement(good).tokens),true);
});
