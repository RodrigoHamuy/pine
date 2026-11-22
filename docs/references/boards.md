# Boards

A board is a shared place for the tasks of a job that several work on at once: an agent and
its sub-agents, or several agents. It is how agents that work on one project keep from doing
the same thing twice and share what they found: it keeps who does what, what came of each
task, and what one of them could not decide alone.

- A **task** is a piece of work. One run takes it, and while it has it nobody else can. When it
  is done, its result stays on the board. A task that cannot be done without a decision is
  *blocked* with a question, and is given out again when the question is answered.
- A **note** is something whoever works on the board should know: what they all go by, or,
  about one task, the answer to its question.

The one who gives out the work stays in charge of it. The agents on a board do not talk to
each other: each does its task and says what came of it, and the conversation that started
them reads the results, answers their questions and decides what is done next. Without a
board, ten sub-agents that look for inconsistent CSS each decide for themselves what the
"right" style is. With one, what they measure against is on the board before the first one
starts, and one that is unsure asks instead of guessing.

## What a board is, and what it is not

An agent that starts four sub-agents writes each its task anyway, and for that a list of the
same four tasks adds nothing: plain `subagent` is enough. A board is for what a task written
beforehand cannot do:

- There is more work than runs at once, and it is worked off a few at a time (a pool).
- A sub-agent that cannot decide something asks, and is answered while the others work on.
- One piece of work waits for another and is handed its result: a check after the work it
  checks.
- Work is added while it runs: by the agent, when a result calls for more, or by you.
- The one who posts a task and the one who takes it never started each other (a board with a
  name, and an agent woken by a schedule or an event).
- You see who has what, and can answer the one that is stuck.

A board is rows in pine's database. An agent reaches it only through the tools below, and
you see it in the Board tab of the Pine app ("The Board tab" in [desktop.md](desktop.md)) or
through the control API.

It is not a chat. Agents do not talk to each other on it: they take what is to be done and
say what became of it. Who plans the work, answers questions and judges the result is the
conversation that started it (or you). That is on purpose: agents of equal standing that
coordinate among themselves avoid the hard tasks and wait on each other, and sub-agents that
are told to share what they find mostly repeat what they were told.

## Which boards there are

| Board | Who uses it | Made by |
|---|---|---|
| A conversation's own board, which has no name | That conversation, its sub-agents, and whoever it hands a task to with `delegate` (for that one run, not in a `thread`) | The first post, or a task of yours in the Board tab. It goes when the conversation is reset or removed |
| A board with a name, `"scope": "local"` | The same, and nobody else | `board_post` with a new name and that scope, not by a sub-agent. It goes when the conversation is reset or removed |
| A board with a name, `"scope": "agent"` | Every conversation of the one that made it | `board_post` with a new name and that scope. Only in your own conversations, and not by a sub-agent. It goes when its agent is removed |
| A board with a name, `"scope": "global"` | Everyone | The main agent, the same way. Nothing removes it by itself |

Any board goes when you remove it in the Board tab, or when an agent removes it with
`board_remove` once its work is finished. A board of the conversation's own goes without a
question; one that other conversations use (`"scope": "agent"` or `"global"`) only after your yes.

