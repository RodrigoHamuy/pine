import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Icon } from "./Icon.tsx";
import { List, ListRow } from "./List.tsx";

const FILES = ["README.md", "src/index.ts", "src/ui.tsx", "package.json"];

const meta = {
	component: List,
	args: { label: "Files that fit", value: null, onOpen: () => {}, children: null },
	decorators: [
		(Story) => (
			<div className="code-body" style={{ width: 320 }}>
				<Story />
			</div>
		),
	],
	// Controlled: the story keeps the row last opened so that a click or Enter shows on it.
	render: function Render(args) {
		const [value, setValue] = useState(args.value);
		return (
			<List {...args} value={value} onOpen={setValue}>
				{FILES.map((f) => (
					<ListRow key={f} value={f} label={f} className={`frow${value === f ? " on" : ""}`}>
						<Icon name="file" size={13} className="faint" />
						<span className="cut">{f}</span>
					</ListRow>
				))}
			</List>
		);
	},
} satisfies Meta<typeof List>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoneOpen: Story = {};

export const OneOpen: Story = { args: { value: "src/index.ts" } };
