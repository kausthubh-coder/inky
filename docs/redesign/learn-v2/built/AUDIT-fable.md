# Audit: Learn home and lesson screens

Judged from the 15 screenshots only. Contrast figures are estimates by eye and need measuring.

## 1. Verdict: 6.5 / 10

The teaching model is good: one question at a time on a board, feedback that quotes the student's own wrong answer, a chat that can mark the graph. The execution lets it down at the moments that matter most. Chalky's feedback lands below the answer and runs off the bottom of the board, step 2 asks about things the board never introduced, and Chalky itself is a sticker in the corner of a mostly empty panel, far from its own words.

## 2. What works

- **One next action on home (01).** "Midterm 1 is in 6 days", the next topic, and one `Start · 15 min` button. The student does not have to plan.
- **Feedback is about this student's answer (09).** "Not yet. 7 is the slope when the gap is a whole second" names the mistake, does not use red or "Wrong", keeps the struck 7 next to the input, and adds a table to look at. This is what a tutor does.
- **Chat acts on the board (08).** The student asks "what do you mean by the gap?" and Chalky answers in two lines and marks the graph. This is the strongest single moment in the set.
- **Yellow has one meaning.** It is always "Chalky just highlighted this": the gap label (08), the new table (09), the "Now" line (13).
- **The answer field is obvious on typed questions (07, 11).** "Your answer", a focused input, `Check` and `Hint` on one row.
- **Mastery uses words, not just marks (02, 03, 13).** "Solid", "Good", "Shaky" sit next to each meter, and "Good, up from Shaky. Back on Saturday." tells the student what changed and what happens next.
- **Personal memory shows up in the copy.** "you last got this right 4 days ago" (06), "Last right 2 days ago. Coming back tomorrow." (02), the before/after in "What clicked" (13).
- **The marked explanation shows criteria (12).** The student sees which points their own sentence hit.
- **The quiz result leads to an action (14).** A score, one sentence on where the points are, and `Study Bayes' theorem · 15 min`.

## 3. Problems, most serious first

### 1. Chalky's feedback goes below the answer and off the board

- **Screens:** 10, 15, and the same structure in 09 and 12.
- **What is wrong:** Feedback is appended under the answer row. In 10 the sentence that names the derivative ("That number has a name: the derivative at 3.") is cut in half by the bottom edge of the board, while the stale "Not yet…" line from the wrong attempt still sits above it. In 15 (900 wide) the wrong-answer feedback is not visible at all: the student sees a struck 7 and an empty input and nothing else. There is no scroll cue in either.
- **Why it matters:** This is the feedback principle failing at the teaching moment. The one sentence the lesson exists to deliver is hidden, and in the narrow window a wrong answer gets no visible explanation.
- **Fix:** Scroll the board so new feedback is fully in view every time it is written. Replace the previous attempt's feedback instead of stacking under it. Keep the feedback next to what it refers to: in 09 it talks about "the row I just added", so it should sit beside that row, not under the input.

### 2. Step 2 asks about things the board has not introduced

- **Screens:** 07, 08, 09, 10.
- **What is wrong:** The prompt says "Make the gap smaller" and "the car's average speed", but no car, no time and no gap have been shown. The graph is labelled `y = x²` and `x = 3`, the axes have no names or units, and the only ticks are 0 and 5.4. Later text says "t = 3", "6 m/s" and "gap (s)". So the board uses x and t for the same thing and the units first appear in a table header after a wrong answer. The student's chat question in 08 ("what do you mean by the gap?") is the proof.
- **Why it matters:** The student cannot tell what they are being asked. The brief's first test fails on the main teaching step.
- **Fix:** Set the scene in one line before the question ("A car's distance after t seconds is t²"). Label the axes "time (s)" and "distance (m)". Use t everywhere. Draw the gap on the graph from the start, as a bracket between the two dots on the time axis. The mark in 08 is a tick at one point, which does not show a distance.

### 3. `Next` is locked while Chalky writes, and the answer row moves

