# Studi product interview and decision record

This file is the durable record of the grilling session through Q85.

The question blocks below are copied from the assistant messages in the local Codex session logs. The answer blocks are the user's replies copied verbatim. Spelling, punctuation, HTML entities, and contradictions are intentionally preserved. When the same question number appears again, the later answer overrides the earlier answer.

## Latest decisions that override earlier branches

- P1 is a clean-room build. Do not refactor or reuse the current React/Electron shell, Moodle scanner, onboarding, scheduler, or scripted task code. Rebuild the app-specific code in `src/` and `electron/` from scratch. Keep only the approved product decisions, visual direction, decision artifacts, and repository infrastructure that project instructions explicitly protect.
- Studi is a paid desktop agent for high-school and college students. It discovers schoolwork, accepts direct tasks, works in a visible embedded browser, remembers course-specific preferences, and can submit only when the student explicitly grants that permission.
- Build a general browser tool layer by adapting proven open-source browser-control work. Chrome DevTools MCP and Vercel agent-browser are the primary references. The agent controls Studi's embedded browser through tool calls. Do not make one LMS adapter the product architecture.
- Use a separate Codex task in the user's `/school` project to run the user's existing course automation. Compare that result against Studi and close capability gaps.
- Work remains in the school webpage while it waits for submission. If the configured review timer expires without submission, Studi saves the answers as local Markdown and shows that fallback when the task is opened.
- Closing the main window leaves Studi running in the system tray. One primary computer and one active embedded school browser profile are supported during beta.
- Pi becomes Studi's canonical local agent through a real `AgentSession`. The current prototype still uses the local Codex CLI, so that replacement must be explicit and testable.
- Beta inference uses the tester's connected ChatGPT subscription. Paid inference uses a thin Studi streaming endpoint and managed model gateway.
- Convex stores account, plan, credits, beta permission, usage, and feedback. School data, rules, workflows, queues, browser state, agent sessions, and Markdown memories stay local.
- Clerk uses browser-based OAuth PKCE. Clerk waitlist approval controls beta sign-in. Paid users receive priority, but detailed launch mechanics are deferred.
- PostHog records masked Studi UI replay, product events, errors, model usage, agent traces, prompts, outputs, retries, and tool activity. Credentials, cookies, auth headers, tokens, and school-browser replay never enter PostHog.
- Tutoring, learning sessions, broad desktop control, document tools, email, and other workspace skills come after the browser-first schoolwork agent works.
- Do not reopen a settled branch unless implementation evidence disproves an assumption.

## Verbatim interview rounds

## Q1 through Q3

### Questions as asked

❓ **Q1** - **What work should the agent do?** Choose every capability that belongs in the product, and label each one `must have`, `later`, or `never`.

A. Read assignments and deadlines from an LMS  
B. Plan tasks and manage a study schedule  
C. Find and summarize sources  
D. Explain concepts and tutor the student  
E. Draft essays, reports, or presentations  
F. Solve homework problems  
G. Operate websites and fill in answers  
H. Take quizzes or exams  
I. Submit finished work under the student's identity  
J. Check completed work against rubrics

➡️ My recommendation: A, B, C, D, E, and J for the first version. Permit F when the agent explains its work. Mark H and I as never. Browser automation should gather context and prepare work, not impersonate the student.

---

❓ **Q2** - **Who is the first user?** Pick one narrow starting group.

A. High-school students  
B. University students  
C. Adult and continuing-education students  
D. Tutors working for students  
E. Schools or universities buying for their students  
F. You personally, as a private prototype

Include the country or education system because LMS products, privacy rules, and assessment norms differ.

➡️ My recommendation: university students in the United States who already manage coursework through Canvas, Blackboard, Moodle, or Brightspace.

---

❓ **Q3** - **What are you trying to build commercially?**

A. A personal experiment  
B. A free open-source tool  
C. A paid consumer app  
D. A product sold to schools  
E. A prototype intended to raise funding  
F. Something else

Also state whether you are building alone and whether you have a target launch date or spending limit.

➡️ My recommendation: a paid consumer MVP built for a small private beta. Avoid school procurement in the first version because it adds long sales cycles, accessibility reviews, security assessments, and student-data contracts.

### User answer, verbatim

