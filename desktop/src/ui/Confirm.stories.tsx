import type { Meta, StoryObj } from "@storybook/react-vite";
import { Trash2Icon } from "lucide-react";
import { Confirm } from "../Confirm.tsx";

// Opened, as after a click on its button: what is asked is what the picture shows.
const open: Story["play"] = async ({ canvasElement }) => (canvasElement.querySelector("button") as HTMLButtonElement).click();

const meta = { component: Confirm, args: { label: "Remove", question: "Remove the MCP server notes?", onConfirm: () => {} } } satisfies Meta<typeof Confirm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithIcon: Story = { args: { icon: Trash2Icon, label: "Remove this skill", question: "Remove the skill invoices?", action: "Remove" } };

export const Asked: Story = { play: open };

export const AskedDark: Story = { play: open, globals: { theme: "dark" } };
