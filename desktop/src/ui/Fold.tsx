import { type ReactNode } from "react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible";

/**
 * A line that folds what is under it away: `head` is the button that folds it (Enter, Space or a click),
 * `aside` stands beside it on the line, and `children` is what folds.
 */
export function Fold({ open, onOpenChange, head, aside, className, lineClassName, title, onContextMenu, children }: { open: boolean; onOpenChange: (open: boolean) => void; head: ReactNode; aside?: ReactNode; className?: string; lineClassName?: string; title?: string; onContextMenu?: React.MouseEventHandler<HTMLDivElement>; children: ReactNode }) {
	return (
		<Collapsible className={className} open={open} onOpenChange={(next) => onOpenChange(next)}>
			<div className={lineClassName} title={title} onContextMenu={onContextMenu}>
				<CollapsibleTrigger className="fold-trigger">{head}</CollapsibleTrigger>
				{aside}
			</div>
			<CollapsiblePanel>{children}</CollapsiblePanel>
		</Collapsible>
	);
}