A name is lowercase letters, digits, `-` and `_`. A new board with a name is made only with a
`scope`: an agent that leaves it out is told to say whom the board is for, so that a board meant
for all agents is never quietly made for one conversation. A sub-agent, and a run started from
outside, make no board with a name: they post on their conversation's own board. Another agent
that looks for a board that is not there is told who makes it, and to report that it is missing
rather than make a look-alike under that name that nobody else would see. (So whoever hands out
a board's tasks makes the board and posts them first.)
Where a name fits several
boards and no `scope` is given, the nearest is meant: the conversation's, then the agent's, then
the global one. With a `scope`, exactly the board of that place. Nobody reads a board
that is another's alone; what several share is a global board, or a conversation's own board
during a `delegate`.

## The tools

They are the actions of the family `pine_board`; the list `boards` is one of `pine_list`
("How tools are declared" in [agents.md](agents.md)).

| Tool | What it does |
|---|---|
| `boards` | Lists the boards the conversation can use, whom each is for, and how many tasks on each are open, taken, done, failed and blocked. |
| `board_read` [`board`] [`id`] | A board's tasks with who has each and what became of it, and the notes on it (the last 30). With `id`, one task in full with its result and the notes about it. |
| `board_post` `text` `type` [`board`] [`on`] [`after`] [`scope`] | Posts a task (`"type": "task"`: work somebody takes) or a note (`"type": "note"`: something whoever works on the board should know). A post without a type is refused: a task posted as a note would be one nobody can take. `on`: the task a note is about. `after`: tasks that have to be done before this one can be taken; whoever does it is shown what came of them. `scope`: whom a board with a name is for, needed when the name is new. The answer says so when it made a board and who sees it, and lists the notes others left since the agent last looked. |
| `board_claim` [`id`] [`board`] | Takes a task: the one with that number, or the oldest that is ready. The answer is the task in full. It is the agent's until `board_done`, or until the turn ends. |
| `board_done` `id` [`result`] [`outcome`] | Says what became of a task the agent took. `outcome`: `done` (the default) with its result, `failed` with why, `blocked` with the question that has to be answered before it can go on, `open` to give it back. The conversation that gave out the work also closes with it a task of its own board that nobody has: a question whose answer is the result already. |
| `board_remove` [`board`] [`id`] | Removes a board with everything on it, or with `id` one task or note (a task with the notes about it; tasks that waited for it no longer do). Without `board`, the conversation's own board. A board of this conversation goes without a question; one for all the agent's conversations, or for all agents (only the main agent's to remove), is put to you first, in every mode. A sub-agent of a pool that works on a task that goes is stopped, and a board a pool is at work on cannot be removed until its call has come back. Not for a sub-agent, nor for a run started from outside. What is removed cannot be brought back. |
| `board_answer` `id` `text` [`all`] | Answers the question a blocked task waits for: the answer becomes a note about the task, and the task is open again. Whoever takes it next is shown the question and the answer, as settled. With `"all": true` the answer is for the whole job: every other task that waits for an answer is opened again with it, and the tasks that are not finished are shown it, so that one answer does where several sub-agents have the same question. Not for a sub-agent: a question is answered by whoever gave out the work. |

Without `board` every one of them means the conversation's own board.

A task has one of these states:

| State | Meaning |
|---|---|
| `open` | Nobody has it. It is *ready* when every task named in its `after` is done; until then it waits for them. |
| `taken` | One run has it. |
| `done` | It has a result. |
| `failed` | It has the reason. A task that waits for a failed one stays open and is never ready, until you reopen the failed one or remove it. |
| `blocked` | It waits for an answer to the question in it. The agent that gave out the work answers with `board_answer`, or you in the Board tab: the answer becomes a note on the task, and the task is open again. |

## Nothing stays taken

A task is taken by a run of pine's (a task in `pine tasks`), not by an agent's word. When that
run ends, for whatever reason, the daemon looks at what it still holds: a task it did not
settle is open again. A task taken in a conversation is therefore taken for that turn. After a
restart of pine every task that was taken is open.

Two runs that ask for the same task at the same moment never both get it.

## A pool of sub-agents

`subagent` runs `subagents.maxParallel` sub-agents at a time: pine's setting `limits.maxSubagents`
(Settings > General > Limits, 4 unless you changed it), or what the agent's `agent.json` says. With
`"pool": true`, or simply with more tasks than run at once, it takes up to `limits.maxPoolTasks`
(100 unless you changed it): they go onto the
conversation's board, and that many sub-agents at a time work through them. Tasks that were on the board already (yours from the
Board tab, or posted with `board_post`) are worked too, and a call with `"pool": true` and no
tasks goes on with what is there.

Tasks on another board, such as a board for all agents on which an agent was given tasks, are
worked where they are: `subagent` with their numbers in `ids` (all of one board) gives each to a
sub-agent, and that sub-agent's answer settles that very task on that board. On such a board the
pool works those tasks and nothing else there, since the others may be somebody else's, and
`tasks`, `note` and `check` of the same call go onto that board too. A call with no tasks goes on
where the last one worked. Copying such a task's text into `tasks` would make a new task on the
conversation's board, and the one that was given out would stay open: the tool's description
tells the agent to use `ids` instead.

```
subagent(ids: [2, 3])
```

```
subagent(tasks: ["Check src/components/a for ...", "Check src/components/b for ...", ...40 more], pool: true,
         note: "The design tokens (src/styles/tokens.css): --space-1 4px, --space-2 8px, --space-3 16px; --color-text #111827, ... Report a spacing or a color only when it is none of these.")
```

All the tasks go into one call. (An agent that splits them over several calls in one answer
still gets one pool: the later calls add their tasks to the first.)

Sub-agents that start together cannot tell each other anything in time: each decides how it
works in its first moments. So what all of them need is said once, before any starts, in
`note`, and in full: the values and the rules themselves, not where to find them, so that no
sub-agent has to look them up again. It goes onto the board as a note for the tasks of that
call (a second round on the same board, such as a check after the work, has a note of its
own), and a call that has a `note` is a pool whether it says `pool` or not. Every sub-agent
goes by it, so a note that is wrong is wrong for all of them: the agent is told to say there
only what it read itself or you told it. If you know what they should measure against, say so
in your message.

### The agent stays in the loop

The call does not wait for the last task. It comes back to the conversation

- when a sub-agent **asks a question**: a wrong choice would make its result wrong and looking
  does not settle it (a value its task needs is given nowhere, the task can mean two things
  that give different results). It called `board_done` with `blocked` and its question, and
  stopped. An answer whose last line is a question counts the same: pine settles that task as
  blocked, not done, so that a question is never left in a result where it looks open and
  nothing waits for it. Small things it decides itself and says what it assumed, and what is
  simply not there (a file the task names) it reports as its result;
- when a sub-agent **fails**;
- or when nothing is left to do.

It comes back with what is settled since the conversation last looked, each result once, and
with every question that is open, each time until it is answered. The other sub-agents work on
meanwhile; no new ones are started until the conversation calls again.
The agent answers the question with `board_answer`, from what it knows for sure, can look up or
was told by you. A value or a choice that nobody gave it is yours: it asks you first and passes
on what you say (only `board_answer` puts the task back to work). Where other tasks have or
will have the same question it answers with `"all": true`: those that asked are opened again
with it, and a sub-agent that was still at work and asks the same a moment later has its task
given out again by pine itself, once, without a turn of the agent. Where its answer is the
result already, the agent closes the task itself with `board_done`. Then it calls `subagent` with
`"pool": true` and no tasks: that call takes over the sub-agents that are still at work, gives
the answered task to a new one, which is shown the question and the answer, and goes on.

- pine takes each task for the sub-agent it starts for it, and that sub-agent's final answer is
  the task's result. A sub-agent that never mentions the board leaves it right all the same.
- With its task a sub-agent is shown, when it starts: what came of the tasks its task waited
  for (`after`), the notes about its task, and the notes on the board that are for it: the
  `note` of the call its task came with, and what was posted for all with `board_post` (the
  last 12).
- A sub-agent that fails leaves its task `failed`, and what waits for that task is never
  started. One that is stopped leaves its task open.
- A task you add in the Board tab while the pool runs is worked like the others. A task you
  take back there is given to a new sub-agent; one you remove stops the sub-agent that has it.
  A question you answer there is as good as the agent's answer.
- When the agent's turn ends while sub-agents are still at work (it asked you something and
  waits), they finish their tasks, and the agent is told of the results at its next pool call.
  When you stop the conversation, its sub-agents stop with it and their tasks are open again.
