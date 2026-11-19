// The bytes of one SSH channel, for code that is not NIO's: what Kotlin reads from sshj's streams.
// A `PipeHandler` sits at the end of a child channel of the SSH session (the exec channel of
// `pine service`, or a `direct-tcpip` channel to the daemon) and keeps what arrives until it is
// asked for; `ChannelDuplex` asks for it from Swift concurrency, a read at a time, each bounded.
import Foundation
import NIOCore
import NIOSSH

/** Both ends of a connection to the daemon's port. */
public protocol Duplex: AnyObject, Sendable {
	/** Sends bytes. */
	func write(_ bytes: [UInt8]) async throws
	/** The next bytes that arrived, nil at the end. Throws when none come within the read time limit. */
	func read() async throws -> [UInt8]?
	/** Closes the connection; a read waiting then ends. */
	func close()
}

/** No byte came within the read time limit. */
struct ReadTimeout: Error, CustomStringConvertible {
	var description: String { "no answer in time" }
}

/** What a channel carries, kept until it is read. Lives on the channel's event loop. */
final class PipeHandler: ChannelDuplexHandler {
	typealias InboundIn = SSHChannelData
	typealias OutboundIn = ByteBuffer
	typealias OutboundOut = SSHChannelData

	private var chunks: [[UInt8]] = []
	private var ended = false
	private var failure: Error?
	private var waiter: EventLoopPromise<[UInt8]?>?
	private var timer: Scheduled<Void>?
	/** What the command wrote on stderr, its last 4000 bytes. */
	private(set) var stderr: [UInt8] = []
	/** The command's exit code, once it said it. */
	private(set) var exit: Int?

	private var loop: EventLoop?

	func handlerAdded(context: ChannelHandlerContext) {
		loop = context.eventLoop
		// The other end's EOF is noted, and the channel stays open for what this end still sends.
		context.channel.setOption(ChannelOptions.allowRemoteHalfClosure, value: true).whenFailure { _ in }
	}

	func channelRead(context: ChannelHandlerContext, data: NIOAny) {
		let data = unwrapInboundIn(data)
		guard case .byteBuffer(let buffer) = data.data else { return }
		let bytes = Array(buffer.readableBytesView)
		switch data.type {
		case .channel:
			chunks.append(bytes)
			wake()
		case .stdErr:
			stderr.append(contentsOf: bytes)
			if stderr.count > 4000 { stderr.removeFirst(stderr.count - 4000) }
		default:
			break
		}
	}

	func userInboundEventTriggered(context: ChannelHandlerContext, event: Any) {
		switch event {
		case let status as SSHChannelRequestEvent.ExitStatus:
			exit = status.exitStatus
		case ChannelEvent.inputClosed:
			ended = true
			wake()
		default:
			context.fireUserInboundEventTriggered(event)
		}
	}

	func channelInactive(context: ChannelHandlerContext) {
		ended = true
		wake()
		context.fireChannelInactive()
	}

	func errorCaught(context: ChannelHandlerContext, error: Error) {
		if failure == nil { failure = error }
		wake()
		context.close(promise: nil)
	}

	func write(context: ChannelHandlerContext, data: NIOAny, promise: EventLoopPromise<Void>?) {
		let buffer = unwrapOutboundIn(data)
		context.write(wrapOutboundOut(SSHChannelData(type: .channel, data: .byteBuffer(buffer))), promise: promise)
	}

	/** The next bytes, nil at the end; a `ReadTimeout` when none come within `limit`. */
	func next(on loop: EventLoop, limit: TimeAmount) -> EventLoopFuture<[UInt8]?> {
		if let ready = take() { return ready }
		let promise = loop.makePromise(of: [UInt8]?.self)
		waiter = promise
		timer = loop.scheduleTask(in: limit) { [weak self] in
			guard let self, let w = self.waiter else { return }
			self.waiter = nil
			w.fail(ReadTimeout())
		}
		return promise.futureResult
	}

	private func take() -> EventLoopFuture<[UInt8]?>? {
		guard let loop else { return nil }
		if !chunks.isEmpty {
			let joined = chunks.count == 1 ? chunks[0] : Array(chunks.joined())
			chunks.removeAll()
			return loop.makeSucceededFuture(joined)
		}
		if let failure { return loop.makeFailedFuture(failure) }
		if ended { return loop.makeSucceededFuture(nil) }
		return nil
	}

	private func wake() {
		guard let w = waiter, let ready = take() else { return }
		waiter = nil
		timer?.cancel()
		timer = nil
		w.completeWith(ready)
	}
}

/** A child channel of the SSH session, read and written from Swift concurrency. */
final class ChannelDuplex: Duplex, @unchecked Sendable {
	let channel: Channel
	private let handler: NIOLoopBound<PipeHandler>
	private let limit: TimeAmount

	private init(channel: Channel, handler: NIOLoopBound<PipeHandler>, limit: TimeAmount) {
		self.channel = channel
		self.handler = handler
		self.limit = limit
	}

	/** The channel made by `initializer` (which adds a `PipeHandler`), once it is open. */
	static func of(_ channel: Channel, limit: TimeAmount) async throws -> ChannelDuplex {
		let handler = try await channel.eventLoop.submit {
			NIOLoopBound(try channel.pipeline.syncOperations.handler(type: PipeHandler.self), eventLoop: channel.eventLoop)
		}.get()
		return ChannelDuplex(channel: channel, handler: handler, limit: limit)
	}

	/** What a child channel needs at its end: a `PipeHandler`. */
	static func initialize(_ channel: Channel) -> EventLoopFuture<Void> {
		channel.eventLoop.makeCompletedFuture {
			try channel.pipeline.syncOperations.addHandler(PipeHandler())
		}
	}

	func write(_ bytes: [UInt8]) async throws {
		try await channel.writeAndFlush(ByteBuffer(bytes: bytes)).get()
	}

	func read() async throws -> [UInt8]? {
		try await read(within: limit)
	}

	func read(within limit: TimeAmount) async throws -> [UInt8]? {
		let handler = self.handler
		let loop = channel.eventLoop
		return try await loop.flatSubmit { handler.value.next(on: loop, limit: limit) }.get()
	}

	/** What the command wrote on stderr, and its exit code if it said one. */
	func ended() async -> (stderr: String, exit: Int?) {
		let handler = self.handler
		let result = try? await channel.eventLoop.submit { (String(decoding: handler.value.stderr, as: UTF8.self), handler.value.exit) }.get()
		return result ?? ("", nil)
	}

	/** Sends EOF: the other end reads its stdin to the end. */
	func closeOutput() async {
		try? await channel.close(mode: .output).get()
	}

	func close() {
		channel.close(promise: nil)
	}
}

/** Waits for `future` at most `limit`; false when it did not complete in time. */
func settled(_ future: EventLoopFuture<Void>, within limit: TimeAmount) async -> Bool {
	let loop = future.eventLoop
	let promise = loop.makePromise(of: Bool.self)
	// Whichever comes first answers: NIO ignores a second completion of a promise.
	let timer = loop.scheduleTask(in: limit) { promise.succeed(false) }
	future.whenComplete { _ in
		timer.cancel()
		promise.succeed(true)
	}
	return (try? await promise.futureResult.get()) ?? false
}
