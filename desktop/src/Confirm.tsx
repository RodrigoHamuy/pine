// Something that cannot be taken back is asked about first, in an alert dialog: a stray click
// beside it does not answer, Escape and Cancel leave everything as it was, and focus goes back
// to the button that asked.
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState } from "react";
import { Button } from "./ui.tsx";

/** A button that asks `question` before it does what `onConfirm` does. With an icon, `label` is its tooltip. */
export function Confirm({ label, question, action = label, onConfirm, icon }: { label: string; question: string; action?: string; onConfirm: () => void; icon?: string }) {
	const [open, setOpen] = useState(false);
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger render={<Button small variant="ghost" icon={icon} title={label} />}>{icon ? undefined : label}</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{question}</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={() => (setOpen(false), onConfirm())}>{action}</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
