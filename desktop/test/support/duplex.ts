import { Duplex } from "node:stream";

/**
 * Two ends of an in-memory stream whose bytes arrive on a later turn of the event loop, as a
 * socket's or a data channel's do. (Node's `duplexPair` hands them over inside the write, and
 * ssh2 is not written for an answer that arrives while it is still sending.)
 */
export function duplexPair(): [Duplex, Duplex] {
	const make = (): Duplex =>
		new Duplex({
			read() {},
			write(chunk, _encoding, done) {
				const to = peer.get(this)!;
				setImmediate(() => {
					if (!to.destroyed) to.push(chunk);
					done();
				});
			},
			final(done) {
				const to = peer.get(this)!;
				setImmediate(() => {
					to.push(null);
					done();
				});
			},
			destroy(err, done) {
				const to = peer.get(this)!;
				setImmediate(() => to.destroy());
				done(err);
			},
		});
	const peer = new Map<Duplex, Duplex>();
	const a = make();
	const b = make();
	peer.set(a, b).set(b, a);
	return [a, b];
}
