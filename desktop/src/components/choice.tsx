import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** One value out of a list, on shadcn's Select (what was a native select). "" is a value like any other.
 * `className` sizes the trigger: as wide as its place unless told otherwise. */
export function Choice({ value, options, onChange, id, disabled, className = "w-full" }: { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void; id?: string; disabled?: boolean; className?: string }) {
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
