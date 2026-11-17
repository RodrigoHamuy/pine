import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Icon, Tree, TreeRow } from "../ui.tsx";

type Node = { name: string; children?: Node[] };

const FILES: Node[] = [
	{ name: "src", children: [{ name: "index.ts" }, { name: "ui", children: [{ name: "Tree.stories.tsx" }] }] },
	{ name: "README.md" },
	{ name: "package.json" },
];

function Rows({ nodes, dir, depth, expanded, file }: { nodes: Node[]; dir: string; depth: number; expanded: string[]; file?: string }) {
	return (
		<>
			{nodes.map((n) => {
				const full = dir ? `${dir}/${n.name}` : n.name;
				const open = expanded.includes(full);
				const row = (
					<>
						{n.children ? <Icon name={open ? "down" : "right"} size={11} className="faint" /> : <span style={{ width: 11 }} />}
						<Icon name={n.children ? "folder" : "file"} size={13} className="faint" />
						<span className="cut grow">{n.name}</span>
					</>
				);
				return (
					<TreeRow key={full} value={full} label={n.name} row={row} on={file === full} depth={depth} branch={Boolean(n.children)}>
						{n.children ? <Rows nodes={n.children} dir={full} depth={depth + 1} expanded={expanded} file={file} /> : null}
					</TreeRow>
				);
			})}
		</>
	);
}

const meta = {
	component: Tree,
	args: { label: "Files", expanded: [], onExpandedChange: () => {}, onOpen: () => {}, children: null },
	decorators: [
		(Story) => (
			<div className="code-body" style={{ width: 320 }}>
				<Story />
			</div>
		),
	],
	// Controlled: the story keeps which folders are open and the file last opened.
	render: function Render(args) {
		const [expanded, setExpanded] = useState(args.expanded);
		const [file, setFile] = useState<string>();
		return (
			<Tree {...args} expanded={expanded} onExpandedChange={setExpanded} onOpen={setFile}>
				<Rows nodes={FILES} dir="" depth={0} expanded={expanded} file={file} />
			</Tree>
		);
	},
} satisfies Meta<typeof Tree>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Opened: Story = { args: { expanded: ["src", "src/ui"] } };
