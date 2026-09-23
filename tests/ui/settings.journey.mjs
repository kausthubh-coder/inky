import assert from "node:assert/strict";

// Real React screens with the local preview API; no live account or school writes.
export async function verifySettings(page, base) {
  const errors = [], results = [];
  const onError = error => errors.push(error.message);
  page.on("pageerror",onError);
  const tab = label => page.getByRole("navigation",{name:"Settings sections"}).getByRole("button",{name:label,exact:true});
  const button = name => page.getByRole("button",{name,exact:true});
  const open = async id => { await page.goto(`${base}/?preview=${id}`); await page.locator(".st-content").waitFor(); };
  try {
    await page.setViewportSize({width:1120,height:760});
    for (const id of ["inky","homework","school","notifications","you"]) {
      await open("settings-"+id);
      assert.equal(await page.locator(".st-tabs [aria-current=page]").count(),1);
      assert.equal(await page.locator(".rd-mode-switch [aria-current]").count(),0);
      assert.equal(await page.getByRole("searchbox").count(),0);
      assert.equal(await page.getByRole("button",{name:/^Save (changes|schedule|rule|memory)$/}).count(),0);
    }
    await open("settings-inky");
    await button("Normal").click();
    await page.waitForFunction(async()=>(await window.studi.getWorkspaceState()).selectedReasoningEffort==="medium");
    await button("Switch account").click();
    assert.equal(await button("Disconnect ChatGPT").count(),1);
    await button("Switch account").click();
    await button("+ Tell Inky something to remember").click();
    await page.getByLabel("Memory title",{exact:true}).fill("Use diagrams");
    await page.getByLabel("What to remember",{exact:true}).fill("Show a diagram before equations.");
    await button("Done").click();
    await button("Use diagrams").waitFor();
    await button("Use diagrams").click();
    await page.getByLabel("What to remember",{exact:true}).fill("Show a diagram and label its axes.");
    await button("Done").click();
    await page.waitForFunction(async()=>{const notes=await window.studi.listMemories();const n=notes.find(n=>n.title==="Use diagrams");return n&&(await window.studi.readMemory({noteId:n.noteId})).content.includes("axes");});
    const row = page.locator(".st-memory").filter({has:button("Use diagrams")});
    await row.getByRole("button",{name:"Forget"}).click();
    await page.waitForFunction(async()=>!(await window.studi.listMemories()).some(n=>n.title==="Use diagrams"));
    results.push("memory create/edit/forget and effort persist");
    await tab("Homework").click();
    const timer=page.getByRole("spinbutton",{name:"Time to look it over (minutes)",exact:true});
    for(const value of ["","0","121","1.5"]) {await timer.fill(value);await timer.press("Tab");assert.equal(await timer.getAttribute("aria-invalid"),"true");}
    await timer.fill("23");await timer.press("Tab");
    await page.waitForFunction(async()=>(await window.studi.getProductSettings()).preferences.reviewMinutes===23);
    await page.getByLabel("When Inky starts",{exact:true}).selectOption("automatic");
    await page.waitForFunction(async()=>(await window.studi.getProductSettings()).preferences.workStartMode==="automatic");
    await button("Do it and submit").click();
    await page.waitForFunction(async()=>(await window.studi.getProductSettings()).permissionRules.find(r=>r.scope==="global").mode==="auto_submit");
    await button("Check an assignment").click();
    await page.getByLabel("Check an assignment",{exact:true}).selectOption("assignment-sort");
    await page.getByRole("status").filter({hasText:/Matched assignment permission rule/}).waitFor();
    assert.match(await page.locator(".st-form").last().innerText(),/Leave it/,"specific assignment rule wins over global auto-submit");
    await button("+ Add an exception").click();
    await page.getByLabel("Apply this rule to").selectOption("course");
    await page.getByLabel("Which class?").selectOption("course-csc316");
    await page.getByLabel("Exception action").selectOption("attempt");
    await page.waitForFunction(async()=>(await window.studi.getProductSettings()).permissionRules.some(r=>r.scope==="course"&&r.courseId==="course-csc316"&&r.mode==="attempt"));
    await page.evaluate(()=>{window.originalRuleSave=window.studi.savePermissionRule;window.studi.savePermissionRule=async()=>{throw new Error("Controlled rule failure");};});
    await button("Leave it").click();
    await page.getByRole("alert").filter({hasText:"Controlled rule failure"}).waitFor();
    assert.equal(await button("Do it and submit").getAttribute("aria-pressed"),"true","failed save leaves actual saved mode selected");
    await page.evaluate(()=>{window.studi.savePermissionRule=input=>new Promise(resolve=>{window.finishRule=()=>resolve(window.originalRuleSave(input));});});
    await button("Leave it").click();
    await page.waitForFunction(()=>typeof window.finishRule==="function");
    assert.equal(await button("Do it and submit").isDisabled(),true);
    await page.evaluate(()=>window.finishRule());
    await page.waitForFunction(async()=>(await window.studi.getProductSettings()).permissionRules.find(r=>r.scope==="global").mode==="do_not_attempt");
    results.push("review validation, automatic start, rule precedence, failed-save recovery and pending lock");
    await tab("School").click();
    await page.getByLabel("Check automatically").selectOption("weekly");
    await page.getByLabel("Weekday").selectOption("3");
    await page.waitForFunction(async()=>(await window.studi.getProductSettings()).schedule.weekday===3);
    await page.getByLabel("Check automatically").selectOption("daily");
    await page.waitForFunction(async()=>!(await window.studi.getProductSettings()).schedule.weekday);
    await button("Manage").click();
    await page.locator('[data-connected-app="gmail"]').waitFor();
    await tab("Notifications").click();
    const quiet=page.getByRole("switch",{name:"Quiet hours",exact:true});
    assert.equal(await quiet.isChecked(),false);
    await quiet.check();
    await page.getByLabel("Quiet hours start").fill("21:30");
    await page.waitForFunction(async()=>(await window.studi.getProductSettings()).preferences.notifications.quietHours.start==="21:30");
    await quiet.uncheck();
    await page.waitForFunction(async()=>(await window.studi.getProductSettings()).preferences.notifications.quietHours==="off");
    await page.getByLabel("Sound for Inky needs you").selectOption("silent");
    await page.waitForFunction(async()=>(await window.studi.getProductSettings()).preferences.notifications.kinds.handoff.sound==="silent");
    await button("Preview Inky needs you").click();
    await page.getByRole("status").filter({hasText:/No banner shown/}).waitFor();
    results.push("schedule changes, connected-app expansion, quiet-hours defaults/persistence and sound preview");
    await tab("You").click();await button("Tell us").click();
    const note=page.getByRole("textbox",{name:"Your note",exact:true});
    await note.fill("Please keep this if sending fails.");
    await page.evaluate(()=>{window.studi.submitFeedback=async()=>{throw new Error("Controlled feedback outage");};});
    await button("Send feedback").click();await button("Try sending again").waitFor();
    assert.equal(await note.inputValue(),"Please keep this if sending fails.");
    await page.evaluate(()=>{window.studi.submitFeedback=async()=>({accepted:true,feedbackId:"00000000-0000-4000-8000-000000000002"});});
    await button("Try sending again").click();
    await page.getByRole("status").filter({hasText:"Thanks — the Studi team received your note."}).waitFor();
    assert.equal(await note.inputValue(),"");
    results.push("feedback failed-send retention and retry");
    for(const width of [1120,720,390]) {
      await page.setViewportSize({width,height:760});
      for(const id of ["inky","homework","school","notifications","you"]) {
        await open("settings-"+id);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,id+" overflow "+width);
        const hidden = await page.locator(".st-content button:visible, .st-content select:visible").evaluateAll(els=>els.some(el=>{const r=el.getBoundingClientRect();return r.right>innerWidth+1||r.left<0;}));
        assert.equal(hidden,false,id+" clipped control "+width);
      }
    }
    results.push("all five tabs fit 1120/720/390px; no page errors");
    assert.deepEqual(errors,[]);
    return results;
  } finally {page.off("pageerror",onError);}
}
