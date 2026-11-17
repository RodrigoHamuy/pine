import { type ReactNode } from "react";
import { AlertDialog, AlertDialogBackdrop, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@ui-sdk/react/alert-dialog";

/**
 * A question that needs an answer before going on, open while it is rendered: `yes` agrees, the
 * other button and Escape do not.
 */
export function Ask({ title, children, yes, no = "Cancel", onAnswer }: { title: ReactNode; children?: ReactNode; yes: string; no?: string; onAnswer: (yes: boolean) => void }) {
	return (
		<AlertDialog open onOpenChange={(open, details) => !open && onAnswer(details.returnValue === "yes")}>
			<AlertDialogBackdrop className="scrim" />
			<AlertDialogContent className="dialog dialog-warn" style={{ width: 420 }}>
				<AlertDialogTitle render={<div className="dialog-title" />}>{title}</AlertDialogTitle>
				{children ? <AlertDialogDescription render={<div className="dialog-body" />}>{children}</AlertDialogDescription> : null}
				<div className="dialog-foot">
					<AlertDialogClose className="btn btn-ghost" value="no">{no}</AlertDialogClose>
					<AlertDialogClose className="btn btn-danger" value="yes">{yes}</AlertDialogClose>
				</div>
			</AlertDialogContent>
		</AlertDialog>
	);
}
