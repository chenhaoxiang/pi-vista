import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LearningError, type ExperienceObservation } from "../contract.js";
import { hash } from "../data.js";
import { createHindsightGuidanceStore, prepareHistoricalGuidance } from "./index.js";
import { writeRequest } from "./data.js";

const root = fileURLToPath(new URL("../../../../tmp/guidance-negative/", import.meta.url));
const raw = (): ExperienceObservation => ({ experience_id: "fixture-guide", run_id: "fixture-run", repo: "fixture-repo", source_sha: "a".repeat(40),
  policy_version: "fixture-v1", env_fingerprint: "fixture-env", task_type: "fixture-task", ts: 1000,
  script: { task_type: "fixture-task", description: "inspect fixture metadata", preconditions: [], steps: ["inspect-fixture"], postconditions: [], known_failures: [], applicable_to: [] },
  steps: [{ step_id: "fixture-step", tool: "fixture-reader", action_description: "inspect metadata", check_fn_ids: [], expected_result: "observed", on_failure: "stop", depends_on: [] }] });
const signal = () => new AbortController().signal;
async function fixture() {
  await mkdir(root, { recursive: true }); const owned = await mkdtemp(path.join(root, "case-")); const journal = path.join(owned, "journal"); await mkdir(journal, { mode: 0o700 });
  const documents = new Map<string, string>(); let retains = 0; let foreignRequests = 0;
  const state = { bodyMode: "normal", suppressOriginal: false };
  const server = createServer(async (req, res) => {
    const route = new URL(req.url!, "http://fixture").pathname;
    if (route.endsWith('/config')) { res.writeHead(200, { 'content-type': 'application/json' });res.end(JSON.stringify({bank_id:'fixture-bank',config:{},overrides:{}}));return; }
    if (route.includes('/documents/')) {
      const id = route.split('/').pop()!;const text = documents.get(id);
      if (!text || state.suppressOriginal) {res.writeHead(404);res.end('{}');return;}
      if (state.bodyMode === 'redirect') {res.writeHead(302, {location:`http://127.0.0.1:${(server.address() as {port:number}).port}/foreign`});res.end();return;}
      if (state.bodyMode === 'invalid-utf8') {res.writeHead(200);res.end(Buffer.from([0xff,0xfe]));return;}
      if (state.bodyMode === 'oversized') {res.writeHead(200, {'content-length':'1048577'});res.end('x');return;}
      let value = {id,bank_id:'fixture-bank',original_text:text,content_hash:null,created_at:'fixture-time',updated_at:'fixture-time',memory_unit_count:1};
      if (state.bodyMode === 'substituted') value = {...value,original_text:text+' '};
      res.writeHead(200, {'content-type':'application/json'});res.end(JSON.stringify(value));return;
    }
    if (route === '/foreign') {foreignRequests++;res.writeHead(200);res.end('{}');return;}
    let body='';for await(const part of req)body+=part.toString();const value=JSON.parse(body);retains++;
    documents.set(value.items[0].document_id,value.items[0].content);res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({success:true,bank_id:'fixture-bank',items_count:1,async:false}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const endpoint=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const config={mode:'local-guidance' as const,endpoint,banks:{'fixture-alias':'fixture-bank'},journal_directory:journal,allow_loopback_http:true,timeout_ms:1000};
  const store=createHindsightGuidanceStore(config);const close=async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(owned,{recursive:true,force:true});};
  return{owned,journal,config,store,state,documents,retains:()=>retains,foreign:()=>foreignRequests,close};
}
const fixed=(e:unknown)=>e instanceof LearningError&&['sink-failed','sink-timeout','sink-mismatch'].includes(e.code);

test('guidance import/factory performs no root creation or fetch',async t=>{
 const f=await fixture();try{let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('not allowed');});
  const absent=path.join(f.owned,'not-created');const store=createHindsightGuidanceStore({...f.config,journal_directory:absent});
  assert.ok(Object.isFrozen(store));assert.equal(calls,0);await assert.rejects(()=>lstat(absent));
 }finally{await f.close();}
});
for(const mode of ['redirect','invalid-utf8','oversized','substituted']){
 test(`guidance ${mode} refuses and keeps the committed attempt non-replayable`,async()=>{
  const f=await fixture();try{f.state.bodyMode=mode;const doc=prepareHistoricalGuidance(raw());
   await assert.rejects(()=>f.store.retain('fixture-alias',doc,signal()),fixed);assert.equal(f.retains(),1);assert.equal(f.foreign(),0);
   assert.equal((await f.store.reconcile('fixture-alias',doc,signal())).state,'not-confirmed');assert.equal(f.retains(),1);
  }finally{await f.close();}
 });
}
test('guidance deleted remote original with completed intent cannot cause another retain',async()=>{
 const f=await fixture();try{const doc=prepareHistoricalGuidance(raw());await f.store.retain('fixture-alias',doc,signal());f.documents.clear();
  await assert.rejects(()=>f.store.retain('fixture-alias',doc,signal()),fixed);assert.equal(f.retains(),1);
  assert.equal((await f.store.reconcile('fixture-alias',doc,signal())).state,'not-confirmed');
 }finally{await f.close();}
});
test('guidance symlink intent refuses without reading an arbitrary file or POST',async()=>{
 const f=await fixture();try{const doc=prepareHistoricalGuidance(raw());const request=writeRequest('fixture-alias',doc);
  const target=path.join(f.owned,'fixture-only-target');await writeFile(target,'not an intent',{mode:0o600});
  await symlink(target,path.join(f.journal,`${hash(request.idempotency_key)}.intent`));await assert.rejects(()=>f.store.retain('fixture-alias',doc,signal()),fixed);
  assert.equal(f.retains(),0);assert.equal(await readFile(target,'utf8'),'not an intent');
 }finally{await f.close();}
});
test('guidance concurrent creators cannot both POST the same exact request',async()=>{
 const f=await fixture();try{const doc=prepareHistoricalGuidance(raw());const other=createHindsightGuidanceStore(f.config);
  const results=await Promise.allSettled([f.store.retain('fixture-alias',doc,signal()),other.retain('fixture-alias',doc,signal())]);
  assert.equal(f.retains(),1);assert.ok(results.some(r=>r.status==='fulfilled'));
  assert.equal((await f.store.reconcile('fixture-alias',doc,signal())).state,'matched');
 }finally{await f.close();}
});
test('guidance target drift cannot reuse a durable claim',async t=>{
 const f=await fixture();try{const doc=prepareHistoricalGuidance(raw());await f.store.retain('fixture-alias',doc,signal());
  let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('unexpected target access');});
  const redirected=createHindsightGuidanceStore({...f.config,endpoint:'https://example.invalid'});
  assert.equal((await redirected.reconcile('fixture-alias',doc,signal())).state,'not-confirmed');assert.equal(f.retains(),1);assert.equal(requests,0);
 }finally{await f.close();}
});
