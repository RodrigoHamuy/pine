// The daemon's live events: `followEvents` of desktop/electron/daemon.ts, as Events.kt on Android.
// The stream is read through a channel of the SSH session held for it, and handed on in small
// batches: a model that writes fast sends a hundred events a second, and each as a message of its
// own would keep the page busy.
import Foundation

/** What the reader of the event stream tells its caller. Called from a task of the core, never from the main thread. */
public protocol EventHandlers: AnyObject, Sendable {
	/** A few events at a time, each a JSON value as `JSONSerialization` gives it. */
	func batch(_ events: [Any])
	/** The stream was opened (true) or was lost (false). */
	func connection(_ up: Bool)
	/** After each loss, with how many in a row: true stops the reading (the caller does something else about it). */
	func lost(_ times: Int) -> Bool
}

extension EventHandlers {
	public func lost(_ times: Int) -> Bool { false }
}

/** A reading of the event stream, until it is stopped. */
public final class Following: @unchecked Sendable {
	private let lock = NSLock()
	private var stopped = false
	private var conn: Duplex?
	private var batch: [Any] = []
	private var timed = false
	private var task: Task<Void, Never>?

	/** Ends the reading: nothing more is handed on. */
	public func stop() {
		let (c, t) = lock.withLock {
			stopped = true
			return (conn, task)
		}
		c?.close()
		t?.cancel()
	}

	var isStopped: Bool { lock.withLock { stopped } }

	fileprivate func start(_ daemon: Daemon, _ on: EventHandlers, retry: Duration, batch every: Duration) {
		let t = Task.detached { [self] in
			// Losses in a row: an opened stream starts the count again.
			var down = 0
			while true {
				do {
					let c = try await daemon.open()
					let go = lock.withLock {
						if !stopped { conn = c }
						return !stopped
					}
					if !go {
						c.close()
						return
					}
					defer { c.close() }
					try await send(daemon, c, method: "GET", url: "/events/stream?topic=%23")
					try await read(Reader(c), on, every) { down = 0 }
				} catch {
					// on to the retry
				}
				if isStopped { return }
				on.connection(false)
				down += 1
				if on.lost(down) { return }
				try? await Task.sleep(for: retry)
			}
		}
		lock.withLock { task = t }
	}

	private func read(_ reader: Reader, _ on: EventHandlers, _ every: Duration, opened: () -> Void) async throws {
		let head = try await readHead(reader)
		if !(200...299).contains(head.status) { throw HTTPTrouble("HTTP \(head.status)") }
		let body = Body(head, reader)
		if isStopped { return }
		opened()
		on.connection(true)
		var pending: [UInt8] = []
		while let bytes = try await body.next() {
			pending.append(contentsOf: bytes)
			// Each block up to an empty line is a frame.
			while let end = frameEnd(pending) {
				let block = String(decoding: pending[..<end], as: UTF8.self)
				pending.removeFirst(end + 2)
				guard block.hasPrefix("data: "), let value = try? JSONSerialization.jsonObject(with: Data(block.dropFirst(6).utf8), options: [.fragmentsAllowed]) else {
					// A comment, or a malformed frame: skipped, the stream goes on.
					continue
				}
				add(value, on, every)
			}
		}
	}

	private func add(_ event: Any, _ on: EventHandlers, _ every: Duration) {
		let schedule = lock.withLock {
			if stopped { return false }
			batch.append(event)
			defer { timed = true }
			return !timed
		}
		guard schedule else { return }
		Task.detached { [self] in
			try? await Task.sleep(for: every)
			let events = lock.withLock {
				defer {
					batch = []
					timed = false
				}
				return stopped ? [] : batch
			}
			if !events.isEmpty { on.batch(events) }
		}
	}
}

/** Where the first frame of `bytes` ends: the index of the "\n\n" after it. */
private func frameEnd(_ bytes: [UInt8]) -> Int? {
	guard bytes.count >= 2 else { return nil }
	for i in 0..<(bytes.count - 1) where bytes[i] == 10 && bytes[i + 1] == 10 { return i }
	return nil
}

/**
 * The daemon's live events (`GET /events/stream?topic=%23`), read until stopped and handed on in
 * batches of what came within `batch`. A lost stream is opened again `retry` later.
 */
@discardableResult
public func followEvents(_ daemon: Daemon, _ on: EventHandlers, retry: Duration = .seconds(1), batch: Duration = .milliseconds(24)) -> Following {
	let following = Following()
	following.start(daemon, on, retry: retry, batch: batch)
	return following
}
