import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import path from 'node:path';
import {types} from 'node:util';
import {createHash} from 'node:crypto';

const refused=()=>{throw Error('guidance-trial-policy-refused');};
function fields(value,keys){
 if(types.isProxy(value)||value===null||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))refused();
 const own=Reflect.ownKeys(value);if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))refused();
 const safe=Object.create(null);
 for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))refused();safe[key]=d.value;}
 return safe;
}
/** Historical trial comparison only; never an approval ledger or current proof. */
export async function bindGuidanceTrialPolicy(directory,phase,binding){
 if(typeof directory!=='string'||directory.length>4096||/[\x00-\x1f\x7f]/.test(directory)||!path.isAbsolute(directory)||path.normalize(directory)!==directory||!['write','read'].includes(phase))refused();
 const input=fields(binding,['source_sha','namespace','bank']);
 if(typeof input.source_sha!=='string'||!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(input.source_sha)||typeof input.namespace!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(input.namespace))refused();
 const bank=fields(input.bank,['bank','extraction_mode','observations','default_strategy','bank_state_sha256']);
 if(bank.bank!=='pi-vista-local-test-01a114ab'||bank.extraction_mode!=='chunks'||bank.observations!==false||bank.default_strategy!==null||typeof bank.bank_state_sha256!=='string'||!/^[a-f0-9]{64}$/.test(bank.bank_state_sha256))refused();
 const safe=Object.freeze({schema:1,purpose:'historical-guidance-trial-policy',bank:bank.bank,namespace:input.namespace,source_sha:input.source_sha,
  extraction_mode:'chunks',observations:false,default_strategy:null,bank_state_sha256:bank.bank_state_sha256});
 const text=JSON.stringify(safe)+'\n',file=path.join(directory,'trial-policy.json');
 let parent;try{parent=await lstat(directory);}catch{refused();}
 if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid()||(parent.mode&0o7777)!==0o700)refused();
 let handle;
 try{
  if(phase==='write'){
   try{handle=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);}
   catch(error){if(error.code!=='EEXIST')refused();}
   if(handle){
    try{await handle.writeFile(text);await handle.sync();}finally{await handle.close();handle=undefined;}
    const dir=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await dir.sync();}finally{await dir.close();}
   }
  }
  const before=await lstat(file);
  if(!before.isFile()||before.isSymbolicLink()||before.uid!==process.getuid()||(before.mode&0o7777)!==0o600||before.nlink!==1||before.size>8192)refused();
  handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const first=await handle.stat();
  if(first.dev!==before.dev||first.ino!==before.ino||!first.isFile()||first.uid!==process.getuid()||(first.mode&0o7777)!==0o600||first.nlink!==1||first.size>8192)refused();
  const bytes=await handle.readFile(),after=await handle.stat(),named=await lstat(file);
  if(['ino','dev','size','mtimeMs','ctimeMs','nlink','mode','uid'].some(k=>after[k]!==first[k])||named.ino!==first.ino||named.dev!==first.dev||bytes.length!==first.size)refused();
  // Whole closed generated record equality binds all fields; no normalization or reset.
  if(!bytes.equals(Buffer.from(text,'utf8')))throw Error('guidance-trial-policy-mismatch');
  return Object.freeze({...safe,policy_digest:createHash('sha256').update(bytes).digest('hex')});
 }catch(error){
  if(error?.message==='guidance-trial-policy-mismatch')throw error;
  refused();
 }finally{await handle?.close();}
}
