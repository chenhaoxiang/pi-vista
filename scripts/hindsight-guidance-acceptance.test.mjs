import assert from 'node:assert/strict';
import test from 'node:test';
import {guidanceAcceptanceOptions,guidanceAcceptance} from './hindsight-guidance-acceptance.mjs';
const args=['--phase=write',`--source-sha=${'a'.repeat(40)}`,'--namespace=fixture-guidance','--credential-config=/fixture/credential.json','--service-fingerprint=/fixture/service.json','--timeout-ms=120000','--allow-bank-write'];
test('guidance actual-bank admission is explicit closed, with no network/default-model/bank overrides',()=>{
 const options=guidanceAcceptanceOptions(args);assert.ok(Object.isFrozen(options));assert.equal(options.phase,'write');assert.equal(options.lost_ack,false);
 for(const invalid of [[],args.slice(0,-1),[...args,'--allow-bank-write'],[...args,'--network'],[...args,'--bank=main'],[...args,'--endpoint=http://example.invalid'],
  args.map(x=>x.startsWith('--source-sha')?'--source-sha=bad':x),args.map(x=>x.startsWith('--namespace')?'--namespace=../outside':x),
  args.map(x=>x.startsWith('--namespace')?'--namespace=wrapped_ghp_abcdefghijklmnop':x),args.map(x=>x.startsWith('--credential-config')?'--credential-config=relative':x),
  args.map(x=>x.startsWith('--timeout')?'--timeout-ms=180001':x)])assert.throws(()=>guidanceAcceptanceOptions(invalid));
});
test('guidance restarted client cannot inherit write or lost-ack permissions',()=>{
 const read=args.map(x=>x==='--phase=write'?'--phase=read':x==='--allow-bank-write'?'--allow-bank-read':x);assert.equal(guidanceAcceptanceOptions(read).phase,'read');
 assert.throws(()=>guidanceAcceptanceOptions([...read,'--inject-lost-ack']));assert.throws(()=>guidanceAcceptanceOptions([...read,'--allow-bank-write']));
});
test('guidance loss injection is an explicit write-only failure scenario',()=>{
 const options=guidanceAcceptanceOptions([...args,'--inject-lost-ack']);assert.equal(options.lost_ack,true);assert.equal(options.phase,'write');
});
test('guidance effectful entry rejects hostile fields before filesystem/credential/network access',async()=>{
 let traps=0;const proxy=new Proxy({}, {ownKeys(){traps++;throw Error();},get(){traps++;throw Error();}});
 const accessor=Object.defineProperty({...guidanceAcceptanceOptions(args)},'namespace',{get(){traps++;throw Error();}});Object.freeze(accessor);
 const coercion={toString(){traps++;throw Error();}};
 for(const value of [proxy,accessor,null,{},Object.freeze({...guidanceAcceptanceOptions(args),namespace:coercion}),Object.freeze({...guidanceAcceptanceOptions(args),extra:true})])
  await assert.rejects(()=>guidanceAcceptance(value));
 assert.equal(traps,0);
});
