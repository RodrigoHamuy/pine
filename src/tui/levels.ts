/**
 * The levels of a sound, worked out before it plays: for each tenth of a second, how much there is
 * in each of a row of frequency bands. The sound line draws them as bars (see Sound in picture.ts).
 * pine does not hear what the system's player plays, so this is read from the file and shown by
 * the line's own clock.
 *
 * The Pine app's page measures with this file too (desktop/src/components/sound.tsx: `Meter` and
 * `heights`, on samples its browser decoded), so that a sound has the same bars in both. A page
 * has no Node: nothing here imports a module of Node's, and `Buffer` is named only inside the
 * functions that read a file.
 */

/** How many bars. */
export const BANDS = 24;
/** Seconds one row of levels stands for: the pace the line is redrawn at. */
export const STEP = 0.1;

export interface Levels {
	bands: number;
	/** Seconds per row. */
	step: number;
	rows: number;
	/** rows * bands values, 0 (nothing) to 255 (the loudest the sound gets), a row after the other. */
	data: Uint8Array;
}

/** What separates the loudest bar from an empty one, in decibels. */
const RANGE = 42;
/** Below this (against a full tone) a sound is taken for silence, whatever is loudest in it. */
const SILENCE = -72;
/** A bar falls by at most this much from one row to the next, so that it does not flicker. */
const FALL = 56;

/** The frequencies at which one band ends and the next begins: evenly spaced for the ear, from 80 Hz to 8 kHz or as far as the file goes. */
export function bandEdges(rate: number): number[] {
	const low = 80;
	const high = Math.min(8000, rate / 2);
	return Array.from({ length: BANDS + 1 }, (_, i) => low * (high / low) ** (i / BANDS));
}

/** Takes samples as they come and keeps a row of levels for every tenth of a second. */
export class Meter {
	private rate: number;
	/** Samples looked at per row: the largest power of two that fits into a tenth of a second. */
	private size: number;
	private window: Float32Array;
	private cos: Float32Array;
	private sin: Float32Array;
	private swap: Uint32Array;
	private re: Float32Array;
	private im: Float32Array;
	/** Where each band begins, counted in the transform's steps of frequency. */
	private edges: number[];
	private held: Float32Array;
	private at = 0;
	private row = 0;
	private until: number;
	/** Decibels, a row after the other. */
	private found = new Float32Array(BANDS * 256);

	constructor(rate: number) {
		this.rate = rate;
		let size = 64;
		while (size * 2 <= rate * STEP) size *= 2;
		this.size = size;
		this.window = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
		this.cos = Float32Array.from({ length: size / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / size));
		this.sin = Float32Array.from({ length: size / 2 }, (_, i) => Math.sin((2 * Math.PI * i) / size));
		const bits = Math.log2(size);
		this.swap = Uint32Array.from({ length: size }, (_, i) => {
			let r = 0;
			for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
			return r;
		});
		this.re = new Float32Array(size);
		this.im = new Float32Array(size);
		// Step k of the transform stands for the frequencies around k * rate / size: from k to k + 1 on this scale.
		this.edges = bandEdges(rate).map((hz) => (hz * size) / rate + 0.5);
		this.held = new Float32Array(size);
		this.until = this.length(0);
	}

	/** Samples in row `i`. A rate that a tenth of a second does not divide gets rows of two lengths, and stays in time. */
	private length(i: number): number {
		return Math.round((i + 1) * this.rate * STEP) - Math.round(i * this.rate * STEP);
	}

	/** One sample, between -1 and 1. */
	add(sample: number): void {
		if (this.at < this.size) this.held[this.at] = sample;
		if (++this.at >= this.until) this.measure();
	}

