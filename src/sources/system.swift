// pine's helper for the "system" event source: it says what this Mac does (sleep and wake, the
// screen lock, power, the network, disks, apps), one JSON object per line on standard output.
// It decides nothing: which of these become events, and for whom, is system.ts's business.
// Its arguments name what to listen for; it ends when its input is closed.
//
// Built by pine with swiftc on first use (src/sources/system.ts), like the other helpers.
import AppKit
import Foundation
import IOKit.ps
import Network

func say(_ event: String, _ fields: [String: Any] = [:]) {
	var object = fields
	object["event"] = event
	guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), let line = String(data: data, encoding: .utf8) else { return }
	print(line)
	fflush(stdout)
}

/// Where the power comes from and how full the battery is. A Mac without a battery says only "ac".
func power() -> [String: Any] {
	let info = IOPSCopyPowerSourcesInfo().takeRetainedValue()
	let providing = IOPSGetProvidingPowerSourceType(info).takeUnretainedValue() as String
	var out: [String: Any] = ["on": providing == kIOPMACPowerKey ? "ac" : (providing == kIOPMBatteryPowerKey ? "battery" : "ups")]
	for source in IOPSCopyPowerSourcesList(info).takeRetainedValue() as [CFTypeRef] {
		guard let about = IOPSGetPowerSourceDescription(info, source)?.takeUnretainedValue() as? [String: Any] else { continue }
		guard let now = about[kIOPSCurrentCapacityKey] as? Int, let full = about[kIOPSMaxCapacityKey] as? Int, full > 0 else { continue }
		out["percent"] = now * 100 / full
		if let charging = about[kIOPSIsChargingKey] as? Bool { out["charging"] = charging }
		break
	}
	return out
}

let wanted = Set(CommandLine.arguments.dropFirst())
func on(_ kind: String) -> Bool { wanted.isEmpty || wanted.contains(kind) }

let workspace = NSWorkspace.shared.notificationCenter
let main = OperationQueue.main
var kept: [Any] = []

if on("sleep") {
	kept.append(workspace.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: main) { _ in say("sleeping") })
	kept.append(workspace.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: main) { _ in say("woke") })
	kept.append(workspace.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: main) { _ in say("display-off") })
	kept.append(workspace.addObserver(forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: main) { _ in say("display-on") })
}

if on("lock") {
	let all = DistributedNotificationCenter.default()
	kept.append(all.addObserver(forName: Notification.Name("com.apple.screenIsLocked"), object: nil, queue: main) { _ in say("locked") })
	kept.append(all.addObserver(forName: Notification.Name("com.apple.screenIsUnlocked"), object: nil, queue: main) { _ in say("unlocked") })
}

if on("volumes") {
	func volume(_ note: Notification) -> [String: Any] {
		var out: [String: Any] = [:]
		if let name = note.userInfo?[NSWorkspace.localizedVolumeNameUserInfoKey] as? String { out["name"] = name }
		if let url = note.userInfo?[NSWorkspace.volumeURLUserInfoKey] as? URL { out["path"] = url.path }
		return out
	}
	kept.append(workspace.addObserver(forName: NSWorkspace.didMountNotification, object: nil, queue: main) { note in say("mounted", volume(note)) })
	kept.append(workspace.addObserver(forName: NSWorkspace.didUnmountNotification, object: nil, queue: main) { note in say("unmounted", volume(note)) })
}

if on("apps") {
	func app(_ note: Notification) -> [String: Any] {
		guard let running = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return [:] }
		var out: [String: Any] = [:]
		if let name = running.localizedName { out["app"] = name }
		if let bundle = running.bundleIdentifier { out["bundle"] = bundle }
		return out
	}
	kept.append(workspace.addObserver(forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: main) { note in say("app-started", app(note)) })
	kept.append(workspace.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: main) { note in say("app-quit", app(note)) })
}

if on("power") {
	// Said once at the start, so that whoever listens knows what a later line differs from.
	say("power", power())
	let source = IOPSNotificationCreateRunLoopSource({ _ in say("power", power()) }, nil).takeRetainedValue()
	CFRunLoopAddSource(CFRunLoopGetMain(), source, .defaultMode)
}

let monitor = NWPathMonitor()
if on("network") {
	// Called once right away with how things are, then at every change.
	monitor.pathUpdateHandler = { path in
		let via = path.usesInterfaceType(.wifi) ? "wifi" : path.usesInterfaceType(.wiredEthernet) ? "ethernet" : path.usesInterfaceType(.cellular) ? "cellular" : "other"
		say("network", path.status == .satisfied ? ["online": true, "via": via] : ["online": false])
	}
	monitor.start(queue: DispatchQueue.main)
}

// pine closes the input when the source stops, and when pine itself is gone the input is closed too.
Thread.detachNewThread {
	while FileHandle.standardInput.availableData.count > 0 {}
	exit(0)
}

say("ready")
RunLoop.main.run()