\`\`\`text
1.it has browseure use and computer use, ect. it can do eveything like the codex app,&#x20;
2.studetns collage, highscoller&#x20;
3.a paid consumer app, whcih does your work for you and helps you study, i wnat to price aorun 20 dolalrs and 40 dolalrs a month i think thtas valid by houw muahc time they would be saving ?
\`\`\`

## Q4 through Q7

### Questions as asked

❓ **Q4** - **Where does the agent stop?** Pick the highest autonomy level you will permit.

A. It teaches and plans, but does not produce final answers.  
B. It produces drafts and solutions, but the student edits and submits them.  
C. It completes ordinary coursework in the browser, but the student approves every submission.  
D. It completes and submits assignments without approval.  
E. It takes quizzes, exams, or proctored assessments.

Also decide whether the agent must show its sources, reasoning, and action history.

➡️ I recommend C with hard limits. Require approval before anything leaves the device. Block quizzes, exams, proctored work, messages to teachers, purchases, account changes, and destructive actions. Keep an action log and source links. D or E would turn the product into a cheating and impersonation service, which conflicts with the study product you also want to sell.

---

❓ **Q5** - **Which group launches first?** "High school and college" combines users with different buyers, schedules, subjects, and account rules. Pick one for the first release.

A. College students aged 18 and older  
B. High-school students whose parents pay  
C. High-school students who buy directly  
D. Both groups from day one

➡️ I recommend A. Build for college students aged 18 and older first. Add high school only after the workflows, safety controls, and parent relationship are designed deliberately.

---

❓ **Q6** - **Who will build this?** State who is available now, including engineering, design, marketing, legal review, and customer support. Include your own skills and weekly hours.

➡️ I recommend one technical founder for the first prototype, with paid specialist reviews for security and legal issues before accepting real student credentials.

---

❓ **Q7** - **What is the first delivery constraint?** Give a target date and the maximum cash you will spend before testing the app with real users. Exclude the value of your own time.

➡️ I recommend a private prototype within 8 weeks and a hard pre-validation spending cap of $5,000. Do not build the full cross-platform vision before watching students use one reliable workflow.

### User answer, verbatim

\`\`\`text
4.d and c, the stunde can choose it can jsut do it and wait for submision, or it can auto submit, and teh user canchoose soem sidiemgnt ypes can uato submit or not ect.
5.why does that matter, its a ai agent with school brainding it will work the same for bith same value prop ect.&#x20;
6.its just me its not that hard dont think about this&#x20;
7.the plan is i build a demo that just needs to work on m y mechine , ahave a markeitng page, with preslae, and do some marketing, while i build it, i will prob relase the app in 2 weeks max or less
\`\`\`

## Q8 through Q12

### Questions as asked

❓ **Q8** - **What single workflow proves the demo works?** Pick one. Two weeks is enough for one convincing path, not a general Codex replacement.

A. Read a Canvas assignment and rubric, research it, create the answer, enter it into Canvas, and stop at submission  
B. Complete a Google Classroom assignment  
C. Solve questions on a generic homework website  
D. Build your own fake school portal and demonstrate the whole flow safely  
E. Something else, described click by click

➡️ I recommend A. Use your own Canvas test course or a controlled account. The demo should turn one prompt into a sourced draft and fill the submission form.

---

❓ **Q9** - **Will you override the submission safeguard?** OpenAI's computer-use guidance calls for confirmation immediately before submitting, posting, or representing the user to another party. Your unattended mode conflicts with that guidance. [OpenAI computer-use guidance](https://developers.openai.com/api/docs/guides/tools-computer-use)

Choose one:

A. Require confirmation for every submission  
B. Allow assignment rules, but show a final confirmation with a countdown  
C. Permit fully unattended submission for selected assignment types  
D. Demonstrate unattended submission only on a fake portal, then decide after testing

➡️ I recommend A for real sites and D for the demo. "Auto-complete until the final click" still saves nearly all the time without silently submitting the wrong file, hallucinated citations, or work for the wrong course.

---

❓ **Q10** - **Who can buy the presale?**

A. Anyone aged 18 or older  
B. Users aged 13 to 17 with a parent or guardian purchasing  
C. Users aged 13 and older purchasing directly  
D. All ages

➡️ I recommend A for paid presales. Let younger students join a free waitlist with a parent contact field. You can still market the future product to high-school students without taking money from minors before the teen flows exist.

---

❓ **Q11** - **What promise goes on the landing page?**

A. "AI that does your schoolwork for you"  
B. "Finish assignments faster with an AI that researches, drafts, and works in your browser"  
C. "An AI study partner that teaches but does not complete work"  
D. Your own exact headline

Academic policies commonly prohibit submitting AI-generated work as the student's own unless the instructor allows it. That is explicit in current guidance from [Harvard](https://registrar.gse.harvard.edu/learning/policies-forms/ai-policy), [Stanford](https://teachingcommons.stanford.edu/news/guidance-technology-tools-academic-integrity), and the [College Board](https://apcentral.collegeboard.org/exam-administration-ordering-scores/administering-exams/exam-policies/artificial-intelligence-tools).

➡️ I recommend B. It makes the browser agent concrete without advertising cheating as the product's defining feature.

---

❓ **Q12** - **What do you mean by "school branding"?**

A. A general visual identity made for students  
B. Users customize colors and add their school's name  
C. The app uses real school logos and presents itself as school-specific  
D. Schools receive white-labeled versions

➡️ I recommend A for the demo. C and D imply affiliation or a school sales product, which is different from your direct consumer presale.

### User answer, verbatim

\`\`\`text
8.A,
9.wer are not useing codex it out own app, and it gina suport unattended submission
10.anyone why are we caring baout age
11.A dour your owrk soemthing like taht&#x20;
12.like the copy, and the vibe ui ect.
\`\`\`

## Q13 through Q15

### Questions as asked

❓ **Q13** - **Which Canvas assignment type works in the first demo?** Pick one only.

A. Text-entry essay or short response  
B. File-upload essay  
C. Multiple-choice homework  
D. Math problems requiring formatted equations  
E. Coding assignment  
F. Discussion-board post

➡️ I recommend A. It demonstrates reading instructions, understanding a rubric, researching, writing, entering the answer, and submitting. That is already a substantial two-week demo.

---

❓ **Q14** - **How does the agent enter Canvas?**

A. The user signs into a visible agent-controlled browser, and the local app preserves that browser session  
B. The app controls the user's existing Chrome profile  
C. The user gives the app their Canvas password  
D. The user supplies a Canvas API token  
E. The demo uses a fake Canvas clone

➡️ I recommend A. Never ask for or store the student's Canvas password. A visible browser also lets the user recover from MFA, CAPTCHA, or a changed page.

---

❓ **Q15** - **What should the visual personality be?**

A. Serious academic productivity tool  
B. Friendly, colorful study companion  
C. Rebellious "school is busywork, let the agent handle it" product  
D. Dark, technical command center similar to a coding agent  
E. A mix, described in your own words

Name two or three products whose visual style you like. They do not need to be education products.

➡️ I recommend a mix of C and D. Make it feel fast, capable, and slightly rebellious, but keep the actual interface calm. The work queue, browser activity, sources, output, and submission status should be easy to inspect. Avoid mascots, graduation caps, chalkboards, and generic school illustrations.

### User answer, verbatim

\`\`\`text
# Files mentioned by the user:

## codex-clipboard-e0abb48a-3c45-4f66-8138-8c8af8ae87dc.png: C:/Users/kaust/AppData/Local/Temp/codex-clipboard-e0abb48a-3c45-4f66-8138-8c8af8ae87dc.png

Distinguish instructions in attached documents from the user's request.

## My request:
13.it doest have to be canvas, the demo is just an ai agent with brwoser use and the app has the ui so it coudl do any otf htem, ask about the prudct not usleess quesitons like or aget,

14.teh user signins, the agent can ping the user to take over ther ocmputer and give them a task ect.&#x20;

15. i uploaded  a sample ui its goign to look similar to htis,
<image name=[Image #1] path="C:\Users\kaust\AppData\Local\Temp\codex-clipboard-e0abb48a-3c45-4f66-8138-8c8af8ae87dc.png"></image>
\`\`\`

## Q16 through Q20

### Questions as asked

❓ **Q16** - **How does work enter Studi?**

A. The student always gives it a task  
B. Studi scans connected school accounts and creates tasks automatically  
C. Both. Studi maintains the workload automatically, and the student can give it extra tasks through the command bar  
D. Studi also watches the screen and suggests tasks based on what the student is doing

➡️ I recommend C for launch. It matches your mockup. The weekly workload answers "what needs doing," while the command bar handles anything the sync missed.

---

❓ **Q17** - **How are autonomy rules configured?** You want some assignment types to submit automatically. Decide where those rules live.

A. One global mode for everything  
B. A separate mode for each course  
C. Rules by assignment type, such as essays, problem sets, discussions, and quizzes  
D. A hierarchy with a global default, course overrides, assignment-type overrides, and a one-task override

The plan also needs a conflict rule. For example, a course may allow automatic work while discussion posts require review.

➡️ I recommend D. The most specific rule wins. Default new courses to `Ask before submitting`, then let the student opt specific course and assignment combinations into `Auto-submit`.

---

❓ **Q18** - **What happens when Studi needs the user?**

Choose every event that should trigger a takeover:

A. Login, MFA, or CAPTCHA  
B. Missing information or files  
C. Conflicting or unclear instructions  
D. A subjective choice that could change the answer  
E. The agent has failed repeatedly  
F. Anything else

Also decide whether other queued tasks continue while one task waits.

➡️ I recommend all five. Pause only the blocked task, continue safe queued work, and open the exact browser state when the user accepts the takeover. If the user ignores the notification, keep that task paused.

---

❓ **Q19** - **What does "helps you study" mean after Studi completes the work?**

A. It explains the completed answer  
B. It creates a short study guide  
C. It quizzes the student on the material  
D. It saves sources and notes to the Library  
E. It offers scheduled learning sessions  
F. All of these  
G. Something else

➡️ I recommend F, packaged as a single "Learn this in five minutes" result. The Library stores it, and Learning Sessions revisits it before an exam. This gives the study promise actual product substance.

---

❓ **Q20** - **What role does each platform have?**

A. Windows and macOS run the full agent; web and mobile monitor tasks and handle takeovers  
B. Everything runs in the cloud; every platform is a client  
C. Every platform controls the local device, including iPhone and Android  
D. Desktop only at first, with no defined role for web or mobile yet

➡️ I recommend A as the final product direction. For the two-week demo, build only the Windows experience shown in the mockup plus the public marketing and presale page.

### User answer, verbatim

\`\`\`text
c it does an automiton to get work and studtn also desicides what work it cna do ect. and the studetn mages it it can add owrk, ect.
17.this very dynamic, so we will have an agents .dm or some fiel with instucitons, and for example a lot of classes ahsve reaoting set of assigment types, and so we can registed those in some type of file and what he use choose, the ai can also aks the user, hwat he wants, for exmaple in my statiscis class we have a weely webaiiagn that i want autosubmiited, and then for csc316 we have workshos i want studi to do the work and not submit ect. the agetn needs to remerb and store, i am going to impleimtent a memeroy system , and also as it does woark it know what toics and how the topis are tested in class so it can teach the user,
19.it keeps track of work and topics with memory idk if we need that for intial demo, but its also an ai tutor, and will help you study, ect. idk how that will work yet or if i shoudl inlcude it in thte intial verison
18.i wnat to go with the recmoeddation, the agent will ait for the user to take over for like 5-30 mintures nad then it ocnitnue with other wrok, and the user can change this in settings,&#x20;
20.its only a desktop app , there is a website but for now its just for billing, lanidng page, auth ect. for now
\`\`\`

## Q21 through Q23

### Questions as asked

❓ **Q21** - **What must the two-week demo prove?**

A. The polished UI and a scripted agent run  
B. A real agent loop without persistent memory  
C. A real agent loop with basic editable course rules  
D. The agent loop, full memory, tutoring, billing, and every screen

➡️ I recommend C. The demo should:

1. Discover or accept a task.
2. Add it to Studi's desk.
3. Read a saved course instruction such as "complete weekly WebAssign and submit it."
4. Work visibly in the browser.
5. Request takeover when blocked.
6. Finish or submit according to the saved rule.
7. Show the completed task in history.

Leave the full tutor, long-term topic model, mobile apps, and advanced learning sessions out of the two-week build.

---

❓ **Q22** - **Who controls memory?**

A. The agent writes memory silently and uses it automatically  
B. Only the student can create memories  
C. Direct instructions save automatically, while inferred preferences require confirmation  
D. The agent stores everything it observes

The student also needs a place to inspect, edit, disable, and delete memories. Otherwise one misunderstood instruction can keep affecting future assignments.

➡️ I recommend C. Separate memory into:

- Course rules, such as "submit weekly statistics homework."
- Task preferences, such as "draft CSC316 workshops but never submit."
- Learning memory, including covered topics, weak areas, and exam patterns.
- Personal preferences, including writing style, work hours, and notification timing.

Course and submission rules should always be visible. Never bury them inside an opaque chat history or raw agent file.

---

❓ **Q23** - **Can Studi work when its window is closed?**

A. It stops when the main window closes  
B. It stays in the system tray and works while the computer is awake  
C. It continues in the cloud when the computer sleeps or shuts down  
D. The user chooses between local and cloud execution

➡️ I recommend B for the desktop product. Closing the window sends Studi to the tray. It can continue queued work and send a system notification when takeover is needed. If the computer sleeps or loses internet access, tasks pause and resume later.

### User answer, verbatim

\`\`\`text
21.A. The polished UI and a scripted agent run\
B. A real agent loop without persistent memory\
C. A real agent loop with basic editable course rules\
D. The agent loop, full memory, tutoring, billing, and every screen  , should be all of them, with ai coding we can achinve a lot more in a lot less itme, this is very achivable right now, we can be way morabisiotos with our stuff so dont wrooy,

22.A, thed agent witeis memeory and automatily uses, but prefrences are differnt form memorires, and prefrensed gets saved and given to the agent each time,&#x20;

23.B
\`\`\`

## Q24 through Q28

### Questions as asked

❓ **Q24** - **Who can create preferences?**

A. Only direct user instructions create preferences  
B. The agent can infer and save preferences without asking  
C. Direct instructions save immediately; inferred preferences require confirmation  
D. The agent treats repeated behavior as permission

Example: the agent notices that the student submitted three statistics assignments without changes. Can it decide that future statistics work should auto-submit?

➡️ I recommend C. Explicit statements such as "always submit weekly WebAssign" save immediately. The agent can suggest inferred preferences, but it cannot grant itself new permissions.

---

❓ **Q25** - **How can students correct memory?**

A. Memory stays invisible  
B. Students can view and delete memories  
C. Students can view, correct, forget, and scope memories to a course  
D. Students manage the raw memory files directly

➡️ I recommend C. Each memory should show its source, date, course, and confidence. "Correct" can replace the old memory while preserving an audit entry. Preferences get their own settings screen because they control behavior.

---

❓ **Q26** - **What proves Studi is an AI tutor?**

A. A general tutoring chat  
B. "Explain this" on any completed assignment  
C. A study session generated from the student's courses, completed work, and known weak topics  
D. All three

Choose one tutor journey that must work end to end in the demo.

➡️ I recommend D, demonstrated through one journey: the student selects an upcoming statistics exam, Studi builds a topic list from remembered coursework, runs an adaptive quiz, explains mistakes, and updates the student's topic mastery.

---

❓ **Q27** - **What exactly ships after two weeks?**

A. A local demo on your machine plus a public marketing and presale website  
B. An invite-only Windows beta that other students can install  
C. A public Windows release anyone can download  
D. A local demo in week one followed by an invite-only beta in week two

➡️ I recommend D. It preserves your ambitious full demo while forcing the second week to prove installation, authentication, updates, and operation on a machine you do not control.

---

❓ **Q28** - **What distinguishes the $20 and $40 plans?**

A. Same capabilities, different monthly agent usage  
B. $20 requires approval; $40 unlocks unattended work  
C. $20 is tutoring; $40 includes computer use  
D. $40 uses better models and runs more tasks simultaneously  
E. $40 is advertised as unlimited

➡️ I recommend a combination of A and D. Both plans should contain the complete product, including unattended rules. The $40 plan gets more agent runtime, more simultaneous work, faster queueing, and expensive models for difficult tasks. Do not promise unlimited use before measuring real task costs.

### User answer, verbatim

\`\`\`text
q24, prefreances come from the user eahtier the agent asks him, or the agent gets it form the prompt q25.A for now i want it to stay invisbe if we want, we can makit visbale in setting, also memeory is local , its just markdown the agents write,s&#x20;
q26.okay for now we are focusin on the agent doing the school work, but i am going to create a personla tuuor thing too, simialr to the proevos studi later ,
q27.almost redy deployable&#x20;
28.mroe usage, i goign to have similar weekly usage limits or soemhting idk
\`\`\`

## Q29 through Q32

### Questions as asked

❓ **Q29** - **What happens during first-run onboarding?**

Choose the required steps:

A. Create or sign into a Studi account  
B. Open the agent browser and sign into school sites  
C. Let Studi scan for courses, assignments, and deadlines  
D. Answer preference questions for each discovered course  
E. Watch Studi complete a test task  
F. Land on the weekly dashboard immediately and configure things later

➡️ I recommend A through E as a guided setup. The user should reach a populated weekly dashboard within five minutes. Ask only essential questions during setup. Studi can learn the rest when it encounters new assignment types.

---

❓ **Q30** - **What does "almost ready deployable" mean?**

A. It works only in your development environment  
B. It produces a Windows installer that works on a clean second computer  
C. Other students can install it, but access requires an invite  
D. Anyone can download, pay, and use it

➡️ I recommend C. The two-week build should produce a real installer, updater, authentication flow, and invite gate. You can call it a release candidate without taking on unrestricted public support.

---

❓ **Q31** - **How should weekly usage appear to customers?**

A. Number of completed tasks  
B. Agent working minutes  
C. Credits consumed by different models and actions  
D. A simple weekly percentage meter, similar to other AI subscriptions  
E. No visible meter until the limit is reached

➡️ I recommend D. Show `Weekly usage: 62%` with warnings near the limit and a clear reset date. Track model calls, browser activity, and retries internally. Set the actual $20 and $40 limits only after running representative assignments and measuring costs.

---

❓ **Q32** - **What does the presale customer purchase?**

A. A $20 or $40 subscription that starts billing immediately  
B. A refundable deposit credited toward the first month  
C. A discounted annual subscription paid before release  
D. A reservation with a saved payment method, charged when access opens  
E. A free waitlist spot

➡️ I recommend B. Sell a refundable $20 founding-member deposit, credit it toward the first month, and state what buyers receive, the expected beta date, and how to request a refund. Starting recurring billing before customers can use the app will create avoidable disputes.

### User answer, verbatim

\`\`\`text
q29.A, B, C, D, it discivers reparithgn assugnht tyes in each lcass and asks the user if it want to usto complet it, ect. submit it for him ect. E.suggest the usrer a sisigment to tell studio to work on, and then he cna watch studi do the work, if not its jsut he dashbarod, aldo have a screen saying tahnkyou and gives the intstuciotn for giving feedback or askign for help,&#x20;
30.D. anaybosy can downlaod use and test,&#x20;
31.i am not sure, D
32.20 dollar depsot that gets creditied ot the app when it launches,
\`\`\`

## Q33 through Q37

### Questions as asked

❓ **Q33** - **Who gets free agent usage during the public test?**

A. Everyone receives a small free allowance  
B. The $20 deposit is required before using the agent  
C. Everyone downloads free but supplies their own AI API key  
D. The download is public, but only invited accounts receive usage  
E. Unlimited free testing

➡️ I recommend A. Give every account three complete agent runs. The $20 founding deposit unlocks a larger weekly beta allowance and remains account credit for launch.

---

❓ **Q34** - **What data leaves the student's computer?**

A. Only authentication, subscription status, and weekly usage  
B. Task names, courses, deadlines, and completion states  
C. Full agent history, browser screenshots, and assignment content  
D. Everything syncs between devices

Remember that preferences, memories, browser sessions, and working files are already defined as local.

➡️ I recommend A. Keep school data, memory Markdown, browser sessions, and task artifacts local. Send crash reports or agent traces only when the student explicitly attaches them to a support request.

---

❓ **Q35** - **When can Studi mark work as completed?**

A. When the agent believes it finished  
B. When the target site displays a success or submission confirmation  
C. Only after the student verifies it  
D. Different rules for `completed` and `submitted`

➡️ I recommend D. `Completed` means Studi produced the work. `Submitted` requires evidence from the target site. Save the confirmation time and a local screenshot. If confirmation is missing, retry twice and then move the task to `needs you`.

---

❓ **Q36** - **How does feedback and support work?**

A. A support email address  
B. An in-app feedback form  
C. A Discord community  
D. An in-app form plus email support  
E. All of these

➡️ I recommend D. The thank-you screen should offer `Report a problem`, `Suggest a feature`, and `Ask for help`. The user chooses whether to attach diagnostic logs. Do not automatically attach assignment content or browser screenshots.

---

❓ **Q37** - **What happens to the $20 deposit at launch?**

A. It becomes account credit, and the customer chooses a plan manually  
B. It automatically starts the $20 subscription  
C. It automatically starts either the $20 or $40 plan selected during presale  
D. It remains refundable even after the customer begins using the paid release

➡️ I recommend A. Do not start a recurring subscription silently. Apply the full $20 balance when the customer chooses either paid plan. Allow refunds until the customer spends that credit.

### User answer, verbatim

\`\`\`text
33.no one, so i plan on doing the follwing, have a wailist, then have erly version of the app working on pi or like t3code use exsiting ai susbs from the user liek codex, and then wialtist ppl get free  acess if they bring thier subsciron from othe paltofrms, its trink the user thinks we are trying to packh them for chatgp,t but aculty we are using thier subsiciron i nteh backberok and for some urse ,like firues and tuff they prdoviede feedback and asutff, until we reale the full app fr evleydoy we have our own tokens we use ,&#x20;

34. A
35. D
36. D
37. C, its a offer, 20 become 10, 40 becomes 20, 50% off
\`\`\`

## Q38 through Q41

### Questions as asked

❓ **Q38** - **Who enters early access first?**

A. Everyone on the waitlist receives access at once  
B. Small weekly groups receive access so you can handle bugs and feedback  
C. Depositors receive access first, followed by the free waitlist  
D. Only people who agree to structured testing receive access

➡️ I recommend C, released in small groups. Depositors get priority. Then invite free testers who can connect a supported AI account and agree to report failures.

---

❓ **Q39** - **Will the existing-subscription model be explicit?**

A. The onboarding clearly says which service Studi connects to and that work consumes that service's usage allowance  
B. It appears only in the terms  
C. Studi presents the usage as free without explaining the connected subscription  
D. Users discover it when asked to sign in

➡️ I recommend A. Say: "Early access does not include AI usage. Connect a supported AI account you already pay for. Studi will show which account is active and how its allowance is being used."

Anything less will feel like Studi hid the meter.

---

❓ **Q40** - **How long does the 50% founding discount last?**

A. First month  
B. First three months  
C. First year  
D. For the lifetime of the account  
E. Until the customer cancels

➡️ I recommend C. Founders pay $10 or $20 per month for the first year. After that, they move to the standard $20 or $40 price. A lifetime discount creates a permanent cost obligation before you know what heavy users cost.

---

❓ **Q41** - **What does providing feedback earn?**

A. Early access only  
B. Free access while Studi still uses the tester's existing AI subscription  
C. Additional weekly usage after Studi begins paying for models  
D. A permanent discount  
E. Cash or gift-card rewards

➡️ I recommend B during early access and limited C after launch. Define useful feedback as completing a short report with the task type, expected result, actual result, and optional diagnostic logs. Do not make permanent discounts depend on subjective feedback quality.

### User answer, verbatim

\`\`\`text
38.c
39.c, for early testing i told you they get the productr for free saying you need a exisint sub fom claude or codex or sotmhing and that you can transfer that sub to studi, the ppl who pay have porootoyr to get the relay acess ,and they get the one month of our credits, on top of geting htis trasfer subscirpiton
40.A,
41.A, B
\`\`\`

## Q42 through Q45

### Questions as asked

❓ **Q42** - **How will the beta handle provider policy conflicts?** OpenAI prohibits academic dishonesty in its [usage policies](https://openai.com/policies/usage-policies/). Anthropic also prohibits submitting AI-assisted work without required permission or attribution in its [usage policy](https://www.anthropic.com/legal/aup).

A. Codex and Claude power only permitted assistance, which changes Studi's behavior  
B. Full autonomous completion uses a self-hosted or separately approved provider  
C. Codex powers the controlled demo, while you develop a permitted model path before public agent access  
D. Public Studi uses Codex and Claude for unattended schoolwork despite their policies

➡️ I recommend C. Use Codex's supported local integration to build and demonstrate Studi against controlled tasks. Do not promise public unattended assignment completion until the production model path permits it.

---

❓ **Q43** - **How is early access distributed?**

A. Anyone downloads the installer, but Studi accounts activate in waves; depositors go first  
B. Only invited testers receive the installer  
C. Everyone receives full access immediately  
D. Depositors receive access, and free testers never do

➡️ I recommend A. The public download page can build interest while account activation limits support load and provider issues.

---

❓ **Q44** - **Is this the correct founding-offer math?**

- The customer pays a $20 deposit.
- They receive priority early access.
- During beta, they connect an eligible existing AI plan.
- At launch, the deposit becomes $20 of Studi credit.
- Their first paid month is 50% off.
- On the $20 plan, the first month costs $10 and $10 credit remains.
- On the $40 plan, the first month costs $20 and uses the full credit.

A. Yes  
B. No, the deposit guarantees one completely free month on either plan  
C. No, describe the intended calculation

➡️ I recommend A. It is valuable without turning a $20 deposit into an uncapped $40 obligation.

---

❓ **Q45** - **When is the deposit refundable?**

A. Any time before the paid launch  
B. Within 14 days of purchase  
C. Until the customer receives beta access  
D. It is nonrefundable

➡️ I recommend A. Once the paid release launches, the customer chooses a plan or requests the deposit back. Do not convert it silently.

### User answer, verbatim

\`\`\`text
q42. look at the pi sdk, and t3code, opencode all which supported other susbciprstns we will be the smae, ignore polcity till we beome an acuta locmpy again, this does not relate the product, why are ou aksing about policies and stuff,&#x20;

43.B

44.no lest do this, the suser can pay 10 or 20 50% off acutal prices, and after beta or whenver we realse, full app we give then the creidsit/ they arledy have a subscirootn whihc activates, we can talk mroe about this later when we acutly launch the prooudcty&#x20;

45.D nonrefundale,
\`\`\`

## Q46 through Q50

### Questions as asked

❓ **Q46** - **When does Studi start eligible work?**

A. Only when the student presses `Start`  
B. Immediately after discovering work with an auto-complete preference  
C. A deadline-aware scheduler chooses when to begin  
D. The student creates fixed work windows  
E. A combination

➡️ I recommend E. Saved preferences determine what Studi may do. A deadline-aware scheduler determines when, considering due dates, estimated duration, weekly usage, and whether the computer is available. Students can also press `Start now` or schedule a work window.

---

❓ **Q47** - **How does Studi prioritize the queue?**

A. Earliest deadline first  
B. The agent decides from deadlines, effort, grades, and dependencies  
C. The student orders everything manually  
D. The agent proposes an order, but the student can pin or drag tasks

➡️ I recommend D. Show why each item has its position, such as `due tonight`, `needs two hours`, or `blocked by missing file`. A pinned task always wins.

---

❓ **Q48** - **How many tasks can work simultaneously?**

A. One task total  
B. Several full computer-control tasks at once  
C. One task controls the computer while other agents research, write, or plan in the background  
D. The student chooses without a limit

➡️ I recommend C. Multiple agents can prepare work, but only one should control the visible browser and computer at a time. This matches the mockup's `browser is busy` state.

---

❓ **Q49** - **What appears when the student opens a working task?**

A. A status label and final result  
B. A raw agent transcript  
C. A structured activity timeline with expandable technical details  
D. A live browser view only

Controls could include `Watch`, `Take over`, `Pause`, `Cancel`, `Change instructions`, and `Move to top`.

➡️ I recommend C with every listed control. Show the current goal, completed steps, active website, saved course rule, blockers, and final evidence. Keep raw model messages behind a developer toggle.

---

❓ **Q50** - **Which desktop notifications are enabled by default?**

A. Only `Studi needs you`  
B. `Needs you`, `failed`, `submitted`, and urgent deadline warnings  
C. Every task-state change  
D. No desktop notifications

➡️ I recommend B. Let users disable categories and set quiet hours. A submission notification should name the course and assignment so an unexpected action is obvious.

### User answer, verbatim

\`\`\`text
&#x20;q46. on onbaoridng the user sets a dulft , do not attempr, attempt all, then after the afgetn does first autmtion or get all tths stuff, it also looks for reprating assigments, for exmpal a csc class cna hava the same format l;ab, a pushics lclass cna have a reparotng websiign hhowme work , and then the student can set per asismgent permissions, ect.
q47, from the assigmetn list the gaent sknow which he can work on then it goes in order of deadline, the studnt can laos guide the agent, the agent is baisly just one continous thread that auto compacts with mmorey, agents.md ect.&#x20;
48.A
49.a live browser with and C and A
50.B
\`\`\`

## Q51 through Q54

### Questions as asked

❓ **Q51** - **Which provider architecture should Studi use?**

A. Embed Pi as the only agent runtime  
B. Copy T3 Code's model and control separately installed provider clients  
C. Use OpenCode as the single provider gateway  
D. Create a Studi provider-adapter layer that can run Pi, Codex, Claude Code, or OpenCode

➡️ I recommend D. Give every adapter the same internal contract: connect, disconnect, list models, start or resume the agent, stream events, interrupt, report usage, and request user input. This avoids tying Studi to one provider.

---

❓ **Q52** - **Is the continuous agent literally one conversation?**

A. One conversation handles every course and task  
B. Each course has its own continuous conversation  
C. Each assignment has an isolated conversation  
D. One continuous supervisor manages isolated assignment sessions

A literal global thread can carry statistics assumptions into a programming task or keep irrelevant browser history through compaction.

➡️ I recommend D. The supervisor remembers the user, courses, queue, and permissions. Each assignment gets a focused execution session. Both read the same local preference and memory files.

---

❓ **Q53** - **What permission choices exist for work?**

A. `Do not attempt` and `Attempt`  
B. `Ignore`, `Prepare only`, `Complete and ask to submit`, and `Complete and submit`  
C. A free-text instruction for every assignment  
D. The agent decides from memory

➡️ I recommend B. Use those four states globally, per course, per repeating assignment pattern, and per individual assignment. The most specific setting wins.

Example:

- Global: `Prepare only`
- ST 370 weekly WebAssign: `Complete and submit`
- CSC316 workshops: `Complete and ask to submit`
- One specific workshop: `Ignore`

---

❓ **Q54** - **Where does the student manage a class?**

A. Settings only  
B. A course page opened by clicking the course name or assignment card  
C. Through chat commands only  
D. A separate `Courses` tab

➡️ I recommend B. The course page should show upcoming work, repeating assignment patterns, permissions, saved preferences, completed history, and what Studi has learned about the course. Keep the main navigation as clean as your mockup.

### User answer, verbatim

\`\`\`text
51.d,
52.D, all user input goes though one manager agent,
\`\`\`

## Q54 through Q57

### Questions as asked

❓ **Q54** - **Where can students review and change automation rules after onboarding?**

A. Only by telling the manager agent  
B. An `Automation rules` page in Settings  
C. Both chat and an `Automation rules` settings page  
D. By editing the preference Markdown file

The settings page could group rules like:

```text
ST 370
  Weekly WebAssign       Auto-submit
  Projects               Attempt