- One call starts at most 100 sub-agents. `pool` and `worktree` do not go together.

> Find out what this project's design tokens are. Then check every folder in `src/components`
> for spacing and colors that do not match them, with a pool of sub-agents, one task per folder.

Ask it that way round: first what they measure against, then the pool. An agent that is told
to let its sub-agents choose a reference tends to choose one for them without looking.

### A check after the work

What a sub-agent says it did is a claim. With `check`, every task of the call is followed by a
second task for another sub-agent, which starts as soon as the work is done and is shown the
task and what came of it:

```
subagent(tasks: ["Summarise book/ch1.md in two sentences into summaries/ch1.md", ...],
         check: "Check the summary against its chapter, fact by fact, and count its sentences. Report what is wrong, or that nothing is.")
```

> For each of the six chapters in `book/`: have one sub-agent write a summary, and a second
> one check that summary against the chapter. Tell me what the checks found.

A check changes nothing and does not do the work again: it reports, and the agent reads the
report with the work's result and decides what to do about it. A call that has a `check` is a
pool whether it says `pool` or not.

By hand it is the same thing: a task posted with `after` (`board_post` with `"type": "task"`)
waits until the tasks it names are done, and whoever does it is shown their results.

## When a pool pays, and what it costs

A pool is not always the better way. The same jobs were run on pine with and without boards,
side by side, each several times, on a small model (Claude Haiku), with one folder or file for
each sub-agent:

