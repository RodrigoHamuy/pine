import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/**
 * A view with nothing in it: stock Empty, its icon, title and what to do. One line for the twenty
 * places that say so, each with an icon, a title and at most a sentence.
 */
export function EmptyView({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
	return (
		<Empty>
			<EmptyHeader>
				{Icon ? (
					<EmptyMedia variant="icon">
						<Icon />
					</EmptyMedia>
				) : null}
				<EmptyTitle>{title}</EmptyTitle>
				{children ? <EmptyDescription>{children}</EmptyDescription> : null}
			</EmptyHeader>
		</Empty>
	);
}
