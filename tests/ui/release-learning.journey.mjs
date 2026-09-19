import assert from 'node:assert/strict';

// Real renderer controls with local fixture transport; does not claim model quality.
export async function verifyReleaseLearning(page,base) {
 const results=[];
 const button=name=>page.getByRole('button',{name,exact:true});
 const open=async id=>{await page.goto(`${base}/?preview=${id}`);await page.locator('[data-studi-app-ready]').waitFor();};
 await open('learn');
 await button('Date wrong?').click();
 await page.getByLabel('Date',{exact:true}).fill('2026-10-03');
 await button('Save').click();
 await page.waitForFunction(async()=>(await window.studi.getLearnState()).exams.some(exam=>exam.date==='2026-10-03'));
 results.push('Exam date correction persists');
 await open('learn-empty');
 await button('Paste it here').click();
 assert.equal(await button('Use this syllabus').isDisabled(),true);
 await page.getByLabel('Source title',{exact:true}).fill('Probability course');
 await page.getByLabel('Syllabus or exam topics',{exact:true}).fill('Final exam on October 3 covers conditional probability and Bayes theorem.');
 await page.evaluate(()=>{window.importSource=window.studi.importLearnSource;window.studi.importLearnSource=async()=>{throw new Error('Controlled import failure');};});
 await button('Use this syllabus').click();
 await page.getByText('Controlled import failure',{exact:true}).waitFor();
 await page.waitForTimeout(2700);
 assert.equal(await page.getByText('Controlled import failure',{exact:true}).isVisible(),true,'Background refresh hid the failed import');
 assert.equal(await page.getByLabel('Source title',{exact:true}).inputValue(),'Probability course');
 await page.evaluate(()=>{window.studi.importLearnSource=window.importSource;});
 await button('Use this syllabus').click();
 await page.waitForFunction(async()=>(await window.studi.getLearnState()).sources.some(source=>source.title==='Probability course'));
 results.push('Source validation, retained draft on import failure, successful retry');
 for(const [route,action] of [['tutor-population','Draw a sample'],['tutor-flashcards','Flip card'],['tutor-number-line','Reset'],['tutor-function-plot','Reset']]) {
  await open(route);
  assert.equal(await button('Try one myself →').isDisabled(),true);
  await button(action).click();
  assert.equal(await button('Try one myself →').isEnabled(),true);
  if(route==='tutor-flashcards') {await button('Next →').click();await page.getByText('Card 2 of 2',{exact:true}).waitFor();await button('← Previous').click();await page.getByText('Card 1 of 2',{exact:true}).waitFor();}
  await button('Try one myself →').click();
  const session=await page.evaluate(async()=>{const state=await window.studi.getLearnState();return window.studi.getTutorSession({sessionId:state.sessions[0].sessionId});});
  assert.ok(session.blocks.some(block=>block.result),'Exploration was not saved: '+route);
 }
 results.push('Population, flashcards, number line and function plot exploration submit saved responses');
 await open('tutor-choice');
 await button('when B already happened').click();
 await button('Leave').click();
 await button('Continue').click();
 const session=await page.evaluate(async()=>{const state=await window.studi.getLearnState();return window.studi.getTutorSession({sessionId:state.sessions[0].sessionId});});
 assert.ok(session.blocks.some(block=>block.result),'Choice response lost after reopening');
 results.push('Choice answer survives leaving and reopening');
 return results;
}
