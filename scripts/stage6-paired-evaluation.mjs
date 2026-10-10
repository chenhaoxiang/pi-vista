import {types} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {pairedOrder} from './paired-evaluation-data.mjs';

/** Stage6 plan only. Actual SDK/credential/guidance wiring is deliberately not
 * implemented here yet; importing or invoking this planner has no effects. */
export function stage6Plan(){
 return Object.freeze({schema:1,status:'planned-not-executed',actualRun:'not-run',evaluation:'four-case-paired-pilot',
  provider:'codex-local-8319',model:'gpt-6.1-sol',thinking:'max',sdk:'1.0.4',
  pair_order:pairedOrder(),max_requests:16,max_requests_per_session:2,deadline_ms:1200000,
  history_source:'accepted-stage5-local-record-with-new-current-proof-required',
  subject_source_sha:'846b9a0b135dd88a3311c16ba23c24e61d8216f3',
  bank_writes:0,defaultActivation:false,authorization:'none',executable:false,
  incomplete:Object.freeze(['actual-native-subject-evidence-collection','protected-local-history-readback-and-reimport','SDK-session-and-pretransport-request-budget-wiring','actual-paired-measurements','publisher-account-channel-version-and-rollback'])});
}
export function stage6PlanOptions(args){
 if(types.isProxy(args)||!Array.isArray(args)||Object.getPrototypeOf(args)!==Array.prototype||Reflect.ownKeys(args).length!==2)throw Error('stage6-plan-options-refused');
 const d=Object.getOwnPropertyDescriptor(args,'0');
 if(!d||!Object.hasOwn(d,'value')||d.value!=='--plan-only')throw Error('stage6-plan-options-refused');
 return Object.freeze({plan_only:true});
}
export function stage6Main(args){stage6PlanOptions(args);return stage6Plan();}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 try{console.log(JSON.stringify(stage6Main(process.argv.slice(2)),null,2));}
 catch{console.error('stage6-runtime-not-yet-wired');process.exitCode=1;}
}
