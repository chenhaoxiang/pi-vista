import {createHash} from 'node:crypto';
import {types} from 'node:util';

export const PAIR_CASES=Object.freeze(['healthy-metadata','stale-artifact','environment-drift','missing-metadata']);
export const PAIR_ARMS=Object.freeze(['baseline','guided']);
export const PAIR_TOOL='paired_inspect_metadata';
export const PAIR_SOURCE_SHA='846b9a0b135dd88a3311c16ba23c24e61d8216f3';
export const PAIR_HISTORY_DIGEST='ead26d1b830617cf47a698aa469688631c31f8a68e7ca70368629746f3a49d55';
export const PAIR_TIMEOUT_MS=1_200_000;
export const PAIR_ROUND_BUDGET=2;
export const PAIR_FAILURE_CATEGORIES=Object.freeze(['none','fixture-mismatch','authentication','quota','timeout','provider-unavailable','request-contract','stream-disconnected','cancelled','unspecified','unclassified-provider-error','deadline','round-budget','model-drift','external-failure']);
const UNKNOWN_FAILURES=new Set(PAIR_FAILURE_CATEGORIES.filter(value=>!['none','fixture-mismatch'].includes(value)));
const outcomes=Object.freeze({
 'healthy-metadata':Object.freeze({decision:'accept',reason_code:'metadata-current'}),
 'stale-artifact':Object.freeze({decision:'reject',reason_code:'source-mismatch'}),
 'environment-drift':Object.freeze({decision:'reject',reason_code:'environment-mismatch'}),
 'missing-metadata':Object.freeze({decision:'reject',reason_code:'metadata-missing'}),
});
const refused=()=>{throw Error('paired-data-refused');};
function own(value,keys){
 if(types.isProxy(value)||value===null||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))refused();
 if(Reflect.ownKeys(value).length!==keys.length)refused();const out=Object.create(null);
 for(const key of keys){const p=Object.getOwnPropertyDescriptor(value,key);if(!p||!Object.hasOwn(p,'value')||p.value===undefined)refused();out[key]=p.value;}return out;
}
const number=value=>{if(!Number.isFinite(value)||value<0)refused();return value;};
const count=value=>{number(value);if(!Number.isSafeInteger(value))refused();return value;};
const sha=value=>{if(typeof value!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value))refused();return value;};
const sha64=value=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))refused();return value;};
export const pairDigest=text=>{if(typeof text!=='string')refused();return createHash('sha256').update(text).digest('hex');};
export function caseTruth(id){if(!PAIR_CASES.includes(id))refused();return outcomes[id];}
export function pairedOrder(){return Object.freeze(PAIR_CASES.flatMap((case_id,index)=>(index%2?['guided','baseline']:['baseline','guided']).map(arm=>Object.freeze({case_id,arm}))));}
export function pairedFixture(id,source,environment){
 caseTruth(id);sha(source);if(typeof environment!=='string'||!/^[a-f0-9]{64}$/.test(environment))refused();
 const alternateSource=(source==='f'.repeat(source.length)?'e':'f').repeat(source.length);
 return Object.freeze({case_id:id,source_sha:id==='stale-artifact'?alternateSource:source,env_fingerprint:id==='environment-drift'?pairDigest(`other-environment:${environment}`):environment,
  ...(id==='missing-metadata'?{}:{title:'synthetic-metadata',format_version:1})});
}
export function expectedFixtureContract(source,environment){sha(source);if(typeof environment!=='string'||!/^[a-f0-9]{64}$/.test(environment))refused();
 return Object.freeze({source_sha:source,env_fingerprint:environment,required_fields:Object.freeze(['title','format_version']),format_version:1});}
