import assert from 'node:assert/strict';

// Current release controls with controlled IPC. Native and live outcomes are separate gates.
export async function verifyReleaseControls(page, base) {
  const results=[];
  const errors=[];
  const onError=error=>errors.push(error.message);
  page.on('pageerror',onError);
  const button=name=>page.getByRole('button',{name,exact:true});
  const open=async route=>{await page.goto(`${base}/?preview=${route}`);await page.locator('[data-studi-app-ready]').waitFor();};
  try {
    await page.setViewportSize({width:1440,height:950});
    await open('week');
    const range=await page.locator('.rd-week-nav span').innerText();
    await button('Next week').click();
    assert.notEqual(await page.locator('.rd-week-nav span').innerText(),range);
    await button('Previous week').click();
    assert.equal(await page.locator('.rd-week-nav span').innerText(),range);
    await button('List').click();
    await page.getByRole('button',{name:/No due date/}).click();
    await page.getByText('Final project · reading notes',{exact:true}).waitFor();
    await button('All work →').click();
    await button('Done').click();
    await button('To do').click();
    results.push('Week navigation, list, undated shelf and work filters');

    await open('assignment');
    const workspace=page.getByRole('region',{name:'Assignment workspace'});
    await workspace.waitFor();
    await page.evaluate(()=>{const start=window.studi.startAssignment;window.startCalls=0;window.studi.startAssignment=input=>{window.startCalls++;return new Promise(resolve=>{window.finishStart=()=>resolve(start(input));});};});
    await button('Start assignment').click();
    await button('Starting…').waitFor();
    assert.equal(await button('Starting…').isDisabled(),true);
    await page.evaluate(()=>window.finishStart());
    await workspace.getByLabel('Inky’s progress').getByRole('button',{name:'Pause',exact:true}).click();
    await page.getByRole('button',{name:/I’m ready. Continue/}).click();
    await workspace.getByRole('button',{name:'Stop work',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.startCalls),1);
    results.push('Single start while pending, pause, resume, stop');

    await open('desk-review');
    const confirm=button('I submitted it — check');
    assert.equal(await confirm.isDisabled(),true);
    await page.getByLabel('Words shown after submission').fill('Submitted successfully');
    assert.equal(await confirm.isEnabled(),true);
    await button('Let me edit').click();
    await page.getByRole('button',{name:/I’m ready. Continue/}).waitFor();
    results.push('Manual submission requires confirmation; editing returns control to student');

    await open('assignment-restricted');
    assert.equal(await button('Start assignment').isDisabled(),true);
    assert.equal(await button('Start').isDisabled(),true);
    await button('Homework rules').click();
    await page.getByRole('heading',{name:'Homework rules',exact:true}).waitFor();
    await open('assignment-failed');
    await button('Try again').click();
    await page.getByLabel('Inky’s progress').getByRole('button',{name:'Pause',exact:true}).waitFor();
    results.push('Restricted work cannot start from either entry; failed work can retry');

    await open('settings-preferences');
    const time=page.getByRole('spinbutton',{name:'Keep the assignment open for (minutes)',exact:true});
    for(const value of ['', '0','241','1.5']) {await time.fill(value);assert.equal(await button('Save changes').isDisabled(),true);}
    await time.fill('23');
    await page.getByRole('checkbox',{name:'Show saved memories',exact:true}).uncheck();
    await button('Save changes').click();
    await page.waitForFunction(async()=>{const p=(await window.studi.getProductSettings()).preferences;return p.handoffMinutes===23&&p.memoryVisibility==='none';});
    results.push('Review timer validation and saved memory visibility');

    const rules=page.locator('.homework-rules');
    const radio=name=>rules.getByRole('radio',{name,exact:true});
    await radio('Do it and submit').check();
    await rules.getByRole('button',{name:'Update rule',exact:true}).click();
    await rules.getByLabel('Apply this rule to',{exact:true}).selectOption('course');
    assert.equal(await radio('Do it, I submit').isChecked(),true);
    await rules.getByRole('button',{name:'Save rule',exact:true}).click();
    await rules.getByRole('button',{name:'Remove rule for CSC 316 Data Structures',exact:true}).waitFor();
    await rules.getByLabel('Apply this rule to',{exact:true}).selectOption('global');
    assert.equal(await radio('Do it and submit').isChecked(),true);
    await radio('Don’t start').check();
    await page.evaluate(()=>{window.realSaveRule=window.studi.savePermissionRule;window.studi.savePermissionRule=async()=>{throw new Error('Controlled rule save failure');};});
    await rules.getByRole('button',{name:'Update rule',exact:true}).click();
    await page.getByText('Controlled rule save failure',{exact:true}).waitFor();
    assert.equal(await radio('Don’t start').isChecked(),true);
    await page.evaluate(()=>{window.studi.savePermissionRule=input=>new Promise(resolve=>{window.finishRule=()=>resolve(window.realSaveRule(input));});});
    await rules.getByRole('button',{name:'Update rule',exact:true}).click();
    assert.equal(await rules.getByLabel('Apply this rule to',{exact:true}).isDisabled(),true);
    await page.evaluate(()=>window.finishRule());
    await rules.getByRole('button',{name:'Saved',exact:true}).waitFor();
    await rules.getByRole('button',{name:'Remove rule for All homework',exact:true}).click();
    await rules.getByRole('button',{name:'Save rule',exact:true}).waitFor();
    results.push('Target-specific permissions, failed save retains choice, retry locks target, deletion');

    const note=page.getByRole('textbox',{name:'Your note',exact:true});
    await note.fill('Please keep my feedback if the connection fails.');
    await page.evaluate(()=>{window.studi.submitFeedback=async()=>{throw new Error('Controlled feedback outage');};});
    await button('Send feedback').click();
    await button('Try sending again').waitFor();
    assert.equal(await note.inputValue(),'Please keep my feedback if the connection fails.');
    await page.evaluate(()=>{window.studi.submitFeedback=async()=>({accepted:true,feedbackId:'00000000-0000-4000-8000-000000000002'});});
    await button('Try sending again').click();
    await page.getByText('Thanks — the Studi team received your note.',{exact:true}).waitFor();
    assert.equal(await note.inputValue(),'');
    results.push('Feedback failure retains text; successful retry clears it');
    assert.deepEqual(errors,[]);
    return results;
  } finally {page.off('pageerror',onError);}
}
