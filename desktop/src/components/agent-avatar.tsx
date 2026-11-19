import type { CSSProperties } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { store, useModel } from "../model.ts";
import { agentScheme, DEFAULT_PALETTE } from "../theme.ts";

/**
 * An agent's initial on the stock avatar. Without a colour of its own it is the stock avatar. With one,
 * it is drawn with the primary and on-primary roles of the agent's scheme (`agentScheme`: the owner's
 * palette with the agent's colour as its source), light and dark each from its own half of the scheme.
 * The roles come as values of the agent's scheme, not the window's tokens: the window's are the
 * owner's palette.
 */
export function AgentAvatar({ agent, size, className }: { agent: { id: string; color?: string }; size?: "default" | "sm" | "lg"; className?: string }) {
	const s = useModel(store);
	const scheme = agent.color ? agentScheme(agent.color, s.prefs.palette ?? DEFAULT_PALETTE) : undefined;
	const style = scheme
		? ({
				"--agent-primary": scheme.light.primary,
				"--agent-on-primary": scheme.light.onPrimary,
				"--agent-primary-dark": scheme.dark.primary,
				"--agent-on-primary-dark": scheme.dark.onPrimary,
			} as CSSProperties)
		: undefined;
	return (
		<Avatar size={size} data-agent={agent.id} className={className}>
			<AvatarFallback style={style} className={cn(scheme && "bg-(--agent-primary) text-(--agent-on-primary) dark:bg-(--agent-primary-dark) dark:text-(--agent-on-primary-dark)")}>
				{agent.id.slice(0, 1).toUpperCase()}
			</AvatarFallback>
		</Avatar>
	);
}
