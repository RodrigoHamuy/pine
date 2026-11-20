// Pairing the phone with a computer by its link, as the web client pairs a browser (web/src/pairing.ts
// `askToPair`, web/src/host.ts `pairWith`) and the Pine app's access host takes it
// (desktop/electron/access/pairing.ts): the data channel of Peer.swift, an SSH session as user
// `pair.<code>` with the phone's key, offered only once the computer showed the host key the link's
// machine id stands for, and one command that names the phone. The computer answers the four digits
// it shows the owner, then the owner's answer. Only a yes keeps anything, and that is Pines' to keep.
//
// The surface, the same in the Kotlin core: `Remote.pair(link, name, on)` starts a pairing and
// returns a `Pairing`, whose `cancel()` ends it and whose `result()` is its end. `on` is told
// `pairing(code)` once the computer shows the four digits, then exactly one of `allowed(name)`,
// `refused`, `expired` or `failed(message)`. After `cancel()` nothing more is told.
import Foundation
import NIOCore
import NIOSSH

/** The user name of a pairing session, before its code (desktop/electron/access/pairing.ts `PAIR_USER`). */
let PAIR_USER = "pair."
/** The command of the pairing request: this word, a space, and base64url of `{"name": ...}` (`PAIR_COMMAND`). */
let PAIR_COMMAND = "pine-pair"
/** How long a pairing waits for the owner's answer at most: the computer ends it after two minutes itself. */
let PAIR_WAIT: Duration = .seconds(5 * 60)

/** What a pairing reports, in order: `pairing` once the four digits are known, then one end. */
public enum PairingState: Equatable, Sendable {
	/** The computer shows the owner these four digits beside the phone's name. */
	case pairing(code: String)
	/** The owner allowed the phone; `name` is the computer's, cleaned, or "your computer". */
	case allowed(name: String)
	/** The owner refused the phone. */
	case refused
	/** No answer in time, a code that is wrong or was used, or a session that closed without an answer. */
	case expired
	/** The computer could not be reached to pair with, or another one answered: `message` says what to do. */
	case failed(message: String)
}

/** The words of a pairing that did not go through: the web client's, "this browser" said "this phone". */
enum PairWords {
	static let refused = "Your computer refused this phone: nothing was kept. To pair it after all, open Pine on your computer and add this device again."
	static let expired = "This pairing link has expired or was used already. Open Pine on your computer and add this device again."
	static let impostor = "The computer that answered is not the one this pairing link names: nothing was trusted. Open Pine on your computer and add this device again."
	static let cut = "Could not reach your computer to pair with it. The connection to the computer closed before SSH let this phone in."

	/** While pairing nothing is tried again: the link is for one use and two minutes. */
	static func trouble(_ reason: PeerClosed.Reason) -> String {
		switch reason {
		case .absent: "Your computer does not answer: it is off, asleep, or Pine is closed. Open Pine on your computer and add this device again."
		case .noPath: "Your computer is there, but no direct connection could be made from this network. Try another network (another Wi-Fi, or your phone's data), then add this device again at your computer."
		case .limits: "The meeting service is over its limits for now. Try again later: add this device again at your computer."
		case .noService: "Could not reach your computer to pair with it. The meeting service could not be reached. Check the network, then add this device again at your computer."
		}
	}

	/** What the page is told for an end that is not a yes. */
	static func of(_ end: PairingState) -> String? {
		switch end {
		case .pairing, .allowed: nil
		case .refused: refused
		case .expired: expired
		case let .failed(message): message
		}
	}
}

/** The pairing request for a phone called `name`. */
func pairCommand(_ name: String) -> String {
	let json = try! JSONSerialization.data(withJSONObject: ["name": cleanName(name)], options: [.withoutEscapingSlashes])
	let body = json.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
	return "\(PAIR_COMMAND) \(body)"
}

/** One pairing under way: `cancel()` ends it, `result()` waits for its end (nil when it was cancelled). */
public final class Pairing: @unchecked Sendable {
	private let lock = NSLock()
	private var cancelled = false
	private var link: PeerLink?
	private var session: Channel?
	private var task: Task<PairingState?, Never>?

	/** Ends the pairing: its session and its data channel are closed, and nothing more is told. */
	public func cancel() {
		let (link, session, task) = lock.withLock { () -> (PeerLink?, Channel?, Task<PairingState?, Never>?) in
			cancelled = true
			return (self.link, self.session, self.task)
		}
		session?.close(promise: nil)
		link?.close()
		task?.cancel()
	}

	/** The end it came to; nil when it was cancelled. */
	public func result() async -> PairingState? {
		guard let task = lock.withLock({ task }) else { return nil }
		return await task.value
	}

	var isCancelled: Bool { lock.withLock { cancelled } }

	fileprivate func run(_ task: Task<PairingState?, Never>) { lock.withLock { self.task = task } }

	/** Keeps what `cancel()` closes; false when it was cancelled meanwhile (the caller closes it then). */
	fileprivate func hold(link: PeerLink? = nil, session: Channel? = nil) -> Bool {
		lock.withLock {
			if cancelled { return false }
			if let link { self.link = link }
			if let session { self.session = session }
			return true
		}
	}
}