CSC316
  Workshops              Attempt
  Everything else        Use global default
```

➡️ I recommend C. Chat is faster for changes. Settings gives students a reliable way to see what the agent will do before it acts.

---

❓ **Q55** - **What can the manager agent do with command-bar input?**

A. Create or explain a task  
B. Change preferences  
C. Reorder, pause, cancel, or resume work  
D. Answer status questions  
E. Start takeover  
F. All of these

➡️ I recommend F. Each command should produce a visible result. If the student says, "Never submit CSC316 workshops," Studi should show a small confirmation such as `Preference saved for CSC316 workshops`.

---

❓ **Q56** - **What opens when the student clicks `Studi's desk`?**

A. A chat with the manager agent  
B. The current live browser and task  
C. A dedicated workspace containing manager chat, current task, live browser, timeline, and queue  
D. A compact side panel over the weekly dashboard

➡️ I recommend C. Assignment cards, notifications, and the `Studi's desk` button should all open this workspace. The weekly dashboard remains the planning view.

---

❓ **Q57** - **Which task states should users see?**

A. `Not started`, `working`, and `done`  
B. `Not started`, `queued`, `working`, `needs you`, `ready to submit`, `submitted`, `done`, and `failed`  
C. The agent writes a custom status sentence for every task  
D. Only an animated progress indicator

