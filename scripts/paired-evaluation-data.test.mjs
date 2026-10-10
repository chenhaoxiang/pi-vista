import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregatePairedMeasurements,caseTruth,expectedFixtureContract,pairedFixture,pairedOrder,pairDigest,snapshotPairMeasurement,strictPairedDecision,PAIR_CASES} from './paired-evaluation-data.mjs';

const source='a'.repeat(40),env='b'.repeat(64),token=(n)=>({input:n,output:n,cacheRead:0,cacheWrite:0,total:n*2});
function measurement(case_id,arm,success=true,offset=0){return {case_id,arm,source_sha:source,provider:'codex-local-8319',model:'gpt-6.1-sol',thinking:'max',sdk:'1.0.4',success,failure_category:success?'none':'fixture-mismatch',elapsed_ms:100+offset,request_attempts:1,tool_calls:1,human_interventions:0,tokens:token(2+offset),sdk_cost:null,cost_priced:false,output_digest:'c'.repeat(64)};}

test('paired contract has four fixed cases, balanced order and no hidden current authority',()=>{
 assert.deepEqual(PAIR_CASES,['healthy-metadata','stale-artifact','environment-drift','missing-metadata']);assert.equal(pairedOrder().length,8);assert.equal(pairedFixture('healthy-metadata',source,env).source_sha,source);assert.equal(expectedFixtureContract(source,env).format_version,1);assert.equal(strictPairedDecision('{"case_id":"healthy-metadata","decision":"accept","reason_code":"metadata-current"}','healthy-metadata').decision,'accept');
});
test('paired digest and closed measurements reject unsafe/unknown data',()=>{
 assert.equal(pairDigest('fixture').length,64);assert.throws(()=>pairedFixture('unknown',source,env));assert.throws(()=>strictPairedDecision('{"case_id":"healthy-metadata","decision":"accept","reason_code":"metadata-current","raw":"secret"}','healthy-metadata'));
 assert.throws(()=>snapshotPairMeasurement({...measurement('healthy-metadata','baseline'),sdk:'1.0.4-fork.1'}));assert.throws(()=>snapshotPairMeasurement({...measurement('healthy-metadata','baseline'),sdk_cost:0,cost_priced:false}));
});
test('paired aggregate computes deltas and preserves unknown/unpriced cost',()=>{
 const rows=[];for(const id of PAIR_CASES){rows.push(measurement(id,'baseline',id!=='missing-metadata'));rows.push(measurement(id,'guided',true,1));}const out=aggregatePairedMeasurements(rows);assert.equal(out.pair_count,4);assert.equal(out.baseline.successes,3);assert.equal(out.guided.successes,4);assert.equal(out.pairs.find(x=>x.case_id==='missing-metadata').success_delta,1);assert.equal(out.guided.sdk_cost,null);assert.equal(out.capability_claim,'none');assert.equal(out.authorization,'none');assert.equal(out.executable,false);
 assert.throws(()=>aggregatePairedMeasurements(rows.slice(0,7)));assert.throws(()=>aggregatePairedMeasurements([...rows,measurement('healthy-metadata','baseline')]));
});
