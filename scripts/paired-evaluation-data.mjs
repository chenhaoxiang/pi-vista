import {createHash} from 'node:crypto';
import {types} from 'node:util';

export const PAIR_CASES=Object.freeze(['healthy-metadata','stale-artifact','environment-drift','missing-metadata']);
export const PAIR_ARMS=Object.freeze(['baseline','guided']);
export const PAIR_TOOL='paired_inspect_metadata';
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
export const pairDigest=text=>{if(typeof text!=='string')refused();return createHash('sha256').update(text).digest('hex');};
export function caseTruth(id){if(!PAIR_CASES.includes(id))refused();return outcomes[id];}
export function pairedOrder(){return Object.freeze(PAIR_CASES.flatMap((case_id,index)=>(index%2?['guided','baseline']:['baseline','guided']).map(arm=>Object.freeze({case_id,arm}))));}
export function pairedFixture(id,source,environment){
 caseTruth(id);sha(source);if(typeof environment!=='string'||!/^[a-f0-9]{64}$/.test(environment))refused();
 return Object.freeze({case_id:id,source_sha:id==='stale-artifact'?(source==='f'.repeat(40)?'e'.repeat(40):'f'.repeat(40)):source,env_fingerprint:id==='environment-drift'?'fixture-other-environment':environment,
  ...(id==='missing-metadata'?{}:{title:'synthetic-metadata',format_version:1})});
}
export function expectedFixtureContract(source,environment){sha(source);if(typeof environment!=='string'||!/^[a-f0-9]{64}$/.test(environment))refused();
 return Object.freeze({source_sha:source,env_fingerprint:environment,required_fields:Object.freeze(['title','format_version']),format_version:1});}
export function strictPairedDecision(text,id){
 caseTruth(id);if(typeof text!=='string'||text.length>512)refused();let v;try{v=own(JSON.parse(text),['case_id','decision','reason_code']);}catch{refused();}
 if(v.case_id!==id||!['accept','reject'].includes(v.decision)||!['metadata-current','source-mismatch','environment-mismatch','metadata-missing'].includes(v.reason_code))refused();
 return Object.freeze({case_id:id,decision:v.decision,reason_code:v.reason_code});
}
export function snapshotPairMeasurement(input){
 const v=own(input,['case_id','arm','source_sha','provider','model','thinking','sdk','success','failure_category','elapsed_ms','request_attempts','tool_calls','human_interventions','tokens','sdk_cost','cost_priced','output_digest']);
 caseTruth(v.case_id);if(!PAIR_ARMS.includes(v.arm)||v.thinking!=='max'||v.sdk!=='1.0.4'||typeof v.success!=='boolean'||typeof v.cost_priced!=='boolean')refused();sha(v.source_sha);
 if(v.provider!=='codex-local-8319'||v.model!=='gpt-6.1-sol'||typeof v.failure_category!=='string'||!['none','fixture-mismatch','authentication','quota','timeout','provider-unavailable','request-contract','stream-disconnected','cancelled','unspecified','unclassified-provider-error','deadline','round-budget','model-drift','external-failure'].includes(v.failure_category))refused();
 const t=own(v.tokens,['input','output','cacheRead','cacheWrite','total']);for(const key of Object.keys(t))count(t[key]);
 if(v.sdk_cost!==null)number(v.sdk_cost);if(v.cost_priced?v.sdk_cost===null:v.sdk_cost!==null)refused();if(typeof v.output_digest!=='string'||!/^[a-f0-9]{64}$/.test(v.output_digest))refused();
 return Object.freeze({...v,elapsed_ms:number(v.elapsed_ms),request_attempts:count(v.request_attempts),tool_calls:count(v.tool_calls),human_interventions:count(v.human_interventions),tokens:Object.freeze({...t})});
}
export function aggregatePairedMeasurements(input){
 if(types.isProxy(input)||!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||input.length!==8||Reflect.ownKeys(input).length!==9)refused();
 const rows=[];for(let i=0;i<input.length;i++){const p=Object.getOwnPropertyDescriptor(input,String(i));if(!p||!Object.hasOwn(p,'value'))refused();rows.push(snapshotPairMeasurement(p.value));}
 const seen=new Set();const first=rows[0];for(const r of rows){const key=r.case_id+'/'+r.arm;if(seen.has(key))refused();seen.add(key);for(const field of ['source_sha','provider','model','thinking','sdk'])if(r[field]!==first[field])refused();}
 const pairs=PAIR_CASES.map(case_id=>{const base=rows.find(x=>x.case_id===case_id&&x.arm==='baseline'),guided=rows.find(x=>x.case_id===case_id&&x.arm==='guided');if(!base||!guided)refused();
  return Object.freeze({case_id,baseline_success:base.success,guided_success:guided.success,success_delta:Number(guided.success)-Number(base.success),elapsed_delta_ms:guided.elapsed_ms-base.elapsed_ms,
   requests_delta:guided.request_attempts-base.request_attempts,tokens_delta:guided.tokens.total-base.tokens.total,tool_calls_delta:guided.tool_calls-base.tool_calls,human_delta:guided.human_interventions-base.human_interventions,
   sdk_cost_delta:base.cost_priced&&guided.cost_priced?guided.sdk_cost-base.sdk_cost:null});});
 const arm=which=>{const r=rows.filter(x=>x.arm===which);return Object.freeze({runs:r.length,successes:r.filter(x=>x.success).length,elapsed_ms:r.reduce((n,x)=>n+x.elapsed_ms,0),request_attempts:r.reduce((n,x)=>n+x.request_attempts,0),tokens:r.reduce((n,x)=>n+x.tokens.total,0),tool_calls:r.reduce((n,x)=>n+x.tool_calls,0),human_interventions:r.reduce((n,x)=>n+x.human_interventions,0),sdk_cost:r.every(x=>x.cost_priced)?r.reduce((n,x)=>n+x.sdk_cost,0):null});};
 return Object.freeze({schema:1,evaluation:'actual-paired-pilot',capability_claim:'none',authorization:'none',executable:false,pair_count:4,source_sha:first.source_sha,provider:first.provider,model:first.model,thinking:first.thinking,sdk:first.sdk,
  baseline:arm('baseline'),guided:arm('guided'),pairs:Object.freeze(pairs),scope:'four-synthetic-metadata-cases-one-runtime-window-not-generalized-benefit',cost_basis:'SDK-configured-estimate-not-independent-billing'});
}
