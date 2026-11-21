// Pairing a device with a computer from a link the owner holds (the mobile app's): the field a link
// is pasted into, and the owner's yes to a link before its code is used. They take what they show
// as props, so that their stories need no bridge; the store is wired in by the parts that use them.
import { LinkIcon } from "lucide-react";
import { useId, useState } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { otherService, type PairLink } from "./machines.ts";

/**
 * A field to paste a pairing link into, for a link that did not open the app. `onLink` reads it and
 * says why when it is not a pairing link; otherwise the owner is asked next, and the field empties.
 */
export function PairLinkField({ onLink }: { onLink: (text: string) => string | undefined }) {
	const [text, setText] = useState("");
	const [error, setError] = useState<string>();
	const id = useId();
	const go = () => {
		const why = onLink(text);
		setError(why);
		if (!why) setText("");
	};
	return (
		<Field data-slot="pair-link-field" data-invalid={error ? true : undefined}>
			<FieldLabel htmlFor={id}>Pairing link</FieldLabel>
			<div className="flex items-center gap-2">
				<Input id={id} className="font-mono" placeholder="https://…/#pair=…" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-invalid={error ? true : undefined} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && go()} />
				<Button variant="outline" disabled={!text.trim()} onClick={go}>
					<LinkIcon data-icon="inline-start" />
					Pair
				</Button>
			</div>
			{error ? <FieldError>{error}</FieldError> : <FieldDescription>Where the code did not open this app, copy the link the Pine app gives beside it and paste it here.</FieldDescription>}
		</Field>
	);
}

/**
 * The owner's yes to a pairing link, before its code reaches the computer: the code is for one use,
 * so nothing is sent before it. A service that is not the official one is named, since every
 * connection to that computer goes through it.
 */
export function PairConfirm({ link, device, onPair, onCancel }: { link: PairLink; device: "phone" | "browser"; onPair: () => void; onCancel: () => void }) {
	const other = otherService(link);
	return (
		<AlertDialog open onOpenChange={(open) => open || onCancel()}>
			<AlertDialogContent data-slot="pair-confirm">
				<AlertDialogHeader>
					<AlertDialogTitle>Pair with this computer?</AlertDialogTitle>
					<AlertDialogDescription>
						This {device} asks the computer of this link to let it in. The computer then shows four digits beside this {device}'s name: press Allow there if they are the ones shown here.
					</AlertDialogDescription>
					{other ? (
						<AlertDialogDescription data-slot="pair-service">
							It is found through <span className="font-mono wrap-anywhere text-foreground">{other}</span>, which is not Pine's own service. Every connection to that computer goes through it. Pair only if it is the service the computer's owner set up.
						</AlertDialogDescription>
					) : null}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<Button data-slot="pair-confirm-yes" onClick={onPair}>Pair</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
