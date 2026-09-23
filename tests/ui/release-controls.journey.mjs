import { verifySettings } from "./settings.journey.mjs";
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
    await button('All work').click();
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
    // Pause lives on the school page overlay (mocked in previews). Stopping is pause, then stop.
    await page.getByRole('button',{name:'Takeover',exact:true}).click();
    await page.getByRole('button',{name:/I’m ready. Continue/}).click();
    await page.getByRole('button',{name:'Takeover',exact:true}).click();
    await workspace.getByRole('button',{name:'Stop this assignment',exact:true}).click();
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
    await page.getByRole('heading',{name:'When Inky finds homework',exact:true}).waitFor();
    await open('assignment-failed');
    await button('Try again').click();
    await page.getByRole('button',{name:'Takeover',exact:true}).waitFor();
    results.push('Restricted work cannot start from either entry; failed work can retry');

    results.push(...await verifySettings(page, base));
    assert.deepEqual(errors,[]);
    return results;
  } finally {page.off('pageerror',onError);}
}
