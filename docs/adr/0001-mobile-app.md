# 0001: The Pine app on phones

Status: accepted

## Context

An owner's pine runs on a computer: a Mac with the Pine app, a Linux server, a VPS. Away from it,
the only way to reach it from a phone today is Telegram. Telegram gives a conversation and approval
buttons, but none of the Pine app's page: the agents, the conversations as tabs, the code pane,
settings, the browser panel, questions with free text, secrets typed into a request.

The owner wants the Pine app on the phone, as it is on the Mac, for any pine reachable over SSH.

The desktop app already reaches the pine of another machine over SSH (Settings > Environments,
`src/remote.ts`): it runs `pine service` there and talks to that daemon's control API on its
loopback through the SSH connection. Its page holds no token and has no Node (rule 10 in
`AGENTS.md`): Electron's main process holds the token and makes every call.

## Decision

**The goal.** As on the Mac: the phone is a client now, and may run a daemon of its own later.

**No daemon on iOS.** The App Store does not let an app keep a server running in the background:
background services only for their intended purposes (guideline 2.5.4), no unrelated background
processes that drain the battery (2.4.2). Node on iOS (nodejs-mobile)
is stuck on Node 18, which has no `node:sqlite`, and pine's store needs it.

**A daemon on Android later, through Termux.** Whether pine runs in Termux itself (native) or in a
Linux distribution inside it (proot-distro) is still open, and is settled when that step starts.

**One page, two shells.** The desktop stays on Electron, unchanged. The phone gets Capacitor around
the very same page (`desktop/src`), built by a Vite configuration that extends the desktop's. Every
change to the page lands on both. The page gains only two small changes: `state()` may say there is
no local machine, and the base of media addresses may come from the bridge.

**The token stays out of the page.** A native plugin (Kotlin, inside the Capacitor project) holds
it and makes every call, as Electron's main process does. Rule 10 holds on the phone; the plugin is
the other place that holds the token.

**SSH lives in the plugin, modelled on `src/remote.ts`.** The plugin runs the exact remote command
that `src/remote.ts` builds, reads the `pine service` line, checks the daemon's address as
`loopbackEnd` does, and words its failures as `sshTrouble` does. HTTP to the daemon goes through
SSH channels, never through a port on the phone, which every app on the phone could reach.

**Any SSH destination.** A host, `user@host` or `user@host:port`, checked as the desktop checks it.
How the machine is reachable (same Wi-Fi, a VPN, a server with public SSH) is the owner's business:
the app embeds no network of its own.

**pi's SSH tool operations are not used.** They run an agent's tools on another machine. The app
needs a client connection to a daemon, which is a different thing.

**Keys.** On first use the app makes an Ed25519 key pair; the private key is encrypted with a key
of the Android Keystore. The app shows the public key to copy into the server's `authorized_keys`.
Host keys are trusted on first use: an unknown key is shown by its fingerprint for the owner to
confirm, and a changed key is refused, with a way to forget the stored one on purpose.

**No notifications at first.** Telegram is pine's only channel to the owner today. A foreground
service or push (FCM, APNs) is later work.

**Scope.** Everything the page does, except what needs Electron: the terminal, dictation, app
updates, the folder picker, running `pine init`, anything about "this Mac".

**Layout.** A package `mobile/` beside `desktop/`, with its own `package.json`, not part of what
goes to npm. The page moves into a package of its own, `app/`, later, when a third client appears.

**Distribution.** The APK is attached to every GitHub release from `main`, next to the Mac disk
images. The Play Store comes later.

**Tests.** Two seams. The mobile bridge is tested under `node:test` against a fake native plugin,
and type-checks as Electron's `Bridge`. The plugin's Kotlin core is tested on the JVM against an
in-process SSH server and a stand-in daemon. A root test fails when the remote command differs
between `src/remote.ts` and the plugin. End to end on an emulator is a manual script, outside CI.
`npm test` at the root stays as it is.

**Order.** The Android client first, then iOS, then the Termux daemon. The details of iOS are
settled when that step starts.

## Alternatives considered

**Tauri 2 for both desktop and phone.** Rejected. It means a rewrite of the desktop shell in Rust,
three web engines to test against instead of one Chromium, and no Node on the phone either, so it
does not bring the daemon to the phone.

**A PWA.** Kept in reserve. A page served to a browser cannot keep the token from the page, cannot
hold an SSH connection, and would need the control API on a network. It stays an option if the
native app turns out to cost too much.

**A daemon on the phone first.** Rejected for now: impossible on iOS, and on Android it waits for
the Termux question. A client covers what the owner asked for.

## Consequences

- The page has one more client to keep working: a change to the page is checked at phone width too,
  which Chromatic already snapshots.
- The `Bridge` type is now a contract between two implementations; the type check fails when they
  drift.
- The remote command has two homes, TypeScript and Kotlin, held together by a test.
- The release workflow gains a job that builds and signs the APK, and skips with a notice while its
  secrets are absent.
- The owner makes the machine reachable and adds the phone's key; the manual says how.
- The phone does nothing while the app is closed, until notifications are added.
