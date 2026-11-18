import type * as React from "react";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A control with a hint: stock Tooltip around it (the control is the trigger, through Base UI's
 * `render`), with the keys that do the same in a Kbd.
 *
 * Why this exists: an icon-only button's name and its hint are one text. Written here once, the
 * text is both the button's accessible name (`aria-label`) and the tooltip, so the two never
 * differ, and the three stock parts are not repeated at every button. For a control whose own
 * text already names it (a chip with words), `describes` puts the hint in the tooltip only.
 */
export function Hint({ label, keys, describes, children }: { label: string; keys?: string; describes?: boolean; children: React.ReactElement }) {
	return (
		<Tooltip>
			<TooltipTrigger render={children} aria-label={describes ? undefined : label} />
			<TooltipContent>
				{label}
				{keys ? <Kbd>{keys}</Kbd> : null}
			</TooltipContent>
		</Tooltip>
	);
}