| Job | Plain sub-agents, four at a time | A pool |
|---|---|---|
| 24 pieces, nothing unclear in them | Everything found, about two minutes, 6 calls | The same in the same time, in one call (one fault missed in one of five runs). About a quarter more tokens (3% to 48%) |
| 60 pieces | 24 to 26 of 26 faults found, in 15 to 19 calls, in four and a half to six minutes | 26 of 26 in both runs, in 1 to 3 calls, in about the same time. Up to 40% more tokens |
| 100 pieces | Not finished, in both runs: after 12 and 21 pieces the agent stopped and asked whether to go on, having found 5 and 7 of 39 faults | All 100 done in both runs, in one or two calls: 34 and 39 of 39 faults found, in seven to eight minutes |
| 12 pieces, two of which need a value nobody gave | Both wrong in every run: the sub-agent cannot ask, and leaves the value out or makes one up | Right in about half the runs (the sub-agent asked, the agent asked you and passed the answer on), left open or wrong in the others |
| Work, then a check of each piece | The same result, in two rounds | The same result in one call with `check`, at the same cost |

A larger model (Claude Sonnet) did the 24 pieces equally well both ways at the same cost, and
saw the missing value itself: it told its sub-agents not to convert, and asked you at the end,
with or without a pool.

What boards cost when they are not used: about 700 tokens in every request, a tenth of what
pine's tools take, for the tools' declaration. A sub-agent of a pool is given about 150 tokens
with its task. A question costs the agent a turn.

So:

- Up to four tasks, each clear: plain `subagent`.
- Many tasks: a pool. From a few dozen on it is the difference between a job that is finished
  and one that is not.
- Tasks in which something may be missing that only you know: a pool, and say in your message
  that the sub-agents should ask rather than assume.

## Several agents on one board

For one job, hand it on: a task an agent gives another with `delegate` (without `thread`) works
on the board of the conversation it came from, for that run. The specialist reads the notes
that are there and leaves its own.

For work that keeps coming, use a board with a name. The main agent makes one for all agents;
agents post tasks on it and take them. An agent takes a task when something tells it to: you,
a schedule ("every morning, take what is ready on the board bugs"), or an event.

### Events of a board

A board with a name that an agent or all agents have says what happens on it as events. Only
pine publishes on these topics: `publish_event` and a route's `publish` refuse them.

| Topic | When |
|---|---|
| `board/<name>/task` | A task can be taken: it was posted and waits for nothing, or it is open again. One that is open again comes with what was noted about it since, such as the answer to its question |
| `board/<name>/note` | A note was posted |
| `board/<name>/done`, `board/<name>/failed`, `board/<name>/blocked` | What became of a task |