- **Screens:** 10, 12; compare 07 with 09.
- **What is wrong:** After a right answer, `Next` is disabled with a small grey "Chalky is writing…" and the text being written appears below the button, partly off screen. Between 07 and 09 the inserted table pushes the input and `Check` down about 70 px under the student's pointer.
- **Why it matters:** The student is blocked by text they cannot see, with a dead button as the largest thing on the row. Controls that move after an action break the expectation built one step earlier.
- **Fix:** Pin the answer row (input, `Check`/`Next`, `Hint`) to the bottom of the board so it never moves and content scrolls above it. Let the student press `Next` as soon as the answer is marked.

### 4. Chalky is not where its words are

- **Screens:** 06 to 14.
- **What is wrong:** The left panel is 340 px wide and about 80% empty in 06, 07 and 14. The avatar is fixed at the top; its chat replies appear 400 px lower with no avatar or name; its teaching voice appears on the board in purple handwriting. So Chalky speaks in two places and two typefaces, and neither is next to the character. The poses also do not read clearly: a "?" sign while Chalky is the one asking, a lightbulb at the moment the student gets it wrong (09), a star for 7 out of 10 with Bayes at 1 of 3 (14).
- **Why it matters:** The goal is "a personal tutor teaching one student". What the screens show is a worksheet with a mascot in the corner. Proximity is what tells the eye who is speaking.
- **Fix:** Put the avatar beside the latest thing Chalky said. The narrow layout (15) already does this and feels more like a tutor than the wide one. Either give the side panel real content from the first second (Chalky's opening line for the step) or make it much narrower until there is a conversation. Tie each pose to one meaning and drop the ones that cannot be explained in a word.

### 5. The chat closes at the end, and says two opposite things

- **Screens:** 13, 14.
- **What is wrong:** The composer placeholder becomes "This lesson has ended", but the box and send button look exactly as they did when live. In 14 the line "Ask me anything while you work." sits directly above "This lesson has ended".
- **Why it matters:** The wrap-up is when a student has questions ("why did I lose a point on Bayes?", "why Saturday?"). A tutor that goes silent when the timer ends is not personal. A control that looks enabled but is not breaks affordance.
- **Fix:** Keep the chat open on the wrap-up and the quiz result. If it must close, remove the composer and the helper line instead of leaving a dead input.

### 6. Home shows mastery in two encodings, and one is unreadable

- **Screens:** 01, 02, 03.
- **What is wrong:** Collapsed rows show one segment per topic, with the level encoded as a shade of grey (black, dark grey, mid grey, light grey, hollow). Expanded rows show a 4-dash meter with a word. Nothing links the two. The shades cannot be told apart reliably, and light grey against cream is close to invisible. Next to each topic in 02 is an unlabelled percentage ("Counting and sets 15%") that is the topic's share of the test but reads as a score, right beside a meter that says "Solid". The coloured stripes (red, yellow, green, beige) have no stated meaning; green on "Final · No date" suggests "fine" for a test the app knows nothing about.
- **Why it matters:** The home row is where the student decides what to do. A code that needs decoding, a number that can be read the wrong way, and colour without a key all work against that.
- **Fix:** Use one encoding. On the collapsed row, replace the shaded segments with a count in words ("2 of 5 solid") or the same 4-dash meter per topic. Label the percentage ("15% of the test") or move it out of the title line. Give the stripe one meaning and say it, or remove it.

### 7. Scrolled home content is clipped at the top and covered at the bottom

- **Screens:** 03, 04.
- **What is wrong:** In 04 the "Midterm 1" row is cut through its text by the top bar with no edge or fade. In 03 the open card runs under the fixed "Hey Chalky…" composer, with the "Files" row half hidden. In 04 the add form's buttons sit a few pixels above the composer, so three text fields stack with no clear owner.
- **Why it matters:** Text cut mid-glyph looks broken. The fixed composer takes about 100 px of an 800 px window and hides the bottom of whatever the student just opened.
- **Fix:** Give the scroll area a real top edge under the bar, and bottom padding equal to the composer height. When a row opens or the add form appears, scroll it fully into view.

### 8. Too many places to type, with unclear jobs

- **Screens:** 05, 04, 01.
- **What is wrong:** First run (05) has three text inputs: a test box, a "for yourself" box and the "Hey Chalky…" composer. All three accept "what I want to learn". The two boxes have dashed borders, which signal a drop zone, but only one accepts files, and both show the browser's resize grip. `Find my tests` is enabled on an empty box and its label suggests the app will go and look somewhere. `Start with a 5 minute check` is the primary action in 04 and 05 but is drawn as a grey outline that reads as disabled, next to a filled purple button in the other card. The lower half of 05 is empty.
- **Why it matters:** On first run the student should see one obvious thing to do. Here they have to work out which box is the right one.
- **Fix:** One input on first run, in Chalky's voice ("Tell me about a test, or anything you want to learn. Drop a file if you have one."), and let Chalky sort the answer. If two cards stay, remove the composer from this screen, use a solid border on plain text fields, and give each enabled primary button the filled style. In 04, rename "The thing".

### 9. Help is offered unevenly

- **Screens:** 06, 07, 11, 12; 02, 03.
- **What is wrong:** `Hint` appears on 07 and 11 but not on the pick-one question (06) or the explanation (12). On 06 there is no "not sure" choice, so a student who does not know must guess, and a lucky guess is recorded as knowing. "Ask me anything while you work." is small, low contrast, and in the corner farthest from the question; it disappears once the chat has messages. On home, "Loops · Shaky" has a `Practise` button (03) but "Bayes' theorem · Shaky" does not (02), and Bayes is the largest share of the test.
- **Why it matters:** The brief asks whether the student can always tell how to ask for help. The answer is "on some steps".
- **Fix:** Put the same help control in the same place on every step. Add "I'm not sure" to check questions. Give every topic below Solid the same action.

### 10. Old questions pile up above the current one

- **Screens:** 11, 12, 15.
- **What is wrong:** Each finished question becomes a full-width beige bar at the top of the board. By step 4 there are three bars and the current question starts 240 px down. In 11 a heading-size purple line carried over from the last step sits above the new black question at the same size, so two lines compete to be the prompt. In 15 a bar is cut off by the board's top edge.
- **Why it matters:** The top of the board is the most valuable position and it goes to history. This also eats the room that problem 1 needs.
- **Fix:** Collapse history to a single line ("3 earlier questions · Show") from the second step on. Show the carried-over line at body size, or leave it in the collapsed step.

### 11. Low-contrast text and marks

- **Screens:** all.
- **What is wrong:** Secondary grey text on cream at 13 to 14 px ("Wed, Oct 7", "ST 370 · Next:", "+ Add a test", "Ask me anything while you work.") looks below 4.5:1. Older chat messages are faded further (11, 12, 13), to roughly 3:1. The empty meter dashes for "Not checked" are nearly the same colour as the card. Placeholder text is fainter still.
- **Why it matters:** Dates and "next" labels are information, not decoration. Fading old chat messages makes the tutor's earlier explanations hard to reread, which is what a student goes back to them for.
- **Fix:** Darken the secondary grey until it passes 4.5:1. Do not fade chat history. Give empty meter dashes a visible outline.

### 12. Where the answer goes is split on worked steps, and marked answers look editable

- **Screens:** 11, 12.
- **What is wrong:** In 11, step 4 shows "?" in the expression column, but the student types in a separate box lower down and to the left. In 12 the marked answer still sits in a bordered box that looks like a live field. The missed criterion is shown as a grey dash with no word saying it was missed, and the visible comment ("Lovely.") does not mention it.
- **Why it matters:** The "?" is the natural place to answer. A dash can be read as a plain bullet, so the student may not notice they left out the main idea (the limit).
- **Fix:** Put the input in the step 4 slot. Show a marked answer as plain text on the board. Label the missed point ("You didn't say: …") and have Chalky's comment address it.

### 13. Purple means too many things

- **Screens:** 01, 02, 03, 07.
- **What is wrong:** Purple is the selected tab, the primary button, the focus ring, the slider, the secant line, Chalky's voice, the tick marks, and the underline on the next topic. The selected "Learn" tab has the same fill and heavy bottom edge as `Start · 15 min`, so a tab looks like a button. The purple underline on "Distributions" and "Functions" looks like a link or a spelling mark.
- **Why it matters:** When one colour means everything it stops telling the student anything. The one meaning worth protecting is "this is Chalky talking".
- **Fix:** Keep purple for Chalky's voice and the single primary action. Give the selected tab a plain selected style. Mark the next topic with the word "Next" rather than an underline.

### 14. Names and data do not agree between screens

- **Screens:** 06 to 14 against 01.
- **What is wrong:** The back button says "Lessons" but the place is called "Learn" in the tab and in `Back to Learn`. The lesson header says "MA 241 Midterm 2 in 9 days", but home lists MA 241 only as "Final · No date". The right-hand date means "test date" on test rows and "last session" on "Python basics", with no label. "Python basics" opened shows "For yourself" as a subtitle directly under the "For yourself" section heading. The "Before" line in 13 ("Speed at t = 3 is just 9") matches nothing the student did in the screens shown.
- **Why it matters:** One name per place is basic consistency. A header that names a test the student has never seen undermines trust in the plan.
- **Fix:** Call it "Learn" everywhere. Fix the sample data. Label the date ("Last session Tue, Sep 22").

### 15. The quiz result does not show what was missed

- **Screen:** 14.
- **What is wrong:** The student sees 7 out of 10 and per-topic counts, but there is no way to see the three questions they got wrong. The side panel is empty apart from a celebrating Chalky and a closed composer.
- **Why it matters:** Reviewing misses is the first thing a student does after a test, and going over them is the tutor's job.
- **Fix:** List the missed questions under the topic bars, each with the student's answer, the right answer and "Ask Chalky about this".

### 16. Graph and control details

- **Screens:** 07, 09, 10.
- **What is wrong:** The "slope 6.01" label sits on top of the line in 10. The purple dot looks draggable, and Chalky says "Drag the gap", but the control is a small default slider below the graph. The x axis ends at 5.4 for no visible reason and has no tick at 3. Fractions and symbols on the board are set in the interface font next to handwritten prompts, so maths appears in two styles.
- **Why it matters:** If the dot looks draggable and is not, the first thing the student tries will fail.
- **Fix:** Make the dot draggable, or make it look fixed and say "Move the slider". Keep labels off the line. End the axis on a round number and tick 3. Pick one style for maths.

### 17. The countdown reads as a deadline

- **Screens:** 06 to 12.
- **What is wrong:** "15 min left" counts down to "3 min left" at step 4 of 5, with nothing to say what happens at zero. The step name ("Check", "Learn", "Practise", "On your own") is useful but is 13 px in the top-right corner, and is dropped in the narrow layout (15).
- **Why it matters:** A clock running down adds pressure during the one step where the student writes in their own words. A tutor does not show a stopwatch.
- **Fix:** Show progress by steps only, or word the time as a budget ("about 3 min to go"). Put the step name on the board near the question.

### 18. Smaller points

- **06:** The options are a letter circle and text with no visible row. Make the whole row the target and show it.
- **13:** The struck-through "Before" line is hard to read at that size; use grey text with a lighter strike. "Speed is the slope the nearby slopes close in on: 6." is awkward. There is only `Back to Learn`, while 14 offers a next lesson; end both the same way.
- **02:** `Change` does not say what it changes (the plan, the date or the topics). "Test yourself" and "Cheat sheet" are actions, but they are styled as small grey labels with a faint arrow at the far edge.
- **01:** Section labels start at 294 px, row titles at 306 px, and the hero button ends at 1000 px while row values end at 986 px. Nothing in a collapsed row shows it can be opened.
- **15:** The narrow layout shows only Chalky's last reply. The student's own message and the earlier exchange are not visible.

## 4. What I could not judge from static screens

- Hover, pressed, focus and selected states, including what a chosen option looks like on 06.
- Keyboard use (whether A/B/C and Enter work) and tab order.
- Screen reader behaviour: labels on the meters, the graph, the slider and the struck answer.
- Whether the board scrolls by itself when Chalky writes. Problem 1 depends on this; 10 and 15 may be mid-scroll captures.
- How Chalky's writing appears (speed, animation) and how long `Next` stays locked.
- What `Hint`, `Pause` and `Change` do, and what happens when the timer reaches zero or the student presses "Lessons" mid-lesson.
- Whether the graph dot can be dragged.
- Exact contrast ratios.
- Step 5 of the lesson, the quiz questions themselves, and the selected state of the pick-one question.
- Long chat histories and long answers; windows smaller than 900 or larger than 1280; dark mode; reduced motion.
- Loading, error and offline states.
- What the home "Hey Chalky…" composer does.
