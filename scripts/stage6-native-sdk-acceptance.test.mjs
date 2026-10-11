import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseStage6NativeAcceptanceOptions, runStage6NativeAcceptance} from './stage6-native-sdk-acceptance.mjs';

const sha='a'.repeat(40), args=[`--sdk=/synthetic/installed-sdk`,`--source-sha=${sha}`];
const supported=()=>{const [major,minor]=process.versions.node.split('.').map(Number);return major>22||major===22&&minor>=19;};

test('native acceptance requires explicit SDK/source and rejects unsupported runtime without importing it',()=>{
 if(supported()) assert.deepEqual(parseStage6NativeAcceptanceOptions(args),{sdk:'/synthetic/installed-sdk',source_sha:sha});
 else assert.throws(()=>parseStage6NativeAcceptanceOptions(args),/stage6-native-acceptance-refused/);
 for(const value of [[],['--sdk=relative',`--source-sha=${sha}`],[`--sdk=/synthetic/installed-sdk`,'--source-sha=bad'],[...args,'--allow-live'],['--bank=real-bank',`--source-sha=${sha}`]])assert.throws(()=>parseStage6NativeAcceptanceOptions(value),/stage6-native-acceptance-refused/);
});

test('CLI and host-option getters/proxies cannot start a source command, SDK import or provider request',async()=>{
 let calls=0;
 const getter=Object.defineProperty([...args],'0',{get(){calls++;throw Error('PRIVATE');}});
 const proxy=new Proxy(args,{ownKeys(){calls++;throw Error('PRIVATE');}});
 for(const value of [getter,proxy])assert.throws(()=>parseStage6NativeAcceptanceOptions(value),/stage6-native-acceptance-refused/);
 const options={sdk:'/synthetic/installed-sdk',source_sha:sha};
 const optionGetter=Object.defineProperty({...options},'sdk',{get(){calls++;throw Error('PRIVATE');}});
 const optionProxy=new Proxy(options,{get(){calls++;throw Error('PRIVATE');},ownKeys(){calls++;throw Error('PRIVATE');}});
 for(const value of [optionGetter,optionProxy,{...options,provider:'other'}])await assert.rejects(runStage6NativeAcceptance(value),/stage6-native-acceptance-refused/);
 assert.equal(calls,0);
});

test('wrong source binding refuses before touching the explicitly supplied missing SDK path',async()=>{
 await assert.rejects(runStage6NativeAcceptance({sdk:'/nonexistent-native-sdk-fixture',source_sha:sha}),error=>error.message===(supported()?'stage6-native-source-mismatch':'stage6-native-acceptance-refused'));
});

test('importing the native acceptance runner is inert and does not activate an SDK, timer or transport',async()=>{
 const module=new URL('./stage6-native-sdk-acceptance.mjs',import.meta.url).href;
 const result=await promisify(execFile)(process.execPath,['--input-type=module','-e',`globalThis.fetch=()=>{throw Error('fetch');};globalThis.setTimeout=()=>{throw Error('timer');};await import(${JSON.stringify(module)});console.log('imported');`],{env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',TMPDIR:'/nonexistent'},shell:false,timeout:5000});
 assert.equal(result.stdout.trim(),'imported');assert.equal(result.stderr,'');
});
