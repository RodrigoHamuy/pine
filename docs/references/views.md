# Views

A view draws all of pine at a glance in the Pine app: which agents there are, what each works on,
where the work came from, who handed what to whom, the copies (sub-agents) at work, which tools, MCP
servers and skills are in use, the event sources and who listens to them, the schedules and when each
runs next, each agent's conversations with their branches and worktrees, and what waits for you. It is a script of yours, a `.ts` (or `.js`) file
in the `views` folder of pine's home, and the app shows it in a panel at the right of the window
(`⇧⌘O`, View > Toggle View, the radar at the top right of the title bar). See "The view" in
[desktop.md](desktop.md) for the panel itself.

pine comes with one view, `office`: pine as a little tower house in pixels, a room and a robot for each
agent, main under the roof ([desktop.md](desktop.md), "The view", says what is what in it). A home gets it when pine starts without a `views` folder; after that the
folder is yours. Take it out and it stays out; put a file in and it can be chosen.

| | |
|---|---|
| Where | `~/.pine/views/<name>.ts`: the view `<name>`. A name is lowercase letters, digits, `.`, `-` and `_` |
| Which one is shown | The one picked with the view's name at the top of the panel: a list of the views in the folder, read again each time it opens. That choice is `ui.view` in pine.json, which the main agent's `set_setting` can set too. Not set: the view whose name comes first. `off` (in pine.json): no panel |
| No view | With no view in the folder, or `ui.view` set to `off`, the app shows no button for the panel |
| Where it runs | Only in the Pine app on a computer. The mobile app and the web client show no view |
| A change to the file | Close and open the panel to run it again |

## Writing a view

A view is one file. It imports from `pine/view` and nothing else, and its default export is the view:

```ts
import { defineView, running } from "pine/view";

export default defineView((host) => {
	const list = document.createElement("ul");
	host.root.append(list);
	const draw = () => {
		const s = host.state();
		list.replaceChildren(
			...s.agents.map((a) => {
				const li = document.createElement("li");
				const busy = running(s.work).filter((w) => w.agent === a.id).length;
				li.textContent = `${a.id} (${a.mode}): ${busy ? `${busy} at work` : "at rest"}`;
				li.style.color = a.color;
				li.onclick = () => host.select({ agent: a.id });
				return li;
			}),
		);
	};
	draw();
	const stop = host.on("state", draw);
	return () => stop();
});
```

pine keeps the module a view imports beside the views, as `views/.pine/view.ts`, and writes a
`views/tsconfig.json` that points `pine/view` at it: open `~/.pine/views` in your editor and the types,
the completion and the checks are there. `.pine/` and the tsconfig are pine's, brought up to date at
every start; they are no views.

