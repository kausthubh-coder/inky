import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConversationCoordinator } from "../../dist/electron/agent/conversation-coordinator.js";
import { FakeAgentRuntime } from "../../dist/electron/agent/runtime.js";
import { ManagerCoordinator } from "../../dist/electron/manager/coordinator.js";
import { openLocalStore } from "../../dist/electron/storage/index.js";

test("addressed sends keep home separate and resume one assignment job across restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-conversations-"));
  let store;
  let manager;
  let conversations;
  try {
    store = await openLocalStore(root);
    store.assignments.put({
      schemaVersion: 1,
      assignmentId: "assignment-statistics",
      courseId: "course-statistics",
      title: "Confidence intervals",
      sourceTarget: "https://school.example.edu/assignments/statistics",
      discoveredAt: "2026-09-03T12:00:00.000Z",
      lastVerifiedScanId: "scan-1",
      evidence: [],
    });
    const runtime = new FakeAgentRuntime();
    manager = await ManagerCoordinator.create(store, runtime);
    conversations = new ConversationCoordinator(store, runtime, manager);

    const first = await conversations.send(
      { kind: "assignment", assignmentId: "assignment-statistics" },
      "What does this ask?",
    );
    const second = await conversations.send(
      { kind: "assignment", assignmentId: "assignment-statistics" },
      "Give me the next step.",
    );
    const home = await conversations.send({ kind: "home" }, "What is next this week?");
    assert.equal(second.job.jobId, first.job.jobId);
    assert.equal(second.job.turnIndex, 2);
    assert.equal(second.job.messages.length, 4);
    assert.notEqual(home.job.jobId, first.job.jobId);
    assert.deepEqual(first.job.target, { kind: "assignment", assignmentId: "assignment-statistics" });

    const assignmentPath = store.agentJobs.get(first.job.jobId).sessionPath;
    conversations.dispose();
    manager.dispose();
    store.close();

    store = await openLocalStore(root);
    const restartedRuntime = new FakeAgentRuntime();
    manager = await ManagerCoordinator.create(store, restartedRuntime);
    conversations = new ConversationCoordinator(store, restartedRuntime, manager);
    const third = await conversations.send(
      { kind: "assignment", assignmentId: "assignment-statistics" },
      "Check that again.",
    );
    assert.equal(third.job.jobId, first.job.jobId);
    assert.equal(third.job.turnIndex, 3);
    assert.equal(third.job.messages.length, 6);
    assert.equal(store.agentJobs.get(first.job.jobId).sessionPath, assignmentPath);
    assert.equal(conversations.selectAssignment("assignment-statistics").job.jobId, first.job.jobId);
    assert.throws(() => conversations.selectAssignment("missing"), /does not exist/);
  } finally {
    conversations?.dispose();
    manager?.dispose();
    store?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('one home conversation keeps stable refs, deduplicates delivery and survives restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studi-chat-delivery-'));let store,manager,chat;
 try{
  store=await openLocalStore(root);const runtime=new FakeAgentRuntime();manager=await ManagerCoordinator.create(store,runtime);chat=new ConversationCoordinator(store,runtime,manager);
  store.assignments.put({schemaVersion:1,assignmentId:'math',courseId:'algebra',title:'Canonical title',sourceTarget:'https://school.example.edu/math',discoveredAt:'2026-09-03T12:00:00.000Z',lastVerifiedScanId:'scan-1',evidence:[]});
  const metadata={clientMessageId:'00000000-0000-4000-8000-000000000001',assignmentRefs:[{assignmentId:'math',title:'Forged label'}]};
  const first=await chat.send({kind:'home'},'Explain this',metadata);const duplicate=await chat.send({kind:'home'},'Explain this',metadata);
  assert.equal(duplicate.job.messages.length,2);assert.equal(duplicate.job.jobId,first.job.jobId);assert.equal(first.job.messages[0].assignmentRefs[0].title,'Canonical title');assert.equal(chat.state().activity,'idle');assert.equal(chat.isBusy,false);
  await assert.rejects(chat.send({kind:'home'},'Deleted ref',{assignmentRefs:[{assignmentId:'deleted',title:'Missing'}]}),/no longer/);assert.equal(chat.state().job.messages.length,2);
  chat.dispose();manager.dispose();store.close();store=await openLocalStore(root);manager=await ManagerCoordinator.create(store,runtime);chat=new ConversationCoordinator(store,runtime,manager);assert.equal(chat.state().job.jobId,first.job.jobId);assert.deepEqual(chat.state().job.messages,first.job.messages);
 }finally{chat?.dispose();manager?.dispose();store?.close();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('stop during session setup aborts once; failed replies remain recoverable and observable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studi-chat-stop-'));let store,manager,chat;
 try{
  store=await openLocalStore(root);const base=new FakeAgentRuntime();manager=await ManagerCoordinator.create(store,base);
  let release;let began;const entered=new Promise(r=>began=r);const gate=new Promise(r=>release=r);
  const runtime={createJobSession:async(...args)=>{began();await gate;return base.createJobSession(...args);}};
  chat=new ConversationCoordinator(store,runtime,manager);const pending=chat.send({kind:'home'},'Wait for me');await entered;assert.equal(chat.state().activity,'thinking');await chat.stop();release();const stopped=await pending;assert.equal(stopped.outcome,'aborted');assert.equal(stopped.job.messages[1].recovery,'aborted');assert.equal(chat.isBusy,false);
  chat.dispose();chat=new ConversationCoordinator(store,{createJobSession:async()=>{throw new Error('Provider disconnected');}},manager);const failed=await chat.send({kind:'home'},'Try this');assert.equal(failed.outcome,'failed');assert.equal(failed.job.messages.at(-1).recovery,'failed');assert.equal(chat.state().activity,'idle');assert.ok(chat.trace.events().some(e=>e.type==='error'));
 }finally{chat?.dispose();manager?.dispose();store?.close();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('account home histories stay separate and interrupted acceptance recovers once',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studi-chat-account-'));let store,manager,chat;
 try{store=await openLocalStore(root);const runtime=new FakeAgentRuntime();manager=await ManagerCoordinator.create(store,runtime);
 chat=new ConversationCoordinator(store,runtime,manager,{ownerSubject:'qa-one'});const one=await chat.send({kind:'home'},'My message');chat.dispose();
 chat=new ConversationCoordinator(store,runtime,manager,{ownerSubject:'qa-two'});assert.notEqual(chat.state().job.jobId,one.job.jobId);assert.equal(chat.state().job.messages.length,0);
 const job=chat.state().job;store.agentJobs.put({...job,turnIndex:1,messages:[{messageId:'interrupted-user',role:'user',text:'Keep this',createdAt:new Date().toISOString(),turnIndex:1}]});assert.equal(chat.state().job.messages.length,2);assert.equal(chat.state().job.messages.length,2);assert.equal(chat.state().job.messages.at(-1).recovery,'failed');chat.dispose();
 chat=new ConversationCoordinator(store,runtime,manager,{ownerSubject:'qa-one'});assert.deepEqual(chat.state().job.messages,one.job.messages);
 }finally{chat?.dispose();manager?.dispose();store?.close();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
