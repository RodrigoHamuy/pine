import { SelectContent, SelectItem, SelectItemIndicator, SelectTrigger, Select as UiSelect, SelectValue } from "@ui-sdk/react/select";
import { Icon } from "./Icon.tsx";

/** One value from a list, chosen in a popup list that opens, moves and chooses from the keyboard too. */
export function Select({ value, options, onChange, placeholder, className }: { value: string; options: Array<string | { value: string; label: string }>; onChange: (v: string) => void; placeholder?: string; className?: string }) {
	const items = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
	return (
		<UiSelect items={items} value={items.some((o) => o.value === value) ? value : null} onValueChange={(next) => typeof next === "string" && onChange(next)} placeholder={placeholder}>
			<SelectTrigger className={`input select${className ? ` ${className}` : ""}`}>
				<SelectValue className="select-value" />
				<Icon name="down" size={12} />
			</SelectTrigger>
			{/* The list is rendered in place, so inside a Field's <label>: a click on it must not also press the trigger, which would open it again. */}
			<SelectContent className="select-list" sideOffset={4} onClick={(e) => e.preventDefault()}>
				{items.map((o) => (
					<SelectItem key={o.value} value={o.value} className="select-item">
						{o.label}
						<SelectItemIndicator className="select-check">
							<Icon name="check" size={13} />
						</SelectItemIndicator>
					</SelectItem>
				))}
			</SelectContent>
		</UiSelect>
	);
}
