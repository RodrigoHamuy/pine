import { MessageSquareIcon } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as ui from "./ui.tsx";

// pine's own parts of ui.tsx, one group of stories each: a CSF file has one default export, so
// the stories are named after the part they show.
const meta = {} satisfies Meta;
export default meta;

type EmptyStory = StoryObj<typeof ui.EmptyView>;
const renderEmpty: EmptyStory["render"] = (args) => <ui.EmptyView {...args} />;

export const EmptyView: EmptyStory = { render: renderEmpty, args: { icon: MessageSquareIcon, title: "No conversation yet", children: "Write a message to begin." } };

export const EmptyViewTitleOnly: EmptyStory = { render: renderEmpty, args: { title: "No conversation yet" } };

type LogoStory = StoryObj<typeof ui.Logo>;
const renderLogo: LogoStory["render"] = (args) => <ui.Logo {...args} />;

export const Logo: LogoStory = { render: renderLogo, args: {} };

export const LogoLarge: LogoStory = { render: renderLogo, args: { className: "size-12" } };
