import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Pick, type PickRow } from "./Pick.tsx";

const ROWS: PickRow[] = [
	{ value: "new", label: "New conversation", keys: "N", group: "Conversations" },
	{ value: "rename", label: "Rename the conversation", group: "Conversations", current: true },
	{ value: "settings", label: "Settings", about: "Models, tools, the sandbox", keys: ",", group: "App" },
	{ value: "quit", label: "Stop the daemon", about: "Every agent stops", group: "App", bad: true },
];

const meta = {
	component: Pick,
	parameters: { layout: "fullscreen" },
	args: {
		title: "Commands",
		label: "Search commands",
		placeholder: "Type a command",
		rows: ROWS,
		query: "",
		onQuery: () => {},
		onChoose: () => {},
		onClose: () => {},
	},
	// Controlled: the story keeps the query so that typing filters the rows.
	render: function Render(args) {
		const [query, setQuery] = useState(args.query);
		const rows = args.rows.filter((r) => String(r.label).toLowerCase().includes(query.toLowerCase()));
		return <Pick {...args} rows={rows} query={query} onQuery={setQuery} />;
	},
} satisfies Meta<typeof Pick>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// `initial` highlights a row of the second group.
export const InitialInSecondGroup: Story = { args: { initial: "settings" } };
