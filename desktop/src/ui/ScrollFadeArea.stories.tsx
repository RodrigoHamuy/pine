import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScrollFadeArea } from "../components/scroll-fade-area.tsx";

const lines = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of what scrolls`);

// What is cut fades: here the bottom, at the start; scrolled, the top too.
const meta = {
	component: ScrollFadeArea,
	args: { className: "h-60 w-72 rounded-md border", children: <div className="flex flex-col gap-1 p-3">{lines.map((l) => <div key={l}>{l}</div>)}</div> },
} satisfies Meta<typeof ScrollFadeArea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A row wider than its room scrolls sideways, without a bar: the fade at the end says there is more. */
export const Sideways: Story = {
	args: { axis: "x", bar: false, className: "w-72 rounded-md border", children: <div className="flex gap-2 p-2">{lines.slice(0, 12).map((l) => <span key={l} className="whitespace-nowrap">{l}</span>)}</div> },
};