	/** The row that is full: its beginning through the transform, the result summed up by band. */
	private measure(): void {
		const { size, re, im, cos, sin } = this;
		this.held.fill(0, Math.min(this.at, size));
		for (let i = 0; i < size; i++) {
			re[this.swap[i]] = this.held[i] * this.window[i];
			im[i] = 0;
		}
		for (let half = 1; half < size; half *= 2) {
			const stride = size / (half * 2);
			for (let start = 0; start < size; start += half * 2) {
				for (let k = 0; k < half; k++) {
					const a = start + k;
					const b = a + half;
					const wr = cos[k * stride];
					const wi = -sin[k * stride];
					const tr = re[b] * wr - im[b] * wi;
					const ti = re[b] * wi + im[b] * wr;
					re[b] = re[a] - tr;
					im[b] = im[a] - ti;
					re[a] += tr;
					im[a] += ti;
				}
			}
		}
		if ((this.row + 1) * BANDS > this.found.length) {
			const more = new Float32Array(this.found.length * 2);
			more.set(this.found);
			this.found = more;
		}
		// A tone as loud as the file can hold comes out as 1, which is 0 decibels.
		const full = 1.5 * (size / 4) ** 2;
		for (let band = 0; band < BANDS; band++) {
			const from = this.edges[band];
			const to = Math.min(this.edges[band + 1], size / 2);
			let power = 0;
			// A step that lies across the border of two bands counts for each by the part that is in it.
			for (let k = Math.floor(from); k < to; k++) power += (re[k] * re[k] + im[k] * im[k]) * (Math.min(k + 1, to) - Math.max(k, from));
			this.found[this.row * BANDS + band] = 10 * Math.log10(power / full);
		}
		this.row++;
		this.at = 0;
		this.until = this.length(this.row);
	}

	/** The levels of everything that was added. Undefined: there was nothing. */
	done(): Levels | undefined {
		if (this.at > 0) this.measure();
		const rows = this.row;
		if (!rows) return undefined;
		const found = this.found.subarray(0, rows * BANDS);
		let loudest = -Infinity;
		for (const db of found) if (db > loudest) loudest = db;
		const data = new Uint8Array(rows * BANDS);
		// The bars are measured against the loudest moment of this sound: a quiet recording moves as much as a loud one.
		if (loudest >= SILENCE) {
			for (let i = 0; i < data.length; i++) {
				const level = found[i] < SILENCE ? 0 : Math.round(Math.max(0, Math.min(1, (found[i] - loudest) / RANGE + 1)) * 255);
				data[i] = Math.max(level, i >= BANDS ? data[i - BANDS] - FALL : 0);
			}
		}
		return { bands: BANDS, step: STEP, rows, data };
	}
}

/** Uncompressed samples as they lie in a file or come out of a decoder. */
export interface Pcm {
	rate: number;
	channels: number;
	bits: number;
	float: boolean;
}

/** Reads one sample at a place in a buffer, as a number between -1 and 1. Undefined: a kind that is not read here. */
function reader(pcm: Pcm): ((b: Buffer, at: number) => number) | undefined {
	if (pcm.float) return pcm.bits === 32 ? (b, at) => b.readFloatLE(at) : pcm.bits === 64 ? (b, at) => b.readDoubleLE(at) : undefined;
	if (pcm.bits === 8) return (b, at) => (b[at] - 128) / 128;
	if (pcm.bits === 16) return (b, at) => b.readInt16LE(at) / 32768;
	if (pcm.bits === 24) return (b, at) => b.readIntLE(at, 3) / 8388608;
	if (pcm.bits === 32) return (b, at) => b.readInt32LE(at) / 2147483648;
	return undefined;
}

/**
 * What a wav file says about itself before its samples. `need`: more bytes have to be read first
 * to tell. Undefined: not a wav file, or one whose samples are compressed.
 */
