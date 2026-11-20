# The Android and iOS app

pine has an app for Android phones and tablets and for iPhones: **Pine**, the desktop app's page
on a phone ([desktop.md](desktop.md)). It shows the pine of another machine, which it reaches
over SSH: your Mac, a desktop at home, a server. The same agents, conversations, approvals,
questions, code pane, browser panel and settings as on the Mac, in light and dark (the status
bar, and on Android the navigation bar, take the theme's color), at the phone's width.

The app is a client and nothing more. No pine runs on the phone: the machine you add runs it,
and the app talks to that pine's control API through the SSH connection, as the desktop app's
Settings > Environments does. It lies in `mobile/` of pine's repository and is built with
Capacitor around the page of `desktop/`: the same page and the same app on both systems.

## Getting it

A release of pine has the Android app attached, next to the Mac disk images:
<https://github.com/pmndre/pine/releases/latest>. The iPhone app is not attached for now: it is
built by hand (`npm run ipa`, below), and a release that has one lists it there.

| File | For |
|---|---|
| `Pine-<version>.apk` | A phone or tablet with Android 8 or later |
| `Pine-<version>.ipa` | An iPhone with iOS 17 or later |

### On Android

Open the file on the phone. Android asks once whether the app you opened it with (the browser,
Files) may install apps: allow it. The app is signed with pine's release key, so a later
version installs over this one and keeps your machines and your key. There is no Play Store
version yet.

### On an iPhone

There is no App Store or TestFlight version. The IPA is not signed: you sign it with your own
Apple ID as you install it, with a sideloading tool on a computer. A free Apple ID will do; nobody
else's developer account is involved.

| Tool | How |
|---|---|
| AltStore | Install AltServer on your Mac or PC and AltStore on the iPhone from it (altstore.io), then open `Pine-<version>.ipa` in AltStore (My Apps, +) |
| Sideloadly | On your Mac or PC (sideloadly.io): connect the iPhone, drop the IPA on it, sign in with your Apple ID and Start |

The first time, iOS asks you to trust your own developer certificate (Settings > General > VPN &
Device Management) and to turn on Developer Mode (Settings > Privacy & Security) before the app
opens.

On a free Apple ID an app installed this way runs for 7 days. AltStore renews it by itself while
the iPhone and the computer running AltServer are on the same Wi-Fi (or with Refresh All in
AltStore); with Sideloadly, install it again before the 7 days are over. A paid developer
account's install lasts a year. A renewal, or a newer IPA installed under the same Apple ID,
keeps your machines and your key.

## The phone's key

On its first start the app makes an SSH key for this phone (Ed25519). The private key never
leaves the app and is not in the phone's backups: on Android it is stored encrypted with a key
of the Android Keystore, on an iPhone it is kept in the iOS Keychain, on this device only and
readable after the phone's first unlock. Settings > Environments shows the public key, under "This device's key", with
Copy and Share.

Where the key goes: into `~/.ssh/authorized_keys` of the user you sign in as, on each server or
computer the phone is to reach, one line per key. For example, on that machine:

```bash
echo 'ssh-ed25519 AAAA... pine' >> ~/.ssh/authorized_keys
```

The app signs in with this key and nothing else: no password, no key of yours imported.

On an iPhone the key belongs to the Apple ID that signed the app. After a reinstall under
another Apple ID (or with a tool that changed the app's bundle ID), the app cannot read the old
key and makes a new one, so your machines refuse the iPhone until you add the new public key to
their `authorized_keys` (and remove the line of the old one).

## Adding a machine

Settings > Environments, under "Add a machine" (the first screen, while there is none): type
the machine as `user@host` or `user@host:port`, and Add. The user is needed, since a phone has
no user name of its own. Anything else (an option for ssh, spaces, `;`) is refused. The machine
is connected to when you pick it.

| Needs | |
|---|---|
| The phone's key | In `~/.ssh/authorized_keys` there (see above) |
| A pine with `pine service` | An older pine is not reached: update it there with `pine update` |
| A pine home there | `pine init` on that machine first |
| A way from the phone to the machine | See "Making a machine reachable" |

The app runs `pine service` there, as the desktop app does: it attaches to the pine that runs,
or starts one, which the connection then holds. Pick another machine at the foot of the side
bar, as on the Mac. The app remembers the machines and the one in use, and opens on it next
time. Forget on a machine's line removes it, with its host key; the machine in use too, when
it is not reached, so that the first screen lists the others again.

On an iPhone, the first time the app reaches a machine on your Wi-Fi, iOS asks whether Pine may
find and connect to devices on your local network ("Pine connects over SSH to the machines you
add, some of which are on your local network"). Allow it: without it a machine on the local
network is not reached. You can change it later in Settings > Privacy & Security > Local Network.

When a machine is not reached, the first screen says why, in the words of the desktop app:
the machine does not answer, pine is not installed there, pine there is too old, there is no
pine home, or the key was refused.

## The machine's host key

The first time the app reaches a machine, it stops and shows the fingerprint of the machine's
host key (SHA256, as OpenSSH prints it). Compare it with what the machine says:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

If it is the same, press **Trust this key**: the app trusts exactly that key, for that host and
port, and connects. If it is not, do not press it: something else answers in the machine's
place. Try again only connects again; it never trusts a key.

When the host key of a known server changed, the app refuses to connect and says so: another
machine may stand in for it. If you reinstalled that machine, or its SSH server got new keys,
forget the machine and add it again; the app then asks about the new key.

## Making a machine reachable

To reach the computer at home, or a server, from the phone when you are out, the phone has to
reach that machine's SSH port. How is your network's business, not pine's:

| Where you are | How |
|---|---|
| Same Wi-Fi | The machine's address on the network (`you@192.168.1.20`, or `you@mac.local`). On a Mac, turn on System Settings > General > Sharing > Remote Login |
| Anywhere, with a VPN | A VPN that puts the phone and the machine on one network: Tailscale, ZeroTier or WireGuard. Install it on both and use the machine's address or name in that network (`you@my-mac` with Tailscale's names). Nothing is opened to the internet |
| A server with public SSH | A VPS or a server you already reach with `ssh`: its address, as for any SSH client |

Tailscale SSH (signing in without a key) is not supported yet: use Tailscale as a network and
the phone's key for SSH.

From a browser, which joins no VPN, the web client reaches a machine that is only on a tailnet
through Tailscale Funnel: see "A machine on a tailnet" in [web.md](web.md#a-machine-on-a-tailnet).

pine's control API stays closed to the network in every case: the app talks to it through the
SSH connection, and the daemon takes requests for its own loopback only.

## What the phone does not do

| | |
|---|---|
| A pine on the phone | The app runs no daemon: it shows the pine of a machine you add |
| This computer's things | No "This Mac", no home folder, no restart of pine, no `pine` command, no terminal or Run button, no dictation, no folder picker, no app updates (a new APK from the release instead) |
| Notifications while closed | None yet. When the app comes back it reconnects and shows what waited. Telegram is the way to be told while the app is closed ([source-types.md](source-types.md)) |
| Your SSH setup | No `~/.ssh/config` names, no ssh-agent, no jump hosts, no password, no imported key |
| The App Store | The iPhone app is sideloaded (see "On an iPhone"): there is no App Store or TestFlight version |

The Android back button closes the open dialog, sheet or menu, and otherwise leaves the app. An
iPhone has no back button: close a sheet with its own button.

## What the app is careful about

The page is the desktop app's, and the same rules hold ([desktop.md](desktop.md), "What the app
is careful about"). On the phone:

| | |
|---|---|
| The page has no token | The daemon's token stays in the app's native part (a Capacitor plugin: `PinePlugin.kt` on Android, `PinePlugin.swift` on iOS), which makes every call for the page, as the Mac app's main process does |
| No port on the phone | Every request to the daemon goes through a channel of the SSH connection. No port is opened on the phone's loopback, where another app could use it |
| The page stays the app | It loads nothing from the web, cannot be taken to another address, opens no window and is given no permission. A link opens in your browser, `http` and `https` only. A photo is attached through the system's file chooser |
| Pictures, video and sound | Answered by the native part from the daemon, under the Mac app's rules: fixed addresses only, never SVG. On iOS they come through a scheme of the app's own (`pine-media:`), the only origin the page's policy allows for them |

## Building it

From a checkout, in `mobile/` (`npm install` there once).

### Android

It needs the Android SDK
(`ANDROID_HOME`, by default `~/Library/Android/sdk`) and a JDK of 21 or later (`JAVA_HOME`, by
default Android Studio's on a Mac).

| Command | What it does |
|---|---|
| `npm run apk` | A debug APK, in `android/app/build/outputs/apk/debug/` |
| `npm run apk:release` | A release APK. Signed when `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` name a key; unsigned otherwise. `PINE_VERSION` and `PINE_VERSION_CODE` set its version |
| `npm run smoke` | Builds, installs on an emulator without a window and opens the app against a test machine of its own. It is the test of the WebView's hardening (no permission, no window, no file access, no navigation away), of Share, of the back button, of the return from the background, and of the system bars in a dark theme and a light one (`bars-dark.png`, `bars-light.png` beside its screenshot). An emulator that starts cold on a busy computer says that its own apps (System UI, the keyboard) are not responding: the run waits for the system to settle, answers such a dialog with Wait, and fails only when the app itself is not responding. Run it before a release that changes `mobile/` or upgrades Capacitor |

Attaching a photo through the system's file chooser is not driven by the smoke run: check it by
hand on a phone or the emulator before such a release (attach a picture to a message, and see
it sent).

### iOS

It needs a Mac with Xcode 27 and, for the simulator, an iOS simulator runtime (Xcode > Settings >
Components).

| Command | What it does |
|---|---|
| `npm run sync:ios` | Builds the page for iOS (WebKit, media on `pine-media:`) and copies it into `ios/` |
| `npm run ios` | A debug build for the simulator, in `ios/DerivedData` |
| `npm run ios:run` | Builds the app and opens it in the Simulator app |
| `npm run ipa` | The IPA of a release, not signed, in `ios/App/output/Pine-<version>.ipa` (`npm run ipa -- 0.38.0`; 0.0.0 without a version). It fails unless the app inside is unsigned and arm64 |
| `npm run smoke:ios` | Builds the app and a test that runs inside it, starts a simulator of its own without a window, and drives the page against a test machine on the Mac's loopback. It is the test of the web view's hardening (the page's policy, no camera, microphone or motion sensors, no file access, the media scheme's rules and ranges, no window, no navigation away), of the page inside the safe area with and without the keyboard, of a host key's fingerprint within the screen's width, of the return from the background, of the status bar in a dark theme and a light one, and of the key kept across a relaunch. Run it before a release that changes `mobile/` or upgrades Capacitor |
| `swift test` (in `ios-core/`) | The iOS app's Swift core on the Mac, against an OpenSSH `sshd` of the test's own and a stand-in daemon |

To try the app on the simulator against the pine of your own Mac: turn on Remote Login (System
Settings > General > Sharing), run `npm run ios:run`, add the simulator's key (Settings >
Environments) to your `~/.ssh/authorized_keys`, and add the machine as `you@127.0.0.1`. The
simulator shares the Mac's network, so its loopback is the Mac's, and iOS does not ask about the
local network for it. A simulator build is signed to run locally (Xcode does it, without an
account): the Keychain refuses an app that is not signed at all.

## In a release

The Release workflow (`.github/workflows/release.yml`) builds the release APK for every release
from `main` and attaches it to the GitHub release, with `versionName` the release's version and
`versionCode` major × 1 000 000 + minor × 1 000 + patch. It takes the key from four secrets of
the environment `release`; without them it builds no APK and says so.

The release does not build the IPA for now: the core's `swift test` did not pass on GitHub's
Xcode 27 preview image. On a Mac with Xcode 27, `npm run ipa -- <version>` in `mobile/` makes
`Pine-<version>.ipa`, whose build number is Android's `versionCode`; run `npm test` there and
`swift test` in `mobile/ios-core/` first.

To build the APK of a release again, run the workflow by hand from `main` with that
release's version: `gh workflow run release.yml -f version=0.38.0`.
