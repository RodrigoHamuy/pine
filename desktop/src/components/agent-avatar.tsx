import type { CSSProperties } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { isHex, onColor } from "../theme.ts";

/**
 * An agent's initial on the stock avatar. Without a color of its own it is the stock avatar. With one,
 * it is drawn in that color, with white or a near-black on it, whichever reads better (`onColor`):
 * the same in every theme, so that an agent is known by its color wherever it is.
 */
export function AgentAvatar({ agent, size, className }: { agent: { id: string; color?: string }; size?: "default" | "sm" | "lg"; className?: string }) {
	const color = isHex(agent.color) ? agent.color.toLowerCase() : undefined;
	const style = color ? ({ "--agent": color, "--agent-on": onColor(color) } as CSSProperties) : undefined;
	return (
		<Avatar size={size} data-agent={agent.id} className={className}>
			<AvatarFallback style={style} className={cn(color && "bg-(--agent) text-(--agent-on)")}>
				{agent.id.slice(0, 1).toUpperCase()}
			</AvatarFallback>
		</Avatar>
	);
}