function wavHead(b: Buffer): { pcm: Pcm; from: number; bytes: number } | { need: true } | undefined {
	if (b.length < 12) return { need: true };
	if (b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") return undefined;
	let pcm: Pcm | undefined;
	for (let at = 12; ; ) {
		if (at + 8 > b.length) return { need: true };
		const id = b.toString("latin1", at, at + 4);
		const size = b.readUInt32LE(at + 4);
		if (id === "data") {
			// A file that was written as a stream says 0 or the largest number here: then it runs to the end.
			return pcm ? { pcm, from: at + 8, bytes: size && size < 0xffff_fff0 ? size : Infinity } : undefined;
		}
		if (id === "fmt ") {
			if (at + 8 + size > b.length) return { need: true };
			if (size < 16) return undefined;
			let tag = b.readUInt16LE(at + 8);
			// "Extensible": the kind of sample is said further on, in the first two bytes of a longer name.
			if (tag === 0xfffe && size >= 26) tag = b.readUInt16LE(at + 32);
			if (tag !== 1 && tag !== 3) return undefined;
			pcm = { rate: b.readUInt32LE(at + 12), channels: b.readUInt16LE(at + 10), bits: b.readUInt16LE(at + 22), float: tag === 3 };
		}
		at += 8 + size + (size % 2);
	}
}

/**
 * The levels of a sound that arrives in pieces. With `pcm` the pieces are bare samples (what a
 * decoder was asked to write); without it they are a wav file, which says what it holds.
 * Undefined: nothing here that can be read as samples.
 */
export async function levelsOf(pieces: AsyncIterable<Buffer>, pcm?: Pcm): Promise<Levels | undefined> {
	let head: Buffer | undefined = pcm ? undefined : Buffer.alloc(0);
	let left = Infinity;
	let meter: Meter | undefined;
	let read: ((b: Buffer, at: number) => number) | undefined;
	let frame = 0;
	let rest: Buffer = Buffer.alloc(0);
	const begin = (p: Pcm): boolean => {
		read = reader(p);
		if (!read || p.channels < 1 || p.channels > 64 || p.rate < 2000 || p.rate > 400_000) return false;
		pcm = p;
		frame = (p.bits / 8) * p.channels;
		meter = new Meter(p.rate);
		return true;
	};
	if (pcm && !begin(pcm)) return undefined;
	for await (let piece of pieces) {
		if (head) {
			head = Buffer.concat([head, piece]);
			const found = wavHead(head);
			if (!found) return undefined;
			if ("need" in found) {
				// Whatever comes before the samples (a title, a cover) is skipped; a megabyte of it is no sound file.
				if (head.length > 1024 * 1024) return undefined;
				continue;
			}
			if (!begin(found.pcm)) return undefined;
			piece = head.subarray(found.from);
			left = found.bytes;
			head = undefined;
		}
		if (piece.length > left) piece = piece.subarray(0, left);
		left -= piece.length;
		// A piece can end in the middle of a sample: that part waits for the next piece.
		const all = rest.length ? Buffer.concat([rest, piece]) : piece;
		const whole = all.length - (all.length % frame);
		const width = pcm!.bits / 8;
		for (let at = 0; at < whole; at += frame) {
			let sum = 0;
			for (let ch = 0; ch < pcm!.channels; ch++) sum += read!(all, at + ch * width);
			meter!.add(sum / pcm!.channels);
		}
		rest = all.subarray(whole);
		if (left <= 0) break;
	}
	return meter?.done();
}

const BLOCKS = "▁▂▃▄▅▆▇█";

/**
 * How high each bar stands at a moment of the sound, 0 to 255, lowest band first. Before the start
 * and after the end they lie flat. With room for fewer bars than there are bands, neighbouring
 * bands share a bar, which stands as high as the highest of them. The Pine app draws its bars
 * from this too, so that a sound looks the same in both.
 */
export function heights(levels: Levels, seconds: number, count = levels.bands): number[] {
	// A little more than the division gives: 0.3 seconds is the fourth row, though 0.3 / 0.1 comes out just under 3.
	const row = Math.floor(seconds / levels.step + 1e-6);
	const there = row >= 0 && row < levels.rows;
	const out: number[] = [];
	for (let bar = 0; bar < count; bar++) {
		const from = Math.floor((bar * levels.bands) / count);
		const to = Math.max(from + 1, Math.floor(((bar + 1) * levels.bands) / count));
		let level = 0;
		for (let band = from; there && band < to; band++) level = Math.max(level, levels.data[row * levels.bands + band]);
		out.push(level);
	}
	return out;
}

/** The bars at a moment of the sound as a row of blocks, for a terminal. */
export function bars(levels: Levels, seconds: number, count = levels.bands): string {
	return heights(levels, seconds, count).map((level) => BLOCKS[Math.round((level / 255) * 7)]).join("");
}
