import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Icon, StripTab, TabStrip } from "../ui.tsx";

const TABS = ["main", "scout", "Settings"];

const meta = {
	component: TabStrip,
	args: { label: "Open tabs", value: "main", onSelect: () => {}, onMove: () => {}, children: null },
	decorators: [
		(Story) => (
			<div className="titlebar">
				<Story />
			</div>
		),
	],
	// Controlled: the story keeps the selection and the order so that a click or a drag sticks.
	render: function Render(args) {
		const [tabs, setTabs] = useState(TABS);
		const [value, setValue] = useState(args.value);
		const move = (from: number, to: number) =>
			setTabs((all) => {
				const next = [...all];
				next.splice(to, 0, ...next.splice(from, 1));
				return next;
			});
		return (
			<TabStrip {...args} value={value} onSelect={setValue} onMove={move}>
				{tabs.map((t) => (
					<StripTab key={t} value={t} className="tab">
						<span className="mark">
							<span className="avatar small">{t.slice(0, 1).toUpperCase()}</span>
						</span>
						<span className="name">
							<b>{t}</b>
						</span>
						<span className="close">
							<Icon name="x" size={11} />
						</span>
					</StripTab>
				))}
			</TabStrip>
		);
	},
} satisfies Meta<typeof TabStrip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FirstSelected: Story = {};

export const LastSelected: Story = { args: { value: "Settings" } };
