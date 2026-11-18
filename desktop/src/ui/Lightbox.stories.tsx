import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { Lightbox } from "../App.tsx";

// A picture of 120 by 80, drawn here: the page loads nothing from the web.
const PICTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#5de4c7"/><circle cx="240" cy="160" r="90" fill="#1b1e28"/></svg>')}`;

const meta = {
	component: Lightbox,
	parameters: { layout: "fullscreen" },
	// It opens when a picture of the conversation asks for it, as a click on one does.
	render: function Render() {
		useEffect(() => void window.dispatchEvent(new CustomEvent("pine:zoom", { detail: PICTURE })), []);
		return <Lightbox />;
	},
} satisfies Meta<typeof Lightbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Dark: Story = { globals: { theme: "dark" } };
