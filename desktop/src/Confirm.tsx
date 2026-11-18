// Something that cannot be taken back is asked about first, in an alert dialog: a stray click
// beside it does not answer, Escape and Cancel leave everything as it was, and focus goes back
// to the button that asked.
import type { LucideIcon } from "lucide-react";
import { type ReactElement, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/hint";

/**
 * A button that asks `question` before it does what `onConfirm` does. With an icon, `label` is its tooltip.
 * `trigger` is the element the button is drawn as (a ghost Button by default; the side bar's stock `SidebarMenuAction`).
 */
export function Confirm({ label, question, action = label, onConfirm, icon: Icon, trigger }: { label: string; question: string; action?: string; onConfirm: () => void; icon?: LucideIcon; trigger?: ReactElement }) {
	const [open, setOpen] = useState(false);
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			{Icon ? (
				<Hint label={label}>
					<AlertDialogTrigger render={trigger ?? <Button variant="ghost" size="icon-xs" />}><Icon /></AlertDialogTrigger>
				</Hint>
			) : (
				<AlertDialogTrigger render={<Button variant="ghost" size="xs" />}>{label}</AlertDialogTrigger>
			)}
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
