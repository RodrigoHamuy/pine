import { cloneElement, isValidElement, type ReactNode, useId } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";

/**
 * A labelled field: shadcn's Field with its label and hint. The label names the control it holds
 * (it points at the control's id, given to it here unless it has one), so a click on the label
 * reaches the control and a screen reader says the label with it.
 */
export function LabeledField({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
	const made = useId();
	const one = isValidElement<{ id?: string }>(children) ? children : undefined;
	const id = one?.props.id ?? made;
	return (
		<Field className={wide ? "col-span-full" : undefined}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			{one && !one.props.id ? cloneElement(one, { id }) : children}
			{hint ? <FieldDescription>{hint}</FieldDescription> : null}
		</Field>
	);
}
