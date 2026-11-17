import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Icon, StripTab, TabStrip } from "../ui.tsx";

const meta: Meta<typeof TabStrip> = { component: TabStrip };
export default meta;
type Story = StoryObj<typeof TabStrip>;

function Strip({ initial }: { initial: string }) {
	const [tabs, setTabs] = useState(["main", "scout", "Settings"]);
	const [value, setValue] = useState(initial);
	const move = (from: number, to: number) =>
		setTabs((all) => {
			const next = [...all];
			next.splice(to, 0, ...next.splice(from, 1));
			return next;
		});
	return (
		<div className="titlebar">
			<TabStrip label="Open tabs" value={value} onSelect={setValue} onMove={move}>
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
		</div>
	);
}

export const FirstSelected: Story = { render: () => <Strip initial="main" /> };
export const LastSelected: Story = { render: () => <Strip initial="Settings" /> };
