import { type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

export function Empty({ icon, title, children }: { icon?: string; title: string; children?: ReactNode }) {
	return (
		<div className="empty">
			{icon ? <Icon name={icon} size={22} /> : null}
			<div className="empty-title">{title}</div>
			{children ? <div className="empty-text">{children}</div> : null}
		</div>
	);
}
