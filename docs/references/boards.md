# Boards

A board is a shared place for tasks and notes, for a job that several work on at once: an agent
and its sub-agents, or several agents. It is how agents that work on one project share what
they found and keep from doing the same thing twice. It answers the two questions that parallel
work raises: who does what, and what did the others find.

- A **task** is a piece of work. One run takes it, and while it has it nobody else can. When it
  is done, its result stays on the board for the others to read.
- A **note** is something the others should know: a finding, a decision, which file is the
  reference. It can carry fields (`data`) that others compare without reading prose.

Without a board, sub-agents work blind. Ten of them that look for inconsistent CSS each decide
for themselves what the "right" style is, report against ten different ideas of it, and the
conversation that started them sorts ten essays. With a board the first one that finds the
token file says so in a note, the others read it with their next call, and a finding that is
on the board already is added to, not reported again.

## What a board is, and what it is not

An agent that starts four sub-agents writes each its task anyway, and for that a list of the
same four tasks adds nothing: plain `subagent` is enough. A board is for what a task written
beforehand cannot do:

- A sub-agent learns what another one found after they all had started (a note).
- There is more work than runs at once, and it is worked off a few at a time (a pool).
- Work is added while it runs: by a sub-agent that found more to do, or by you.
- The one who posts a task and the one who takes it never started each other (a board with a
  name, and an agent woken by a schedule or an event).
- You see who has what, and answer the one that is stuck.

A board is rows in pine's database. An agent reaches it only through the five tools below, and
you see it in the Board tab of the Pine app ("The Board tab" in [desktop.md](desktop.md)) or
through the control API.

It is not a chat. Agents do not talk to each other on it and do not wait for each other's
answers: they post what they found, take what is to be done, and say what became of it. Who
plans the work and who judges the result stays the conversation that started it (or you). That
is on purpose: agents of equal standing that coordinate among themselves avoid the hard tasks
and wait on each other.

## Which boards there are

| Board | Who uses it | Made by |
|---|---|---|
| A conversation's own board, which has no name | That conversation, its sub-agents, and whoever it hands a task to with `delegate` (for that one run, not in a `thread`) | The first post, or a task of yours in the Board tab. It goes when the conversation is reset or removed |
| A board with a name, `scope` left out or `"local"` | The same | `board_post` with a new name |
| A board with a name, `"scope": "agent"` | Every conversation of the one that made it | `board_post` with a new name and that scope. Only in your own conversations, and not by a sub-agent. It goes when its agent is removed |
| A board with a name, `"scope": "global"` | Everyone | The main agent, the same way |

A name is lowercase letters, digits, `-` and `_`. Where a name fits several boards, the nearest
is meant: the conversation's, then the agent's, then the global one. Nobody reads a board
that is another's alone; what several share is a global board, or a conversation's own board
during a `delegate`.

## The tools

They are the actions of the family `pine_board`; the list `boards` is one of `pine_list`
("How tools are declared" in [agents.md](agents.md)).

| Tool | What it does |
|---|---|
| `boards` | Lists the boards the conversation can use, whom each is for, and how many tasks on each are open, taken, done, failed and blocked. |
| `board_read` [`board`] [`id`] | A board's tasks with who has each and what became of it, and the notes on it (the last 30). With `id`, one task in full with its result and the notes about it. |
| `board_post` `text` [`kind`] [`board`] [`on`] [`after`] [`data`] [`scope`] | Posts a note, or with `"kind": "task"` a task. `on`: the task a note is about. `after`: tasks that have to be done before this one can be taken. `data`: fields as a JSON object, such as `{"file": "src/a.css", "line": 12, "kind": "spacing"}`. `scope`: only when `board` is a new name. The answer lists the notes others left since the agent last looked. |
| `board_claim` [`id`] [`board`] | Takes a task: the one with that number, or the oldest that is ready. The answer is the task in full. It is the agent's until `board_done`, or until the turn ends. |
| `board_done` `id` [`result`] [`outcome`] | Says what became of a task the agent took. `outcome`: `done` (the default) with its result, `failed` with why, `blocked` with the question a person has to answer, `open` to give it back. |

