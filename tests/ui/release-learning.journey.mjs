import assert from 'node:assert/strict';

// Real renderer controls with local fixture transport; does not claim model quality.
export async function verifyReleaseLearning(page,base) {
 const results=[];
 const button=name=>page.getByRole('button',{name,exact:true});
 const open=async id=>{await page.goto(`${base}/?preview=${id}`);await page.locator('[data-studi-app-ready]').waitFor();};
 const row=name=>page.locator('.lr-row',{hasText:name}).first();
 const answer=page.getByLabel('Your answer',{exact:true});

 await open('learn');
 await page.getByRole('heading',{name:'Tests',exact:true}).waitFor();
 await page.getByRole('heading',{name:'For yourself',exact:true}).waitFor();
 assert.equal(await page.locator('.lr-open').count(),0,'A goal was open on arrival');
 await page.locator('.lr-hello').getByRole('button',{name:'Start · 15 min',exact:true}).waitFor();
 results.push('Home lists tests and things for yourself, nothing open, Start in the hello row');

 await row('Midterm 1').click();
 await page.locator('.lr-open',{hasText:'Counting and sets'}).waitFor();
 await row('Python basics').click();
 await page.locator('.lr-open',{hasText:'Variables and types'}).waitFor();
 assert.equal(await page.locator('.lr-open').count(),1,'Opening a second row left the first open');
 await row('Python basics').click();
 assert.equal(await page.locator('.lr-open').count(),0,'Clicking the open row did not close it');
 results.push('A row opens in place and closes the other');

 await button('+ Learn something new').click();
 assert.equal(await button('Just add it for later').isDisabled(),true);
 await page.getByLabel('Topic',{exact:true}).fill('Reading sheet music');
 await button('Just add it for later').click();
 await page.locator('section[aria-label="For yourself"] .lr-row',{hasText:'Reading sheet music'}).waitFor();
 results.push('Learn something new adds a row under For yourself');

 await open('tutor-question');
 await answer.waitFor();
 assert.equal(await answer.evaluate(node=>node===document.activeElement),true,'The answer field is not focused');
 assert.equal(await button('Check').isDisabled(),true);
 await page.getByLabel('Say something to Chalky',{exact:true}).fill('what is the gap?');
 await page.keyboard.press('Enter');
 await page.locator('.tu-you',{hasText:'what is the gap?'}).waitFor();
 await page.locator('.tu-them').waitFor();
 assert.equal(await answer.isEnabled(),true,'A chat message closed the question');
 results.push('A chat message and its reply stay in the side chat and the question stays open');

 await answer.fill('7');
 await button('Check').click();
 await page.locator('.tu-ans s.tu-was',{hasText:'7'}).waitFor();
 assert.equal(await answer.inputValue(),'','The field kept the wrong answer');
 assert.equal(await answer.isEnabled(),true);
 results.push('A wrong answer stays struck through beside a fresh field');

 await answer.fill('6');
 await button('Check').click();
 await page.locator('.tu-right',{hasText:'6'}).waitFor();
 await button('Next').click();
 await page.getByRole('heading',{name:'What does the base rate tell us?',exact:true}).waitFor();
 await page.locator('.tu-done',{hasText:'2 earlier questions'}).click();
 await page.locator('.tu-done',{hasText:'Make the gap smaller'}).click();
 await page.getByRole('heading',{name:'Make the gap smaller. What number is the slope heading toward?',exact:true}).waitFor();
 await page.locator('.tu-right',{hasText:'6'}).waitFor();
 results.push('A right answer is marked at once; Next folds it into the earlier questions, which reopen it');

 await open('tutor-pick');
 assert.equal(await button('Check').isDisabled(),true);
 await page.getByRole('radio').nth(1).click();
 assert.equal(await button('Check').isEnabled(),true);
 await button('Check').click();
 await button('Next').waitFor();
 const session=await page.evaluate(async()=>{const state=await window.studi.getLearnState();return window.studi.getTutorSession({sessionId:state.sessions[0].sessionId});});
 assert.equal(session.blocks[0].result.correct,true,'The picked option was not saved');
 results.push('A pick-one question needs a pick, then Check');

 for(const [route,action] of [['tutor-population','Draw a sample'],['tutor-flashcards','Flip card'],['tutor-number-line','Reset'],['tutor-function-plot','Reset']]) {
  await open(route);
  assert.equal(await button("I've tried it").isDisabled(),true);
  await button(action).click();
  await button("I've tried it").click();
  await page.getByRole('heading',{name:'What does the base rate tell us?',exact:true}).waitFor();
 }
 results.push('A visual has to be tried before the lesson moves on');
 return results;
}
