import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stage6Main,stage6Plan,stage6PlanOptions} from './stage6-paired-evaluation.mjs';

test('Stage6 planner explicitly states actual runtime/measurement/release incompleteness',()=>{
 const p=stage6Main(['--plan-only']);assert.equal(p.actualRun,'not-run');assert.equal(p.status,'planned-not-executed');assert.equal(p.max_requests,16);assert.equal(p.pair_order.length,8);assert.equal(p.executable,false);assert.equal(p.authorization,'none');assert.ok(p.incomplete.includes('SDK-session-and-pretransport-request-budget-wiring'));assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.incomplete));
});
test('Stage6 planner cannot be used as an actual runtime or bank/model approval',()=>{
 for(const args of [[],['--allow-live'],['--plan-only','--allow-live'],['--model=elsewhere'],['--allow-bank-write']])assert.throws(()=>stage6Main(args),/stage6-plan-options-refused/);
});
test('Stage6 planner hostile input rejects without getters or executable coercion',()=>{
 let calls=0;const a=Object.defineProperty([],'0',{get(){calls++;throw Error();}});a.length=1;const p=new Proxy(['--plan-only'],{get(){calls++;throw Error();},ownKeys(){calls++;throw Error();}});
 assert.throws(()=>stage6PlanOptions(a));assert.throws(()=>stage6PlanOptions(p));assert.equal(calls,0);
});
test('Stage6 planner import/evaluation is hermetic and has no private config or SDK imports', {timeout:10000},async()=>{
 const dir=fileURLToPath(new URL('../tmp/',import.meta.url));await mkdir(dir,{recursive:true});const owned=await mkdtemp(path.join(dir,'stage6-plan-case-'));
 try{const source=await readFile(new URL('./stage6-paired-evaluation.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/node:fs|node:child_process|@pi-vista|pi-coding-agent|profile-dir|coding-agent.json|readGuidanceCredential/);
 const code=`import assert from 'node:assert/strict';let calls=0;globalThis.fetch=()=>{calls++;throw Error();};globalThis.setTimeout=()=>{calls++;throw Error();};const m=await import(${JSON.stringify(new URL('./stage6-paired-evaluation.mjs',import.meta.url).href)});assert.equal(m.stage6Main(['--plan-only']).actualRun,'not-run');assert.equal(calls,0);console.log(JSON.stringify({calls}));`;
 const r=await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{cwd:owned,env:{PATH:path.dirname(process.execPath),HOME:owned,TMPDIR:owned},shell:false,timeout:5000,maxBuffer:8192});assert.equal(r.stderr,'');assert.deepEqual(JSON.parse(r.stdout),{calls:0});
 }finally{await rm(owned,{recursive:true,force:true});}
});
