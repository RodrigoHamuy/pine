import { type ReactNode } from "react";
import { Dialog as UiDialog, DialogBackdrop, DialogContent, DialogTitle } from "@ui-sdk/react/dialog";

/**
 * A window over the page that asks for one thing, open while it is rendered. Escape and a press
 * beside it close it when there is an `onClose`; focus stays inside and returns where it was. It
 * starts on the first control inside, or on what `initialFocus` (a selector) names.
 */
export function Dialog({ title, children, onClose, width = 520, tone, footer, initialFocus }: { title?: ReactNode; children: ReactNode; onClose?: () => void; width?: number; tone?: "warn" | "accent"; footer?: ReactNode; initialFocus?: string }) {
	return (
		<UiDialog open dismissible={Boolean(onClose)} onOpenChange={(open) => !open && onClose?.()}>
			<DialogBackdrop className="scrim" />
			<DialogContent className={`dialog${tone ? ` dialog-${tone}` : ""}`} style={{ width }} aria-label={title ? undefined : "Dialog"} initialFocus={initialFocus}>
				{title ? <DialogTitle render={<div className="dialog-title" />}>{title}</DialogTitle> : null}
				<div className="dialog-body">{children}</div>
				{footer ? <div className="dialog-foot">{footer}</div> : null}
			</DialogContent>
		</UiDialog>
	);
}
