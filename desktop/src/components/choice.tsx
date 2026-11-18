import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * One value out of a list, on stock Select. "" is a value like any other.
 *
 * Why this exists: stock Select is written out as six parts, and its `items` (what the trigger
 * shows for a value) repeat the options. Here a list of options is enough, at the dozen places the
 * settings choose from one. `className` goes to the trigger, which is as wide as stock makes it
 * (inside a stock Field, the field's width).
 */
export function Choice({ value, options, onChange, id, disabled, className }: { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void; id?: string; disabled?: boolean; className?: string }) {
	return (
		<Select items={options} value={value} onValueChange={(v) => onChange(v ?? "")} disabled={disabled}>
			<SelectTrigger id={id} className={className}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					{options.map((o) => (
						<SelectItem key={o.value} value={o.value}>
							{o.label}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}
