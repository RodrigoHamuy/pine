import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HoverTooltip as Hint } from "./hover-tooltip.tsx";

// A tooltip for a mouse: shown on hover and on a keyboard's focus, never on a touch screen.
const meta = { title: "Components/HoverTooltip", component: Hint } satisfies Meta<typeof Hint>;
export default meta;
type Story = StoryObj<typeof meta>;

export const HoverTooltip: Story = {
	args: {},
	render: (args) => (
		<Hint {...args}>
			<TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="New conversation" />}><PlusIcon /></TooltipTrigger>
			<TooltipContent>New conversation<Kbd>⌘T</Kbd></TooltipContent>
		</Hint>
	),
};

/** Open, as a mouse over the button shows it. */
export const HoverTooltipOpen: Story = { ...HoverTooltip, args: { defaultOpen: true } };
