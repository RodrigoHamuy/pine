import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../ui.tsx";

const meta = { component: Button, args: { children: "Save" } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = { args: { children: "Cancel" } };

export const Primary: Story = { args: { variant: "primary" } };

export const Ghost: Story = { args: { variant: "ghost", children: "More" } };

export const Danger: Story = { args: { variant: "danger", children: "Remove" } };

export const SmallWithIcon: Story = { args: { variant: "primary", icon: "plus", small: true, children: "New" } };

export const IconOnly: Story = { args: { icon: "gear", title: "Settings", children: undefined } };

export const Disabled: Story = { args: { disabled: true, children: "Disabled" } };
