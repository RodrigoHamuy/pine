import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlusIcon } from "lucide-react";
import { Hint } from "../components/hint.tsx";
import { Button } from "../components/ui/button.tsx";

// The button is named by the hint's text; on hover and focus the hint shows, with its keys.
const meta = {
	component: Hint,
	args: { label: "New conversation with main", keys: "⌘T", children: <Button variant="ghost" size="icon"><PlusIcon /></Button> },
} satisfies Meta<typeof Hint>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
