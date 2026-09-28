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
    await page.evaluate(()=>{
      const takeover=window.studi.requestAssignmentTakeover;
      const cancel=window.studi.cancelAssignment;
      window.assignmentControlCalls={takeover:0,cancel:0};
      window.studi.requestAssignmentTakeover=async input=>{window.assignmentControlCalls.takeover++;return takeover(input);};
      window.studi.cancelAssignment=async input=>{window.assignmentControlCalls.cancel++;return cancel(input);};
    });
    // Takeover remains on the school overlay. The composer Stop cancels the assignment.
    await page.getByRole('button',{name:'Takeover',exact:true}).click();
    await page.getByRole('button',{name:/I’m ready. Continue/}).click();
    await workspace.getByRole('button',{name:'Stop assignment',exact:true}).click();
    await page.getByRole('heading',{name:'You stopped this.',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.startCalls),1);
    assert.deepEqual(await page.evaluate(()=>window.assignmentControlCalls),{takeover:1,cancel:1});
    results.push('Single start while pending; takeover pauses; composer Stop cancels');

    await open('desk-working');
    const activity=page.getByLabel('Assignment activity');
    assert.deepEqual(await activity.locator('li').allTextContents(),[
      'Opened the quiz',
      'Read the instructions and 2 attached files',
      'Answered questions 1–3',
      'Typing the answer to question 4',
    ]);
    assert.equal(await activity.locator('li').last().getAttribute('aria-current'),'step');
    results.push('Mockup C activity feed shows labelled progress and the current action');

    await open('desk-review');
    await page.getByRole('heading',{name:'Two things I’m not sure about:',exact:true}).waitFor();
    assert.deepEqual(await page.getByLabel('Inky’s doubts').locator('p').allTextContents(),[
      'Q2: The rubric says “show work.” I attached the trace.',
      'Q5: There are two readings of “stable.” I used the textbook one.',
    ]);
    await page.getByText('Requirements · 6 of 6 met',{exact:true}).waitFor();
    await page.getByText('Answers · on school page',{exact:true}).waitFor();
    await button('Submit now').waitFor();
    await button('Edit it myself').waitFor();
    assert.equal(await page.getByLabel('Words shown after submission').count(),0);
    assert.equal(
      await page.locator('time[datetime="2026-09-04T03:30:00.000Z"]').innerText(),
      new Date('2026-09-04T03:30:00.000Z').toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}),
    );
    assert.match(await page.locator('.rd-auto-submit').innerText(),/rule: do it and hand it in/);
    await button('Edit it myself').click();
    await page.getByRole('button',{name:/I’m ready. Continue/}).waitFor();
    results.push('Mockup D leads with doubts, names actions, and shows the actual auto-submit time and rule');

    await open('desk-submitted');
    assert.equal(await page.getByText('Handed in.',{exact:true}).count(),1);
    await open('assignment-stopped');
    await page.getByRole('heading',{name:'You stopped this.',exact:true}).waitFor();
    await page.getByText('Your saved work is kept.',{exact:true}).waitFor();
    results.push('Submitted confirmation appears once; student cancellation has accurate copy');

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