The payload has `board`, `scope`, `owner` (the agent, for an agent's board), `id`, `by`, and
`text`: a line that says what happened, then the task, the note or the result. A conversation's
own board and a board for one conversation publish none of this.

A route wakes an agent when somebody posts a task ([events.md](events.md)):

```json
{ "name": "bugs", "on": "board/bugs/task", "agent": "fixer",
  "prompt": "{{payload.text}}\n\nTake it with board_claim, fix it, and settle it with board_done." }
```

## What a board does not get around

- **The outside-content mark.** A post carries the mark of the run that wrote it: one that had
  read outside content, or that an event from outside started. Whoever is shown that post is
  marked too, exactly as if it had read the page itself ([security.md](security.md)). So is a
  conversation whose pool worked a task that such a run posted, and a sub-agent that a pool
  starts with such a task, such a note, or the result of such a task that its own waited for. Listing the boards (`boards`)
  marks nobody.
- **Trust.** An event of a board has the trust of what was written: owner for a post from one
  of your own conversations that had read nothing from outside, untrusted otherwise. A route on
  it runs the agent accordingly.
- **Runs started from outside.** A run that an outside event started has no board tools, unless
  its agent's `untrusted` profile says `"board": true` ([configuration.md](configuration.md)).
  Then it reads and posts, what it posts counts as coming from outside, and it makes no board
  beyond its own conversation.
- **What is asked.** The conversation's own board is its list of work, like `todo`: its tools
  are never asked about, and they work in plan mode. A call that names a board (`board`)
  changes something other conversations read: it is asked about in manual mode and refused in
  plan mode, like any change inside the agent's own folders. `board_remove` is asked about in
  manual mode and refused in plan mode on any board, and on a board others use it asks you in
  every mode.
- **Other agents' files.** A board holds text. It opens no folder, and a result that names a
  file names it for whoever can read it.

What is on a board is information from others, not instructions, and the tools say so. That
is a sentence to a model, not a wall: a task is text an agent will follow. This is why a task
from a run that had read outside content marks the run that takes it.

## Limits

| What | Limit |
|---|---|
| A task's text, a result | 4000 characters; more is cut |
| A note | 2000 characters |
| Posts on one board | 500. Remove what is finished (`board_remove` with an `id`), or use a new board |
| Boards | 200. Remove the ones whose work is finished (`board_remove`, or the Board tab) |
| Sub-agents started by one `subagent` call with `pool` | 100 |

## From the control API

The owner's own hand, with the token ([operations.md](operations.md)). Every board is yours to
read, and what you post is yours.

| Endpoint | What it does |
|---|---|
| `GET /boards` | Every board with its counts, and in `tasks` where each task stands (`id`, `state`, `after`, `waits`, `run` and `holder` while somebody has it, who posted it in `by`, when in `created`, since when it stands so in `updated`, how many notes are about it in `notes`, `asked` when it asked something, and `outside` when it carries outside content), without a word of what it says: what a UI needs to draw a board |
| `GET /boards/<id>` | One board with its tasks and notes. A task says who has it (`holder`, `run`, `sub` for a sub-agent), what it waits for (`waits`), and whether what is in it came from a run that had read outside content (`outside`) |
| `GET /agents/<id>/boards?session=` | The boards that conversation can use, its own first |
| `POST /agents/<id>/boards/post` `{ session, text, kind?, after? }` | A task (or with `kind: "note"` a note) of yours on that conversation's own board, which is made if there is none |
| `POST /boards/<id>/post` `{ text, kind?, after?, on? }` | The same on a board by its number |
| `POST /boards/items/<n>` `{ action, text? }` | `reopen`: take a task back so that it can be taken again; `answer` with `text`: answer a blocked task; `done` with `text`: settle it by hand; `remove`: take a task or a note off the board. A sub-agent that a pool started for that task is stopped |
| `POST /boards/<id>/remove` | Remove a board with everything on it. A sub-agent that a pool started for one of its tasks is stopped |

A UI that is running is told on `pine/board` which board changed (`board`, `scope`, `agent`,
`session`, `name`, `change`) and which post (`item`, `kind`, and for a task its `state` now),
never what the post says, and asks for the rest; that event is not kept.