extension Remote {
	/**
	 * Pairs with the computer `link` names, as the phone called `name` ("Pine on iPhone 17 Pro"):
	 * `on` hears what the pairing reports (see `PairingState`). Nothing is kept here: on `allowed`
	 * the caller keeps the computer (`Pines.addPaired`) and connects to it as a paired phone.
	 */
	public func pair(_ link: PairLink, name: String, on: @escaping @Sendable (PairingState) -> Void) -> Pairing {
		let pairing = Pairing()
		let task = Task.detached { [self] () -> PairingState? in
			let end = await runPairing(link, name: name, pairing) { state in
				// Told under no lock of ours; a pairing cancelled meanwhile tells nothing.
				if !pairing.isCancelled { on(state) }
			}
			if pairing.isCancelled { return nil }
			return end
		}
		pairing.run(task)
		return pairing
	}

	private func runPairing(_ link: PairLink, name: String, _ pairing: Pairing, tell: @Sendable (PairingState) -> Void) async -> PairingState {
		let end = await pairingEnd(link, name: name, pairing, tell: tell)
		tell(end)
		return end
	}

	private func pairingEnd(_ link: PairLink, name: String, _ pairing: Pairing, tell: @Sendable (PairingState) -> Void) async -> PairingState {
		guard let trusted = pairedFingerprint(link.id) else { return .failed(message: PairWords.impostor) }
		let privateKey: NIOSSHPrivateKey
		do {
			privateKey = try key.privateKey()
		} catch {
			return .failed(message: "\(error)")
		}
		// A session that closed before the phone's key was offered never used the code (the computer
		// can let go of a channel that is slow to reach it): one more is tried, as the web client does.
		let first = await attempt(link, name: name, trusted: trusted, privateKey, pairing, tell: tell)
		guard case .unused = first else { return first.state }
		if pairing.isCancelled { return .expired }
		return await attempt(link, name: name, trusted: trusted, privateKey, pairing, tell: tell).state
	}

	private enum Attempt {
		case end(PairingState)
		/** Closed before the code was offered. */
		case unused

		var state: PairingState {
			switch self {
			case let .end(state): state
			case .unused: .failed(message: PairWords.cut)
			}
		}
	}

	/** One data channel and one pairing session over it. */
	private func attempt(_ link: PairLink, name: String, trusted: String, _ privateKey: NIOSSHPrivateKey, _ pairing: Pairing, tell: @Sendable (PairingState) -> Void) async -> Attempt {
		let peer: PeerLink
		do {
			peer = try await openPeer(service: link.service, id: link.id, within: meet, route: route)
		} catch let e as PeerClosed {
			return .end(.failed(message: PairWords.trouble(e.reason)))
		} catch {
			return .end(.failed(message: PairWords.cut))
		}
		guard pairing.hold(link: peer) else {
			peer.close()
			return .end(.expired)
		}
		let signIn = SignIn(user: PAIR_USER + link.code, key: privateKey)
		let hostKey = MachineIdCheck(trusted: trusted, words: PairedWords(label: YOUR_COMPUTER), host: PAIRED + link.id)
		let session: Channel
		do {
			session = try await peer.bridge(group: group) { channel in
				channel.eventLoop.makeCompletedFuture {
					let ssh = NIOSSHHandler(role: .client(.init(userAuthDelegate: signIn, serverAuthDelegate: hostKey)), allocator: channel.allocator, inboundChildChannelInitializer: nil)
					try channel.pipeline.syncOperations.addHandlers(ssh, Quiet())
				}
			}
		} catch {
			return .unused
		}
		// Whatever the end, the pairing session is closed with it: a yes is followed by a session as `pine`.
		defer { session.close(promise: nil) }
		guard pairing.hold(session: session) else { return .end(.expired) }
		let limit = session.eventLoop.scheduleTask(in: connectLimit) { session.close(promise: nil) }
		let exec: Channel
		do {
			exec = try await execChannel(session)
			limit.cancel()
		} catch {
			limit.cancel()
			if hostKey.refused != nil { return .end(.failed(message: PairWords.impostor)) }
			// The computer takes no key under a code that is wrong, used or closed: it says no, or
			// closes the connection once the key was offered.
			if signIn.refused || signIn.offeredKey { return .end(.expired) }
			return .unused
		}
		do {
			let command = try await ChannelDuplex.of(exec, limit: read)
			try await exec.triggerUserOutboundEvent(SSHChannelRequestEvent.ExecRequest(command: pairCommand(name), wantReply: false)).get()
			return .end(await answer(command, pairing, tell: tell))
		} catch {
			return .end(.expired)
		}
	}

	/** The computer's lines: the four digits, then the owner's answer. A channel that ends without one is expired. */
	private func answer(_ command: ChannelDuplex, _ pairing: Pairing, tell: @Sendable (PairingState) -> Void) async -> PairingState {
		let until = ContinuousClock.now + PAIR_WAIT
		var text: [UInt8] = []
		while ContinuousClock.now < until {
			if pairing.isCancelled { return .expired }
			let bytes: [UInt8]?
			do {
				bytes = try await command.read(within: .seconds(1))
			} catch is ReadTimeout {
				continue
			} catch {
				bytes = nil
			}
			guard let bytes else { return .expired }
			text += bytes
			while let nl = text.firstIndex(of: 10) {
				let line = Data(text[..<nl])
				text.removeFirst(nl + 1)
				guard let said = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] else { continue }
				if let code = said["code"] as? String, wholeMatch("[0-9]{4}", code) != nil {
					tell(.pairing(code: code))
				} else if let ok = said["ok"] as? Bool {
					if !ok { return said["reason"] as? String == "refused" ? .refused : .expired }
					let named = cleanName(said["name"] as? String ?? "")
					return .allowed(name: named.isEmpty ? YOUR_COMPUTER : named)
				}
			}
			if text.count > 64 * 1024 { return .expired }
		}
		return .expired
	}
}