export function strictPairedDecision(text,id){
 caseTruth(id);if(typeof text!=='string'||text.length>512)refused();let v;try{v=own(JSON.parse(text),['case_id','decision','reason_code']);}catch{refused();}
 if(v.case_id!==id||!['accept','reject'].includes(v.decision)||!['metadata-current','source-mismatch','environment-mismatch','metadata-missing'].includes(v.reason_code))refused();
 return Object.freeze({case_id:id,decision:v.decision,reason_code:v.reason_code});
}
const MEASUREMENT_KEYS=['case_id','arm','source_sha','harness_source_sha','provider','model','thinking','sdk','runtime_digest','system_prompt_digest','tool_definition_digest','task_prompt_digest','timeout_ms','round_budget','run_identity_digest','session_identity_digest','guidance_mode','history_digest','context_digest','history_current_verification','guidance_reimported','guidance_currently_verified','authorization','executable','success','failure_category','trace_accuracy','decision_parsed','disagreement_count','elapsed_ms','request_attempts','retry_count','cancelled','tool_calls','human_interventions','tokens','sdk_cost','cost_priced','output_digest'];
const TOKEN_KEYS=['input','output','cacheRead','cacheWrite','reasoning','total'];
function guidance(v){
 if(!['none','historical-observed'].includes(v.guidance_mode)||typeof v.guidance_reimported!=='boolean'||typeof v.guidance_currently_verified!=='boolean'||v.authorization!=='none'||v.executable!==false)refused();
 if(v.guidance_mode==='none'){
  if(v.history_digest!==null||v.context_digest!==null||v.history_current_verification!=='none'||v.guidance_reimported||v.guidance_currently_verified)refused();
 }else{
  if(v.history_digest!==PAIR_HISTORY_DIGEST)refused();sha64(v.context_digest);
  if(v.history_current_verification!=='not-checked'||v.guidance_reimported!==true||v.guidance_currently_verified!==true)refused();
 }
}
/** Closed measured metadata, NOT opaque proof or execution authority. The runtime
 * must collect evidence/current context itself; these labels never restore it. */