The TypeScript is taken away before the app runs a view (Node's own type stripping), so a view uses
types that can simply be erased: no `enum`, no `namespace`, no parameter properties.

| Name | What it is |
|---|---|
| `defineView` | `defineView((host) => { ... })`, the default export of every view. Called once when the panel opens, with the `host`; what it returns is called when the panel closes |
| `ViewHost`, `host.root`, `host.state`, `host.on`, `host.select`, `host.open` | What the panel gives a view. `root`: the element to draw in, the middle of the panel, empty and sized by it; a canvas, SVG or HTML. `state()`: all of pine now, a `ViewState`. `on("state", fn)`: `fn(state)` with every new state, a few times a second while work runs and once a second at rest; `on("happening", fn)`: what just happened, as it happens, for a view that animates. Both return the function that stops them. `select({ agent: "books" })` or `select({ work: 12 })` shows that under the view with its details in words, `select()` the log again; what is selected comes back as `state.selected`. `open(...)` opens an agent, or a piece of work on its own, in a tab |
| `running`, `frame`, `ease`, `union`, `inside`, `along`, `lengthOf`, `seeded`, `hashOf`, `mix`, `shade`, `rgb` | Helpers. `running(state.work)`: the work that has not ended. A camera: `frame(aim, view, whole, { zMax, min, step?, zMin? })` says where to look to show a box (`step: 1` zooms in whole steps, for pixels that are to stay whole), `ease(cam, target, ms)` moves a camera a frame's time towards another. Boxes and paths: the box around boxes, a point in a box, a point along a path of straight pieces, a path's length. `seeded(n)`: random numbers that are the same for the same seed, `hashOf(name)`: a number from a name, for a look that is the same every time. Colors as `#rrggbb`: between two, lighter or darker, as numbers |

## What a view is told

A view is told the shape of pine and nothing of its content. It never sees a prompt, a task's text, an
answer, an error's text, a tool's arguments or subject (a path, a command), the text of a question you
are asked, a conversation's name, a git branch's name, a path, a model, a secret, a goal's objective, a
to-do list's steps, or what an event said. It is told names that are part of the setup: of agents, MCP
servers, skills, event sources and schedules.

| Name | What it is |
|---|---|
| `ViewState` | `{ at, agents, work, inputs, schedules, selected?, dark, focused }`. Times are the page's clock in milliseconds (`Date.now()`); `dark` says whether the app is drawn dark; `focused` whether its window is in front, so that a view that animates can draw seldom while it is not |
| `ViewAgent`, `ViewConversation` | An agent: `{ id, main, color, mode, mcp, skills, sources, schedules, conversations }`, its color as `#rrggbb`, its mode (`manual`, `safe`, `auto`, `bypass`, `plan`) and the names of its MCP servers, skills, event sources and schedules; the main agent at the top, then by name. `conversations`: your conversations with it, the main one first, then the one used last, each `{ id, main, branchOf?, worktree, busy, outside, goal? }`: a number for it (the same while the panel is open, never its name), the number of the conversation it was branched from, whether it works in a worktree, whether work runs in it, whether it read outside content, and where its goal stands (`active`, `paused`, `met`, `blocked`, `limit`) |
| `ViewInput` | A way in: `{ id, kind, name, type?, count, last?, agents, failing }`, `kind` one of `you`, `clock`, `source`, `outside`, `type` an event source's type (`mail`, `webhook`), `agents` the agents that listen to a source, `failing` a source that could not start or lost its connection |
| `ViewSchedule` | A schedule: `{ name, agent?, when?, next?, last? }`: the agent it wakes (none for one that is for all), how it was set (a cron line, `every 30m`, or a time), when it runs next and when it last ran while the panel was open. `state.schedules` has them all, the one that runs next first |
| `ViewWork`, `ViewFrom`, `ViewDoing` | A piece of work: `id`, `agent`, `copy` (a sub-agent), `parent` and `depth` (the work that started it), `from`, `doing`, `tool` and `mcp` (the name of the tool it is in, and its MCP server), `skill` (the skill it is reading, if its agent has it), `steps` (`{ done, total }` of its to-do list), `round` (of its conversation's goal), `waitingOn`, `started`, `finished`, `tools` (how many calls), `asking` (it waits for you), `mode` (the mode it runs in now), `held` (stricter than its agent's own: handed on from work in that mode), `outside` (it has read content from elsewhere), `conversation` (the number of the conversation it runs in or for), `branch` and `worktree` (that conversation is a branch; it works in a worktree). Running work and what ended in the last half hour. `from` is `{ k: "you" }`, `{ k: "clock", name? }` (a schedule), `{ k: "source", name }`, `{ k: "outside", name }` (a webhook, a route), `{ k: "agent", id }` (handed on, or the result coming back), `{ k: "copy", id }` or `{ k: "pine" }`. `doing` is `thinking`, `tool`, `writing`, `waiting` (for work it handed on or copies), `asking`, `done`, `failed` or `cancelled` |
| `ViewHappening` | `started`, `ended` (with `failed`), `tool` (with `mcp`) and `toolEnded` (with `ok`), `skill` (an agent read one of its skills), `steps` (its to-do list moved on), `event` (an input brought something in), `scheduled` (a schedule was due: its `name` and `agent`), `handed` and `answered` (between two agents), `copied` (a copy started), `asked` (you are asked something), `decided` (you said yes or no), `said` (you wrote to work under way), `sent` (an agent sent something out), `branched` (a conversation was branched: its number, the one it came `from`, whether into a `worktree`), `worktree` (one was `made` or is gone), `goal` (a goal's `status` changed), `outside` (a conversation read outside content for the first time) |

## What a view cannot do

The app runs a view in a frame of its own, sandboxed with scripts and nothing else, under a policy that
allows no address. So a view reaches neither the app, nor pine, nor the web: no `fetch`, no picture from
an address, no storage, no cookies, no other frame, no window of its own, no import but `pine/view`. It
cannot tell anybody what it saw. What it asks the panel to show or open is checked against the agents and
work the panel knows; anything else is ignored.

A view that throws is stopped, and the panel says why under it. A file pine cannot hand on (a name with
capitals or spaces, more than a megabyte, TypeScript that cannot be erased) is greyed out in the list at the top of the panel, with
what is wrong with it.

The folder lies in pine's home, which no agent writes: an agent cannot put a view there or change one.
The main agent can choose which view is shown (`ui.view`), and you are asked first.
