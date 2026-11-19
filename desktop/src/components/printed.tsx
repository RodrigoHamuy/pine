import { type UIEvent, useLayoutEffect, useRef } from "react";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockLine } from "@/components/ui/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";

/**
 * What a tool or a program printed: a stock Code Block, as shadcn's Terminal pattern shows a
 * command's output, with the terminal's colors read by the stock highlighter ("ansi"). The panel
 * is already the viewer, so there is no Trace line around it. `sm` caps it where several follow
 * each other (the pattern's `max-h-64`).
 */
export function Printed({ text, failed = false, sm = false, className }: { text: string; failed?: boolean; sm?: boolean; className?: string }) {
	const lines = useHighlightedCode(text, "ansi");
	// A program that is still running keeps printing: like a terminal, the block follows its end
	// while it is scrolled to the end, and holds still once the owner scrolled up to read.
	const pre = useRef<HTMLPreElement>(null);
	const atEnd = useRef(true);
	useLayoutEffect(() => {
		const el = pre.current;
		if (el && atEnd.current) el.scrollTop = el.scrollHeight;
	}, [lines]);
	const onScroll = (e: UIEvent<HTMLPreElement>) => {
		const el = e.currentTarget;
		atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
	};
	return (
		<CodeBlock variant={failed ? "destructive" : "default"} size={sm ? "sm" : "default"} className={className} data-status={failed ? "fail" : "ok"}>
			<CodeBlockActions>
				<CodeBlockCopyButton value={text} />
			</CodeBlockActions>
			<CodeBlockContent ref={pre} onScroll={onScroll} wrap className={sm ? "max-h-64" : undefined}>
				{lines.map((line, i) => <CodeBlockLine key={i}>{line}</CodeBlockLine>)}
			</CodeBlockContent>
		</CodeBlock>
	);
}