export function snapshotPairMeasurement(input){
 const v=own(input,MEASUREMENT_KEYS);sha(v.harness_source_sha);
 caseTruth(v.case_id);if(!PAIR_ARMS.includes(v.arm)||v.thinking!=='max'||v.sdk!=='1.0.4'||typeof v.success!=='boolean'||typeof v.cost_priced!=='boolean'||typeof v.trace_accuracy!=='boolean'||typeof v.decision_parsed!=='boolean'||typeof v.cancelled!=='boolean')refused();
 if(v.source_sha!==PAIR_SOURCE_SHA||v.provider!=='codex-local-8319'||v.model!=='gpt-6.1-sol'||typeof v.failure_category!=='string'||!PAIR_FAILURE_CATEGORIES.includes(v.failure_category))refused();
 for(const key of ['runtime_digest','system_prompt_digest','tool_definition_digest','task_prompt_digest','run_identity_digest','session_identity_digest'])sha64(v[key]);
 if(v.timeout_ms!==PAIR_TIMEOUT_MS||v.round_budget!==PAIR_ROUND_BUDGET)refused();
 guidance(v);if(v.arm==='baseline'?v.guidance_mode!=='none':v.guidance_mode!=='historical-observed')refused();
 if(count(v.request_attempts)>PAIR_ROUND_BUDGET||count(v.retry_count)!==0||v.run_identity_digest===v.session_identity_digest)refused();
 if(v.success){if(v.failure_category!=='none'||v.cancelled||!v.trace_accuracy||!v.decision_parsed||v.disagreement_count!==0)refused();}else if(v.failure_category==='none')refused();
 const t=own(v.tokens,TOKEN_KEYS);for(const key of TOKEN_KEYS)if(key!=='reasoning'||t[key]!==null)count(t[key]);
 if(v.sdk_cost!==null)number(v.sdk_cost);if(v.cost_priced?(v.sdk_cost===null||v.sdk_cost===0):v.sdk_cost!==null)refused();
 if(typeof v.output_digest!=='string'||!/^[a-f0-9]{64}$/.test(v.output_digest))refused();
 return Object.freeze({...v,disagreement_count:count(v.disagreement_count),elapsed_ms:number(v.elapsed_ms),request_attempts:count(v.request_attempts),retry_count:count(v.retry_count),tool_calls:count(v.tool_calls),human_interventions:count(v.human_interventions),tokens:Object.freeze({...t})});
}
function armRows(rows,which){return rows.filter(x=>x.arm===which);}
function summarize(rows,which){
 const r=armRows(rows,which),failure_categories=Object.fromEntries(PAIR_FAILURE_CATEGORIES.map(category=>[category,r.filter(x=>x.failure_category===category).length]));
 return Object.freeze({runs:r.length,successes:r.filter(x=>x.success).length,trace_accurate:r.filter(x=>x.trace_accuracy).length,decision_parsed:r.filter(x=>x.decision_parsed).length,unknown_runs:r.filter(x=>UNKNOWN_FAILURES.has(x.failure_category)).length,elapsed_ms:r.reduce((n,x)=>n+x.elapsed_ms,0),request_attempts:r.reduce((n,x)=>n+x.request_attempts,0),retry_count:r.reduce((n,x)=>n+x.retry_count,0),tokens:r.reduce((n,x)=>n+x.tokens.total,0),reasoning_tokens:r.every(x=>x.tokens.reasoning!==null)?r.reduce((n,x)=>n+x.tokens.reasoning,0):null,tool_calls:r.reduce((n,x)=>n+x.tool_calls,0),human_interventions:r.reduce((n,x)=>n+x.human_interventions,0),disagreements:r.reduce((n,x)=>n+x.disagreement_count,0),sdk_cost:r.every(x=>x.cost_priced)?r.reduce((n,x)=>n+x.sdk_cost,0):null,failure_categories:Object.freeze(failure_categories)});
}
export function aggregatePairedMeasurements(input){
 if(types.isProxy(input)||!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||input.length!==8||Reflect.ownKeys(input).length!==9)refused();
 const rows=[];for(let i=0;i<input.length;i++){const p=Object.getOwnPropertyDescriptor(input,String(i));if(!p||!Object.hasOwn(p,'value'))refused();rows.push(snapshotPairMeasurement(p.value));}
 const seen=new Set(),identities=new Set();const first=rows[0];
 for(const r of rows){const key=r.case_id+'/'+r.arm;if(seen.has(key)||identities.has(r.run_identity_digest)||identities.has(r.session_identity_digest))refused();seen.add(key);identities.add(r.run_identity_digest);identities.add(r.session_identity_digest);
  for(const field of ['source_sha','harness_source_sha','provider','model','thinking','sdk','runtime_digest','system_prompt_digest','tool_definition_digest','timeout_ms','round_budget'])if(r[field]!==first[field])refused();}
 if(rows.reduce((n,r)=>n+r.request_attempts,0)>16)refused();
 const pairs=PAIR_CASES.map(case_id=>{const base=rows.find(x=>x.case_id===case_id&&x.arm==='baseline'),guided=rows.find(x=>x.case_id===case_id&&x.arm==='guided');if(!base||!guided||base.task_prompt_digest!==guided.task_prompt_digest)refused();
  return Object.freeze({case_id,baseline_success:base.success,guided_success:guided.success,success_delta:Number(guided.success)-Number(base.success),baseline_trace_accuracy:base.trace_accuracy,guided_trace_accuracy:guided.trace_accuracy,trace_delta:Number(guided.trace_accuracy)-Number(base.trace_accuracy),baseline_failure_category:base.failure_category,guided_failure_category:guided.failure_category,elapsed_delta_ms:guided.elapsed_ms-base.elapsed_ms,requests_delta:guided.request_attempts-base.request_attempts,tokens_delta:guided.tokens.total-base.tokens.total,reasoning_tokens_delta:base.tokens.reasoning===null||guided.tokens.reasoning===null?null:guided.tokens.reasoning-base.tokens.reasoning,tool_calls_delta:guided.tool_calls-base.tool_calls,human_delta:guided.human_interventions-base.human_interventions,disagreement_delta:guided.disagreement_count-base.disagreement_count,sdk_cost_delta:base.cost_priced&&guided.cost_priced?guided.sdk_cost-base.sdk_cost:null});});
 const baseline=summarize(rows,'baseline'),guided=summarize(rows,'guided'),unknown_runs=rows.filter(r=>UNKNOWN_FAILURES.has(r.failure_category)).length,decision_parsed=rows.filter(r=>r.decision_parsed).length;
 return Object.freeze({schema:1,evaluation:'actual-paired-pilot',evaluation_status:unknown_runs>0||decision_parsed===0?'unknown':'measured',capability_claim:'none',authorization:'none',executable:false,pair_count:4,source_sha:first.source_sha,harness_source_sha:first.harness_source_sha,provider:first.provider,model:first.model,thinking:first.thinking,sdk:first.sdk,runtime_digest:first.runtime_digest,system_prompt_digest:first.system_prompt_digest,tool_definition_digest:first.tool_definition_digest,timeout_ms:first.timeout_ms,round_budget:first.round_budget,unknown_runs,decision_parsed,baseline,guided,pairs:Object.freeze(pairs),scope:'four-synthetic-metadata-cases-one-runtime-window-not-generalized-benefit',cost_basis:'SDK-configured-estimate-not-independent-billing'});
}
