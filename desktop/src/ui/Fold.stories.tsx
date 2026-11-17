import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "./Button.tsx";
import { Fold } from "./Fold.tsx";
import { Icon } from "./Icon.tsx";

const meta = {
	component: Fold,
	args: { open: true, onOpenChange: () => {}, className: "side-group", lineClassName: "side-agent", head: null, children: null },
	decorators: [
		(Story) => (
			<div className="sidebar" style={{ width: 240 }}>
				<Story />
			</div>
		),
	],
	// Controlled: the story keeps whether the group is open, as the side bar does.
	render: function Render(args) {
		const [open, setOpen] = useState(args.open);
		return (
			<Fold
				{...args}
				open={open}
				onOpenChange={setOpen}
				head={
					<>
						<Icon name={open ? "down" : "right"} size={10} className="faint" />
						<span className="avatar">S</span>
						<span className="who">
							<span className="cut">scout</span>
							<span className="what">
								<span>Looks things up on the web</span>
							</span>
						</span>
					</>
				}
				aside={<Button small variant="ghost" icon="plus" title="New conversation with scout" />}
			>
				<div className="side-row side-conv">
					<span className="lead">
						<Icon name="star" size={12} className="faint" />
					</span>
					<span className="cut grow">main conversation</span>
				</div>
			</Fold>
		);
	},
} satisfies Meta<typeof Fold>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const Folded: Story = { args: { open: false } };
