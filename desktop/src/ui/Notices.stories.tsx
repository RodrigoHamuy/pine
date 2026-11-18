import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { toast } from "sonner";
import { store } from "../model.ts";
import { Notices } from "../ui.tsx";

// One notice of each tone, said the way the app says them. Each stays until dismissed, so the
// snapshot does not race a timer.
function Tones() {
	useEffect(() => {
		store.flash("Saved the settings.", "muted", Infinity);
		store.flash("Pine 0.40.0 is out.", "accent", Infinity);
		store.flash("Removed the agent spare.", "good", Infinity);
		store.flash("The browser build is not on this Mac.", "warn", Infinity);
		store.flash("limits.maxDownloadMb has to be a whole number from 1.", "bad", Infinity);
		return () => {
			toast.dismiss();
		};
	}, []);
	return <Notices />;
}

const meta = { component: Tones, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Tones>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