Without `board` every one of them means the conversation's own board.

A task has one of these states:

| State | Meaning |
|---|---|
| `open` | Nobody has it. It is *ready* when every task named in its `after` is done; until then it waits for them. |
| `taken` | One run has it. |
| `done` | It has a result. |
| `failed` | It has the reason. A task that waits for a failed one stays open and is never ready, until you reopen the failed one or remove it. |
| `blocked` | It waits for an answer from a person. You answer in the Board tab: the answer becomes a note on the task, and the task is open again. |

## Nothing stays taken

A task is taken by a run of pine's (a task in `pine tasks`), not by an agent's word. When that
run ends, for whatever reason, the daemon looks at what it still holds: a task it did not
settle is open again. A task taken in a conversation is therefore taken for that turn. After a
restart of pine every task that was taken is open.

Two runs that ask for the same task at the same moment never both get it.

## A pool of sub-agents

`subagent` takes at most `subagents.maxParallel` tasks (4 unless you changed it). With
`"pool": true` it takes up to 100: they go onto the conversation's board, and that many
sub-agents at a time work through them until none is ready. Tasks that were on the board
already (yours from the Board tab, or posted with `board_post`) are worked too, and a call with
`"pool": true` and no tasks works what is there.

```
subagent(tasks: ["Check src/components/a for ...", "Check src/components/b for ...", ...40 more], pool: true)
```

- pine takes each task for the sub-agent it starts for it, and that sub-agent's final answer is
  the task's result. A sub-agent that never mentions the board leaves it right all the same.
- Each sub-agent is told which task of the board is its own and that the others work beside
  it. The notes about its task come with it: your answer to a question it was blocked on, or
  a hint from whoever had it before. What it posts with `board_post` the others see at the end of their next board call, and
  in `board_read`.
- A sub-agent that fails leaves its task `failed`. One that is stopped leaves it open.
- The answer to the call has each task's result, the notes that were left, and what is not
  done with why (it waits for a task that failed, or 100 tasks were worked: call it again).
- A task you add in the Board tab while the pool runs is worked like the others. A task you
  take back there is given to a new sub-agent; one you remove stops the sub-agent that has it.
- `pool` and `worktree` do not go together.

> Look for inconsistent spacing and colors in `src/components`. Use a pool of sub-agents, one
> task per folder, and have them note which file they take as the reference.

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
| `board/<name>/task` | A task can be taken: it was posted and waits for nothing, or it is open again |
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
  conversation whose pool worked a task that such a run posted. Listing the boards (`boards`)
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
  plan mode, like any change inside the agent's own folders.
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
| `data` | 2000 characters as JSON; more is refused |
| Posts on one board | 500. Remove what is finished, or use a new board |
| Boards | 200 |
| Tasks worked by one `subagent` call with `pool` | 100 |

## From the control API

The owner's own hand, with the token ([operations.md](operations.md)). Every board is yours to
read, and what you post is yours.

| Endpoint | What it does |
|---|---|
| `GET /boards` | Every board with its counts |
| `GET /boards/<id>` | One board with its tasks and notes. A task says who has it (`holder`, `run`, `sub` for a sub-agent), what it waits for (`waits`), and whether what is in it came from a run that had read outside content (`outside`) |
| `GET /agents/<id>/boards?session=` | The boards that conversation can use, its own first |
| `POST /agents/<id>/boards/post` `{ session, text, kind?, after? }` | A task (or with `kind: "note"` a note) of yours on that conversation's own board, which is made if there is none |
| `POST /boards/<id>/post` `{ text, kind?, after?, on? }` | The same on a board by its number |
| `POST /boards/items/<n>` `{ action, text? }` | `reopen`: take a task back so that it can be taken again; `answer` with `text`: answer a blocked task; `done` with `text`: settle it by hand; `remove`: take a task or a note off the board. A sub-agent that a pool started for that task is stopped |
| `POST /boards/<id>/remove` | Remove a board with everything on it |

A UI that is running is told on `pine/board` which board changed (`board`, `scope`, `agent`,
`session`, `name`, `change`) and asks for the rest; that event is not kept.