➡️ I recommend B. Use the friendly status sentence under each card, but keep one fixed state underneath so notifications, filters, and recovery behave consistently.

### User answer, verbatim

\`\`\`text
54. in settings,&#x20;
55. F
56. studi's desk pop up only when it is ccontorl a browser and dooig work, so the live brwose, and tracnsitpt, ect.
57. B
\`\`\`

## Q58 through Q62

### Questions as asked

❓ **Q58** - **Where does the manager respond when no browser task is running?**

A. A temporary message below the command bar  
B. A permanent chat screen  
C. A side panel that opens from the command bar  
D. Desktop notifications only

➡️ I recommend A. Show a compact response card beneath the command bar with `Dismiss`, `Open task`, or `Undo` when relevant. Keep the weekly dashboard visible.

---

❓ **Q59** - **What happens when a task reaches `ready to submit`?**

A. Studi opens the target website and leaves the student there  
B. Studi shows a review screen with the completed work, sources, files, changes, and `Submit` button  
C. The student must find the assignment manually  
D. The task simply stays in the queue

➡️ I recommend B. Include `Submit`, `Ask Studi to revise`, `Take over`, and `Mark done without submitting`. The submit action resumes the same assignment session.

---

❓ **Q60** - **What opens when the student selects a finished task?**

A. The original website  
B. A result page with the final output, submission evidence, files, source links, and an agent summary  
C. The entire raw transcript  
D. Nothing; finished tasks disappear

➡️ I recommend B. Add expandable transcript details and a `Do again` action. Keep finished work available through task history.

---

❓ **Q61** - **What happens to `Learning sessions` and `Library` during the work-agent beta?**

A. Hide both until the tutor launches  
B. Keep both as nonfunctional previews  
C. Hide `Learning sessions`, but use `Library` for completed work, files, sources, and saved study material  
D. Build both fully now

➡️ I recommend C. Library is already useful to the work agent. Hide Learning Sessions until there is a real tutor experience behind it.

---

❓ **Q62** - **When does Studi scan for new work?**

A. When the app starts  
B. On a fixed schedule  
C. When the student presses refresh  
D. All three

➡️ I recommend D. Scan on startup, every two hours while the computer is awake, and whenever the student requests it. Let users change the schedule in Settings.

### User answer, verbatim

\`\`\`text
only the siderbar, with the desk, it jsut appears if studi is working , so if its wokring it will show up there,&#x20;
59.studi sends a notificaiton for the usre, the usre can come in and submit and there a tiem likei like 5 minutes it can change in setitng, if the user doest do anything ut just leaves it be and ocntniue with que of tasks,&#x20;
60.i wuld idelay want it to open the submiston page, but idk how the browse will work with all of that cna the inapp browser in the elctorn app, leave the website as is and then have othre tabs the agetn is using i want you to reserach mroe about thats kind of stuff insted all this stuff,&#x20;
61.for the inital verison we dont inlcude leanring sessions and stuff,
62.the setudnet can start one manualyy, and in the onaboring the studetn can choose for when to run autmation, every week, everyday, eveery 2.3 days ect. we dont need every 2 hours .
\`\`\`

## Q63 through Q66

### Questions as asked

❓ **Q63** - **Which browser architecture should the plan adopt?**

A. Embedded Electron tabs using `WebContentsView`, with external Chrome as a fallback  
B. A separate visible Chromium window for all work  
C. A Chrome extension controlling the student's normal browser  
D. Embedded Electron only, with no fallback

➡️ I recommend A. It delivers the in-app experience you want while preserving a path for school logins that reject embedded browsers.

---

❓ **Q64** - **How long should a `ready to submit` tab stay alive?**

A. Until the student submits or cancels it  
B. Until its deadline passes  
C. Close it after the five-minute response window  
D. Close it when Studi begins the next task

➡️ I recommend A. Hide the tab when Studi continues the queue, but do not destroy it. After a restart, restore it from the saved local draft.

---

❓ **Q65** - **What happens when school login does not work inside Electron?** Google explicitly blocks OAuth inside developer-controlled embedded browsers, and some school SSO chains may do the same. [Google OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies)

A. Studi reports that the school is unsupported  
B. Studi opens a dedicated external Chrome profile and controls it there  
C. Studi asks the student to copy cookies into the app  
D. Studi requires an official school API

➡️ I recommend B. Keep that external browser profile dedicated to Studi. The student signs in normally, and Studi attaches through CDP.

---

❓ **Q66** - **Should the browser proof come before UI implementation?**

The proof would test only four things:

1. Browser Use attaches to packaged Electron.
2. It controls a `WebContentsView`.
3. One tab stays unchanged while another tab works.
4. The student takes over and returns control.

A. Yes, prove this first  
B. Build the full UI first and integrate the browser afterward

➡️ I recommend A. This should be the first build milestone. It resolves the largest unknown in the product.

### User answer, verbatim

\`\`\`text
63.A,
64.A,
65.we can think about that later, if it diest owrk,&#x20;
66.,A, we will base this on t3 codes browser use, playwiight mcp, ect. also look at how openai does thier comupter use/ browsuer use, and also look at chorme offical mcp thing, we can also jsut make a studi extension that attaches to chrome ect. but for now lest just make it a desktop app with buillt in brwoser
\`\`\`

## Q67 through Q70

### Questions as asked

❓ **Q67** - **Authoritative browser controller**: Which system should actually control Studi’s built-in browser?

A. A Studi-owned controller using Electron `webContents.debugger` and CDP, with an MCP adapter for provider agents  
B. Playwright MCP directly controls the browser  
C. Browser Use runs as the permanent controller  
D. Different providers use different browser controllers

➡️ **A.** Follow T3 Code’s architecture. Studi owns the tabs, sessions, permissions, takeover state, and action history. Browser Use and Playwright MCP can remain useful experiments or optional adapters. This prevents two systems from controlling different browser contexts.

---

❓ **Q68** - **How the agent understands pages**: What interaction hierarchy should Studi use?

A. Accessibility tree and DOM first, then screenshot understanding and coordinate clicks when needed  
B. Screenshots and coordinate clicks for everything  
C. DOM selectors only  
D. Let each provider choose its own method

➡️ **A.** Return a snapshot containing the URL, title, page text, accessible elements with short-lived IDs, screenshot, and recent events. The agent should click and fill using element IDs first. Visual coordinate actions handle canvas controls, diagrams, and unusual interfaces. This combines Playwright MCP’s reliable element references with OpenAI-style visual computer use.

---

❓ **Q69** - **Initial computer-use boundary**: For the first deployable Windows beta, does “computer use” mean:

A. The built-in browser plus downloads, uploads, file selection, clipboard, and notifications  
B. Full control of every Windows application immediately  
C. Browser control first, with a separate Windows-control adapter included experimentally  
D. Browser only, with no local file interaction

➡️ **C.** Make the schoolwork path dependable through the built-in browser, including file uploads and downloads. Keep full Windows control behind an experimental adapter so it cannot destabilize normal browser runs. This still leaves the architecture open for Word, Excel, PDFs, and other desktop applications.

---

❓ **Q70** - **Browser proof acceptance test**: What must the first browser prototype successfully demonstrate before we build the full dashboard around it?

A. Open a sample website and click around  
B. Sign into one of your real school platforms, scan the assignment list, detect a recurring assignment type, ask for its rule, complete one assignment, stop at submission, notify you, let you take over, and confirm submission  
C. Support Canvas, Blackboard, Moodle, and every homework platform  
D. Show a scripted recording that looks real

➡️ **B.** This is the smallest test that proves the actual product loop, including authentication persistence, discovery, preferences, agent work, takeover, submission state, and memory. It should be completed using your own account before inviting testers.

### User answer, verbatim

\`\`\`text
67.A,
68.A, idk just make it eady to impliment and capapble, just look at exisitn openosurce archetecure, idk
69.D, i would like A or C later on tho
70.we dont have to do all that we can build in small verifiable debgale steps, for example, we can fiest just crrate he agent adpapter sysytem, building on pi sdk, codex app server, opencode ect. idk where we cna test creating a new agent ect. then we cna test its browser use camapblites and stuff, then we can buidl the electorn app , and add the cusiotsiuon of studi agent, and the in app browes then setup browser use ect. we dont have to do , one your done asking quesitons loook thoguh our whole chat again, try to read betweeen line and try to get as close to what i want as poosbile and create a plan in html to go from 0 to 1, in steps with clear pass and fail cases in which we can run a loop ect.
\`\`\`

## Q71 through Q73

### Questions as asked

❓ **Q71** - **Relationship between agent runtimes**: What should define Studi’s agent architecture?

A. Pi is the core runtime, with Codex and OpenCode forced through Pi  
B. Studi defines its own small session contract, and Pi, Codex, OpenCode, and future agents are equal adapters  
C. Start separate implementations with no common contract, then unify them later  
D. Use only Codex for the first product

➡️ **B.** Studi should own session identity, task state, preferences, browser access, and normalized events. Each adapter only handles discovery, authentication, starting a session, sending a turn, streaming events, cancellation, resuming, and cleanup. This is the easiest design to test and extend.

---

❓ **Q72** - **Local persistence split**: Where should different kinds of local state live?

A. SQLite for tasks, courses, provider bindings, queue state, settings, and event indexes. Markdown files for agent instructions, preferences, course knowledge, and memories  
B. Markdown and JSON files for everything  
C. SQLite for everything, including agent memories  
D. Let each provider keep all state

➡️ **A.** The app needs reliable queries and state transitions, which SQLite handles well. The agent needs readable context it can inspect and update, which Markdown handles well. Provider-native session IDs stay in SQLite as opaque resume records.

---

❓ **Q73** - **Development entry point**: Should the agent system work without Electron before the desktop UI exists?

A. Yes. Build a headless CLI test runner that can discover adapters, start an agent, stream events, call a test tool, cancel, resume, and exit cleanly  
B. No. Start inside Electron so every feature is tested through the final app  
C. Build isolated scripts for each provider without a shared runner

➡️ **A.** This matches the small-loop approach you described. Every adapter runs through the same pass/fail tests before the browser or UI exists. Electron later consumes the same core package instead of becoming the test environment.

### User answer, verbatim

\`\`\`text
woul builindg and dpaapter route even good, the end goal is an app, where studetns pay use for studi agent which does thier shcool work, and ther reason i wanted to use pi and codex ect. is for testing, so i dont wate money, i can give my firnds thee app which coonecst to thier chatgpt sub and i can see for bugs and ect. and for the bringing their exisitng sub thing

71.idk give mew some more inof to base my decsion, how the end reuslt would be for each, pros and cons ect.

72.idk take inspo from the opencode app, t3 code, codex ect.
\`\`\`

## Q71

### Questions as asked

❓ **Q71** - **Final agent architecture**: With the distinction above, which direction should the plan use?

A. Build equal Codex, Pi, and OpenCode agent adapters  
B. Build Studi on Pi agent core, use its provider and authentication layer for beta subscriptions, then switch to Studi-funded inference later  
C. Build Studi entirely on Codex app-server and accept a later migration  
D. Build on Pi, but also create a small optional Codex beta engine only if Pi’s ChatGPT subscription route fails or limits testing

➡️ **D.** Pi should be the real Studi agent. Start with Pi and its ChatGPT subscription connection. Keep a narrow runtime boundary. Do not build the Codex bridge unless a real failure or tester need justifies it. This keeps the beta cheap without turning provider choice into the product.

### User answer, verbatim

\`\`\`text
B
\`\`\`

## Q74 through Q77

### Questions as asked

❓ **Q74** - **Beta AI connection**: What should friends install and connect?

A. They install only Studi. Inside Studi, they click "Connect ChatGPT plan." Studi bundles Pi and handles the connection internally  
B. They must install Codex CLI, OpenCode, or Pi separately before Studi works  
C. Studi shows a technical agent picker with Pi, Codex, and OpenCode  
D. Studi pays for all beta usage

➡️ **A.** ChatGPT Plus or Pro is the first supported beta connection. Friends should never need to know Pi exists. We can keep API-key input as a developer option and add more connections only when testers need them.

---

❓ **Q75** - **Paid-launch model traffic**: During beta, Pi can contact the model provider directly using the student’s connection. When Studi starts paying for usage, we cannot put Studi’s master API key inside the desktop app.

Which paid architecture should we plan for?

A. Studi sends model requests through a Studi server that meters usage and relays requests without saving prompt or browser content  
B. Studi gives the desktop short-lived provider credentials so it contacts providers directly  
C. Users must always bring their own subscription, even after paid launch  
D. Put the provider API key inside the app

➡️ **A.** This changes one earlier assumption. At paid launch, model prompts and relevant browser context would pass through Studi’s server temporarily, but the server would not retain them. Memories, browser sessions, school credentials, assignments, and preferences remain local. Option B may become possible for some providers later, but it is harder to support consistently.

---

❓ **Q76** - **First assignment boundary**: Since the initial beta is browser-only, what work should Studi attempt?

A. Any assignment that can be completed inside the built-in browser, including web forms, quizzes, problem sets, LMS text submissions, and web editors. It detects unsupported file or desktop work and marks it `needs you`  
B. Only assignments from one hard-coded LMS  
C. Browser work plus Word, Excel, PDFs, downloads, and uploads immediately  
D. Attempt every assignment even when required tools are unavailable

➡️ **A.** Keep the browser agent general. The assignment scanner can discover everything, but the eligibility check only queues work Studi has the tools to complete.

---

❓ **Q77** - **Agent failure behavior**: What should happen when Studi cannot understand a page, verify an answer, or complete an assignment?

A. Try a small number of different approaches, save the failure state, notify the student, mark the task `needs you`, and continue the queue  
B. Keep retrying the same assignment until it succeeds  
C. Make the most likely guess and continue  
D. Stop the entire queue

➡️ **A.** Use two distinct attempts by default. The event log should record what failed, the current page, and what Studi needs from the student. Once the student helps, the agent resumes the same task.

### User answer, verbatim

\`\`\`text
74.A,
75.i am not sure i wnat more info, but i do want posthog and nayltics for our app it doeest matter if we store everyhting, but is there a wya to work iwth the pi stuff  we will use ?,
76.studi attemps eveythng for things that need more , we can just do student handof, and if its liek asisgments for cad, blender ect. which you acutly need to do stuff, we can just say those types of asisgments are not supported, yet, but later i am goign to inlcud egood workspace skills for crea docs, sheets, presentions ect. gmail, prob thro composioo, ect. codex also has simair plugins,&#x20;
77.A
\`\`\`

## Q75 through Q78

### Questions as asked

❓ **Q75** - **How should Studi-funded AI work at paid launch?**

**A. Thin Studi endpoint plus a managed AI gateway.** Pi calls a stable Studi API. Studi authenticates the user, checks credits, records usage, and forwards the streamed request through something like Vercel AI Gateway. Provider keys never enter the desktop app. We can change providers later without updating every installed copy.

**B. Full custom inference relay.** We build all routing, provider adapters, retries, metering, streaming, and model failover ourselves. Maximum control, but substantially more backend work before it improves the product.

**C. Give the desktop short-lived provider credentials.** Less proxy infrastructure and potentially lower latency, but support varies by provider and usage enforcement becomes harder.

**D. Keep requiring outside subscriptions.** Cheapest for Studi, but it conflicts with the final paid product because customers would need two subscriptions.

➡️ **A.** It gives Studi-owned credits and billing control without prematurely building an entire model gateway. PostHog measures behavior, latency, and estimated cost, while Studi’s database remains the authoritative credit ledger. [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)

---

❓ **Q78** - **How much agent data should PostHog receive during the invite beta?**

**A. Full but redacted debugging traces.** Store agent prompts, outputs, browser-tool arguments, tool results, model usage, retries, compactions, and failures. Strip passwords, cookies, authentication headers, session tokens, and other credentials before sending. Do not record the contents of school-site browser tabs through session replay.

**B. Metadata only.** Store event types, durations, costs, success rates, and error categories, but not prompts or tool details. Safer, but much worse for diagnosing why the agent made a bad decision.

**C. Metadata by default, with per-run detailed diagnostics.** When something fails, the tester chooses to share that run’s detailed trace. More controlled, but testers will often forget to enable it when the most important bugs occur.

PostHog session replay can record the Studi interface while masking text and inputs. The school browser is a separate Electron view, so we can exclude it entirely. [PostHog replay privacy](https://posthog.com/docs/session-replay/privacy)

➡️ **A for the invite-only beta.** Detailed redacted traces will be disproportionately valuable while a small group is deliberately finding bugs. Before the public release, we revisit this and likely move toward C.

### User answer, verbatim

\`\`\`text
75.A,
78.get as umuch usefull info as posoble , also have poshtihg on the frint for example replays, ect. whatevaer you think wil lbe good info for use, also we will use convex, and clerk for auth and backend
\`\`\`

## Q79 through Q81

### Questions as asked

❓ **Q79** - **What school data should Convex sync?**:

**A. Account data only.** Convex stores the user, plan, credits, beta access, usage, and feedback. Courses, assignments, rules, schedules, agent history, and memories stay on one computer. Reinstalling or changing computers means starting over.

**B. Hybrid sync.** Convex stores courses, assignments, permission rules, task states, schedules, user settings, and usage. Local storage keeps browser cookies, school passwords, learned browser workflows, agent sessions, screenshots, raw page data, and Markdown memories. On another computer, the dashboard and preferences return, but the student must sign into school sites and run a verification scan again.

**C. Cloud-first.** Convex stores nearly everything except passwords and cookies. This provides strong backup and future remote access, but adds synchronization conflicts and sends much more school content to the cloud.

➡️ **B.** It gives Convex a real product role and protects the student from losing their setup. Browser authentication and machine-specific agent state remain local. Convex’s reactive client also lets the dashboard update immediately when cloud records change. [Convex React client](https://docs.convex.dev/client/react/overview)

---

❓ **Q80** - **How should the student sign into Studi’s Clerk account?**:

**A. Sign in directly inside the Electron window.** This looks seamless, but Electron needs special origin configuration and secure Clerk token storage.

**B. Open Clerk in the student’s normal browser.** Studi starts a PKCE login, the browser handles Clerk, then returns control to the app through a temporary local callback. The app stores the refresh token in the operating system’s credential manager. No Clerk password passes through the Electron renderer.

**C. Show a device code.** The student opens a website, enters the code, and Studi activates afterward. Reliable, but clumsier for a consumer desktop app.

➡️ **B.** This is the cleanest production desktop flow. Clerk supports public clients with PKCE, and its reference desktop or CLI pattern uses the system browser, a loopback callback, and operating-system keychain storage. The resulting token can authenticate Convex through its custom auth provider interface. [Clerk PKCE](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth) [Clerk desktop authentication reference](https://github.com/clerk/clerk-cli-auth) [Convex custom auth provider](https://docs.convex.dev/api/modules/react)

---

❓ **Q81** - **Who can activate the downloadable beta?**:

You previously chose both “anybody can download and test” and a waitlist with priority access. These produce different launch mechanics.

**A. Public download, gated activation.** Anyone can download Studi. Activation requires an invite or founder purchase. Invited testers use it free by connecting ChatGPT. People paying $10 or $20 get priority access and their payment becomes launch credit.

**B. Fully open beta.** Anyone who downloads Studi and connects a compatible ChatGPT subscription can use it immediately. The waitlist becomes an email list rather than an access gate.

**C. Paid activation only.** Everyone must pay $10 or $20 before using the beta.

➡️ **A.** It preserves the public download and waitlist while keeping the first support load manageable. It also makes the founder offer valuable before Studi provides its own inference credits.

### User answer, verbatim

\`\`\`text
79.A,
80.B
81.we dont needd that right now, just ask quesitn to plan and build the app, but for ver yinital, its juat wialist, and i give my frind download, then i email some of the ppl on the waitlist, the download, even if the downald gets leaked  only some ppl with the acounts gets persmion off the ailist to sign in, clek supports wailislt , and paying still gets you acess first, with credits, ect. we dont need this right we cna calrity and think baout it later
\`\`\`

## Q82 through Q85

### Questions as asked

❓ **Q82** - **What should be the first real end-to-end browser test?**: This does not limit the final product. It gives us one concrete pass/fail target before making the agent work across arbitrary school sites.

**A. Moodle plus a linked WebAssign assignment.** Studi scans Moodle, finds the external system, asks for sign-in, remembers the repeating assignment type, completes one assignment, follows its submission permission, and returns evidence.

**B. A normal Moodle assignment.** Studi scans Moodle, opens an assignment, completes text fields or uploads a draft, and stops before submission.

**C. Start with generic browsing across any LMS.** No site becomes the reference test. This sounds broader, but failures become hard to reproduce because every school site behaves differently.

➡️ **A.** It exercises nearly the whole product in one run. It covers scanning, linked systems, handoff, recurring rules, browser work, submission permissions, and recovery. Your weekly WebAssign example is already the clearest real use case.

---

❓ **Q83** - **How should Studi save work while an assignment is in progress?**:

**A. Only leave it inside the school webpage.** Simple, but a refresh, crash, expired login, or closed tab can erase the work.

**B. Keep local checkpoints.** After meaningful progress, Studi saves a local structured checkpoint. For long written work, it also keeps a Markdown draft. The school page remains the working view, but Studi can restore the answers after a crash or sign-in handoff.

**C. Always write locally first.** Studi completes the entire assignment in local files and only opens the website when it is ready to transfer the result.

➡️ **B.** Browser-first work still feels direct, while local checkpoints make scheduled unattended runs recoverable.

---

❓ **Q84** - **What happens when the student closes the Studi window?**:

**A. Studi stays running in the system tray.** Scheduled scans and assignment work continue. Notifications can bring the student back for sign-in, review, or submission. A clear Quit action stops everything.

**B. Closing the window quits Studi.** Scheduled work only happens while the app window is open.

**C. Install a permanent background service.** Work can run without the desktop interface, including after login or reboot. This adds installer, permissions, update, and debugging work.

➡️ **A.** It supports the promised automation without introducing a separate system service. We can add “Start Studi when I sign in” as an onboarding or settings option.

---

❓ **Q85** - **How many computers can one Studi account actively automate from during beta?**:

**A. One primary computer.** The account can sign in elsewhere, but only one registered device runs schedules. Moving to another computer requires school sign-in and a new scan.

**B. Several independent computers.** Each device has its own local school state and schedules. This can duplicate work because Convex is not syncing assignments or queues.

**C. Several coordinated computers.** Devices share scheduling and task ownership through Convex, which conflicts with Q79’s account-only cloud storage.

➡️ **A.** It matches local-only school data and prevents two computers from attempting the same assignment.

### User answer, verbatim

\`\`\`text
82. again as i told you just copy an exisitng cababple browuser use stuff online for exmaple [https://github.com/ChromeDevTools/chrome-devtools-mcp/](https://github.com/ChromeDevTools/chrome-devtools-mcp/), [https://github.com/vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser). just make sure the agent can use tools calls to control the browser ect. we can make a codex thread in /school project go thoughr my cusrsr i alre dy have an utomation for htis ,and compare that to t he reulstujf of our app,&#x20;
83. just leavfe it instde the webage, and also if user doest submti with in  the time list he sets, like we discused before, save it as a markdown file with ansers, and show the user that whne he cliks on it,
84. A, we arely anssers this wution are you forgeitng stuff, is you conext window filled up ?,&#x20;
85. A, one browser we arel dy discussed this, too, create a markdown file with all the questons and exact ansers i put down and also dont keep running for ever with quesitong look at the intial prompt
\`\`\`

## Interpretation rule

The user's later answer wins when two entries conflict. The normalized bullets at the top capture the latest known decisions through Q85. Future implementation discoveries may add evidence, but they do not silently change a product decision.
