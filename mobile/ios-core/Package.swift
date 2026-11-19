// swift-tools-version: 6.0
// The iOS app's native core: what the Kotlin core in ../core does for Android, on Apple's own SSH,
// NIO and crypto packages. No UIKit and no Capacitor: `swift test` runs it on the Mac.
import PackageDescription

let package = Package(
	name: "PineCore",
	platforms: [.iOS(.v17), .macOS(.v14)],
	products: [
		.library(name: "PineCore", targets: ["PineCore"]),
	],
	dependencies: [
		.package(url: "https://github.com/apple/swift-nio-ssh.git", exact: "0.15.1"),
		.package(url: "https://github.com/apple/swift-nio.git", exact: "2.105.0"),
		.package(url: "https://github.com/apple/swift-crypto.git", exact: "5.1.2"),
		// NIO's own dependency, held back: 1.7 assumes a borrowing-iterator API of the Swift 6.4
		// standard library that Xcode 27's 6.4 does not have, and fails to compile there.
		.package(url: "https://github.com/apple/swift-collections.git", exact: "1.6.0"),
	],
	targets: [
		.target(
			name: "PineCore",
			dependencies: [
				.product(name: "NIOSSH", package: "swift-nio-ssh"),
				.product(name: "NIOCore", package: "swift-nio"),
				.product(name: "Crypto", package: "swift-crypto"),
			],
			// remote-command.txt is a link to ../cases/remote-command.txt, the one file both cores
			// read: SwiftPM copies what it points at into the bundle when it builds.
			resources: [.copy("Resources/remote-command.txt")]
		),
		.testTarget(name: "PineCoreTests", dependencies: ["PineCore"]),
	]
)
