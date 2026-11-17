import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLayoutEffect } from "react";
import { Toasts, toast } from "./Toasts.tsx";

const meta = {
	component: Toasts,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Toasts>;
export default meta;
type Story = StoryObj<typeof meta>;

// Each toast stays until dismissed, so the snapshot does not race a timer.
function Messages() {
	useLayoutEffect(() => {
		toast.dismiss();
		toast({ title: "Saved the settings.", duration: Infinity });
		toast.success({ title: "The agent is back.", duration: Infinity });
		toast.error({ title: "The daemon could not be reached.", duration: Infinity });
		return () => toast.dismiss();
	}, []);
	return <Toasts />;
}

export const Kinds: Story = { render: () => <Messages /> };
