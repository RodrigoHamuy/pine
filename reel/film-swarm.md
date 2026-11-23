# Boards and swarms: the script

59.4 seconds, 3840×2160 at 30 frames a second, without sound. `node reel/render.mjs --film swarm --silent`
writes `reel/pine-reel-swarm.mp4`. (The typing is in the app's pictures, so the film has no key or click cues,
and without `--silent` the sound step stops on the empty list after the video is written. Music needs a
cue-less path in `render.mjs` first.)

The app is the real Pine app in its dark default theme, in pictures taken by `node reel/swarm-shots.mjs`
while two scripted swarms ran in it (pine's mock model server, a pine home of its own under
`/Users/Shared`, removed after). The room around it is bright. The game beside the window is the code the
first swarm wrote (`reel/swarm/pelican/v1`, `v2`), running. Every line on screen is below.

## Shot list

| From | To | What is on screen | Words on screen |
|---:|---:|---|---|
| 0.0 | 2.1 | A bright room. | **Boards and swarms** · one job, many sub-agents, an answer that was checked |
| 2.1 | 6.0 | The Pine window comes up; the camera goes close to the message box, where the job is typed. | *1 · a game: a pelican on a bicycle* (stays to 30.5) · Type `/swarm` and the job. |
| 6.0 | 8.2 | The job as the owner's message, and pine's line under it: "swarm · started: main leads it". | The agent of the conversation leads the swarm. |
| 8.2 | 12.0 | The Board tab: #1 pelican, #2 bicycle, #3 world and game, worked side by side; #4 the critic, waiting for #3. | The pieces go on the board. Sub-agents build them side by side. |
| 12.0 | 14.7 | Task #4 opened: "4 of 10" and the weaknesses. Version 1 of the game runs beside it. | A critic that built none of it scores the picture: **4 of 10**. |
| 14.7 | 16.5 | The lead's words, and "swarm · 3 tasks are not done: round 2 of 8 starts". | Work is left on the board, so pine starts round 2. |
| 16.5 | 21.9 | The overview view: main "Waiting for 2 sub-agents", a line to its board "swarm · 2 at work"; closer on the two cards; then the overview's list of the board's tasks. | The overview shows who is working on what. |
| 21.9 | 24.8 | Task #8 opened: "8 of 10". Version 2 runs beside it. | Then the critic looks again. · Version 2: **8 of 10**. |
| 24.8 | 27.0 | Version 2 of the game, large, in front of the whole window. | The game the swarm wrote. |
| 27.0 | 30.5 | The lead's answer, "swarm · the answer is being checked by a sub-agent that did none of the work", "swarm · done after 2 rounds: 7 tasks, and the answer was checked". | Then a sub-agent that did none of the work checks the answer. |
| 30.5 | 31.4 | The window leaves and comes back with the second conversation. | |
| 31.4 | 35.6 | The second job typed. | *2 · a security review of your own test server* (stays to 56.6) · A second job: a security review of your own test server. |
| 35.6 | 39.2 | The overview: main "Waiting for 4 sub-agents", "swarm · 4 at work"; closer on the cards. | One area for each sub-agent. |
| 39.2 | 41.9 | The board: #4 File upload "Waits for an answer: Uploading needs somebody signed in. May I sign in with the test account?" | One of them asks a question. |
| 41.9 | 44.6 | The lead's answer as a note on the board, for tasks 1–2, 5 and the one that asked. | The lead answers on the board, once, for all of them. |
| 44.6 | 47.2 | #1–#5 done; #3 opened: "High. routes/search.js:5 builds its SQL from what was typed …". | Findings come back as tasks marked done. |
| 47.2 | 50.2 | #9 "You found none of these. Reproduce each finding …", at work and done. | A sub-agent that found none of them reproduces each one. |
| 50.2 | 54.8 | The report in a wide conversation: a table High / High / Medium / Medium / Low, each with its file and line and the fix; "Nothing in the shop was changed." | The report: findings by severity, with the fix for each. |
| 54.8 | 56.6 | "swarm · done after 1 round: 6 tasks, and the answer was checked". | Checked, and done. |
| 56.6 | 59.4 | The window fades; pine's logo. | **pine** · `/swarm` and what is to be done |

## What the owner types

1. `/swarm Build a small game: a pelican riding a bicycle. After every version, have a sub-agent that built none of it score the picture from 1 to 10 and list its weaknesses. Do not stop before it scores 8.`
2. `/swarm Review the security of my demo shop on localhost:8080. It is my own test server, and its code is in this folder. Split the review by area, have every finding reproduced by a sub-agent that did not find it, and give me a short report: findings by severity, with the fix for each. Test account: demo / demo.`

## The review's findings (made up; `reel/swarm/shop` is the shop they are about)

| Severity | Finding | Fix |
|---|---|---|
| High | Search puts what was typed straight into its SQL (`routes/search.js:5`) | Pass it as a parameter of the query |
| High | An upload is kept under the name it came with, whatever it is (`routes/upload.js:7`) | Accept pictures only, and store them under a name the shop makes |
| Medium | Sign-in answers wrong passwords without a limit (`routes/login.js:5`) | Slow down after 5 wrong tries for an account |
| Medium | The session id stays the same after sign-in, in a cookie scripts can read (`routes/session.js:8`) | A new id at sign-in; `HttpOnly` and `SameSite=Lax` |
| Low | Errors show their stack trace, and no security headers are sent (`server.js:16`) | Turn `debug` off; add a content security policy and `nosniff` |

The review only reads the shop's code and changes nothing; the film shows findings and fixes, no attack steps.

## Files

| File | What it is |
|---|---|
| `film-swarm.html`, `film-swarm.js` | the film: the room, the camera, the captions, the game sheets |
| `swarm-shots.mjs` | runs both swarms in the real app and takes the pictures (`assets/swarm/`, not kept in git) |
| `swarm/pelican/v1`, `v2` | the game as the first swarm writes it, before and after the critic |
| `swarm/shop/` | the made-up demo shop the second swarm reviews |
