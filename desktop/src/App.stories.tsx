import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import * as App from "./App.tsx";

// The dialogs of App.tsx, one group of stories each: a CSF file has one default export, so the
// stories are named after the dialog they show.
const meta = { title: "App", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;

type ApprovalStory = StoryObj<typeof App.ApprovalDialog>;
const approval: ApprovalStory["args"] = { req: { id: "a1", agent: "main", task: 12, tool: "bash", summary: "echo hello", why: "bash is on your approve list.", expires: 0, remember: "bash" } };
const renderApproval: ApprovalStory["render"] = (args) => <App.ApprovalDialog {...args} />;

export const ApprovalDialog: ApprovalStory = { render: renderApproval, args: approval };

export const ApprovalDialogDark: ApprovalStory = { render: renderApproval, args: approval, globals: { theme: "dark" } };

/** Something only the owner has, typed here and sent to the daemon alone. */
export const ApprovalDialogWithSecret: ApprovalStory = {
	render: renderApproval,
	args: { req: { id: "a2", agent: "main", task: 13, tool: "add_source", summary: "telegram source: chat with you", why: "it needs a token.", expires: 0, inputs: [{ name: "TELEGRAM_TOKEN", label: "TELEGRAM_TOKEN: the bot's token from @BotFather" }] } },
};

// A picture of 120 by 80, drawn here: the page loads nothing from the web.
const PICTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#5de4c7"/><circle cx="240" cy="160" r="90" fill="#1b1e28"/></svg>')}`;

// It opens when a picture of the conversation asks for it, as a click on one does.
function ZoomedLightbox() {
	useEffect(() => void window.dispatchEvent(new CustomEvent("pine:zoom", { detail: PICTURE })), []);
	return <App.Lightbox />;
}

export const Lightbox: StoryObj = { render: () => <ZoomedLightbox /> };

export const LightboxDark: StoryObj = { render: () => <ZoomedLightbox />, globals: { theme: "dark" } };

// The palette lists what the app has: here, without a daemon, its commands and the settings' pages.
export const Palette: StoryObj = { render: () => <App.Palette /> };

export const PaletteDark: StoryObj = { render: () => <App.Palette />, globals: { theme: "dark" } };

type PickStory = StoryObj<typeof App.PickDialog>;
const renderPick: PickStory["render"] = (args) => <App.PickDialog {...args} />;

export const PickDialog: PickStory = {
	render: renderPick,
	args: {
		p: {
			title: "Model for main",
			placeholder: "Search models",
			current: "mock/m",
			items: [
				{ value: "mock/m", label: "mock/m" },
				{ value: "anthropic/claude", label: "anthropic/claude", about: "signed in" },
				{ value: "studio/qwen", label: "studio/qwen", about: "a model server of your own" },
			],
			done: () => {},
		},
	},
};

export const PickDialogDark: PickStory = { ...PickDialog, globals: { theme: "dark" } };

/** A long list gets a field that narrows it. */
export const PickDialogTyped: PickStory = {
	render: renderPick,
	args: { p: { title: "New conversation with", done: () => {}, items: ["main", "scout", "books", "home", "mail", "notes", "news", "garden"].map((id) => ({ value: id, label: id, about: `the agent ${id}` })) } },
};

/** A choice that cannot be taken back makes it an alert dialog. */
export const PickDialogRemoving: PickStory = {
	render: renderPick,
	args: {
		p: {
			title: "Remove the agent spare?",
			done: () => {},
			items: [
				{ value: "erase", label: "Remove it with everything it has", about: "its 2 conversations, sources, schedules, servers, skills and its folder. This cannot be undone", tone: "bad" },
				{ value: "keep", label: "Remove it, but keep its folder", about: "the folder is moved to removed/ in pine's home" },
				{ value: "no", label: "Cancel" },
			],
		},
	},
};

export const PickDialogRemovingDark: PickStory = { ...PickDialogRemoving, globals: { theme: "dark" } };

type QuestionStory = StoryObj<typeof App.QuestionDialog>;
const question: QuestionStory["args"] = { req: { id: "q1", agent: "main", task: 12, tool: "question", summary: "Which database?", why: "", expires: 0, choices: ["the old one", "the new one"] } };
const renderQuestion: QuestionStory["render"] = (args) => <App.QuestionDialog {...args} />;

export const QuestionDialog: QuestionStory = { render: renderQuestion, args: question };

export const QuestionDialogDark: QuestionStory = { render: renderQuestion, args: question, globals: { theme: "dark" } };
