import { cloneElement, isValidElement, type ReactNode, useId } from "react";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";

/**
 * A labelled field: stock Field with its FieldLabel and FieldDescription, as shadcn's form docs
 * write it.
 *
 * Why this exists: stock Field leaves the label's `htmlFor` and the control's `id` to every call
 * site. Here the control gets an id unless it has one, and the label points at it, so a click on
 * the label reaches the control and a screen reader says the label with it, at the forty places
 * the settings have a field, with no id written by hand.
 *
 * - `orientation="horizontal"` is stock's row for a switch: label and hint on the left, the
 *   control on the right.
 * - `wide` spans every column of a form laid out in a grid.
 */
export function LabeledField({ label, hint, children, wide, orientation = "vertical" }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean; orientation?: "vertical" | "horizontal" }) {
	const made = useId();
	const one = isValidElement<{ id?: string }>(children) ? children : undefined;
	const id = one?.props.id ?? made;
	const control = one && !one.props.id ? cloneElement(one, { id }) : children;
	const name = <FieldLabel htmlFor={id}>{label}</FieldLabel>;
	const description = hint ? <FieldDescription>{hint}</FieldDescription> : null;
	return (
		<Field orientation={orientation} className={wide ? "col-span-full" : undefined}>
			{orientation === "horizontal" ? (
				<FieldContent>
					{name}
					{description}
				</FieldContent>
			) : (
				name
			)}
			{control}
			{orientation === "horizontal" ? null : description}
		</Field>
	);
}
