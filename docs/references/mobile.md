# The Android app

pine has an app for Android phones and tablets: **Pine**, the desktop app's page on a phone
([desktop.md](desktop.md)). It shows the pine of another machine, which it reaches over SSH:
your Mac, a desktop at home, a server. The same agents, conversations, approvals, questions,
code pane, browser panel and settings as on the Mac, in light and dark, at the phone's width.

The app is a client and nothing more. No pine runs on the phone: the machine you add runs it,
and the app talks to that pine's control API through the SSH connection, as the desktop app's
Settings > Environments does. It lies in `mobile/` of pine's repository and is built with
Capacitor around the page of `desktop/`.

## Getting it

Every release of pine has the app attached, next to the Mac disk images:
<https://github.com/pmndre/pine/releases/latest>

| File | For |
|---|---|
| `Pine-<version>.apk` | A phone or tablet with Android 8 or later |

Open the file on the phone. Android asks once whether the app you opened it with (the browser,
Files) may install apps: allow it. The app is signed with pine's release key, so a later
version installs over this one and keeps your machines and your key. There is no Play Store
version yet.

## The phone's key

On its first start the app makes an SSH key for this phone (Ed25519). The private key never
leaves the app: it is stored encrypted with a key of the Android Keystore, and it is not in the
phone's backups. Settings > Environments shows the public key, under "This phone's key", with
Copy and Share.

Where the key goes: into `~/.ssh/authorized_keys` of the user you sign in as, on each server or
computer the phone is to reach, one line per key. For example, on that machine:

```bash
echo 'ssh-ed25519 AAAA... pine' >> ~/.ssh/authorized_keys
```

The app signs in with this key and nothing else: no password, no key of yours imported.

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
time. Forget on a machine's line removes it, with its host key.

When a machine is not reached, the first screen says why, in the words of the desktop app:
the machine does not answer, pine is not installed there, pine there is too old, there is no
pine home, or the key was refused.

## The machine's host key

The first time the app reaches a machine, it stops and shows the fingerprint of the machine's
host key (SHA256, as OpenSSH prints it). Compare it with what the machine says:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

If it is the same, Try again: the app trusts exactly that key, for that host and port, and
connects. If it is not, do not go on: something else answers in the machine's place.

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

pine's control API stays closed to the network in every case: the app talks to it through the
SSH connection, and the daemon takes requests for its own loopback only.

## What the phone does not do

| | |
|---|---|
| A pine on the phone | The app runs no daemon: it shows the pine of a machine you add |
| This computer's things | No "This Mac", no home folder, no restart of pine, no `pine` command, no terminal or Run button, no dictation, no folder picker, no app updates (a new APK from the release instead) |
| Notifications while closed | None yet. When the app comes back it reconnects and shows what waited. Telegram is the way to be told while the app is closed ([source-types.md](source-types.md)) |
| Your SSH setup | No `~/.ssh/config` names, no ssh-agent, no jump hosts, no password, no imported key |
| iOS | Not yet |

The Android back button closes the open dialog, sheet or menu, and otherwise leaves the app.

## What the app is careful about

The page is the desktop app's, and the same rules hold ([desktop.md](desktop.md), "What the app
is careful about"). On the phone:

| | |
|---|---|
| The page has no token | The daemon's token stays in the app's native part (a Capacitor plugin), which makes every call for the page, as the Mac app's main process does |
| No port on the phone | Every request to the daemon goes through a channel of the SSH connection. No port is opened on the phone's loopback, where another app could use it |
| The page stays the app | It loads nothing from the web, cannot be taken to another address, opens no window and is given no permission. A link opens in your browser, `http` and `https` only. A photo is attached through the system's file chooser |
| Pictures, video and sound | Answered by the native part from the daemon, under the Mac app's rules: fixed addresses only, never SVG |

## Building it

From a checkout, in `mobile/` (`npm install` there once). It needs the Android SDK
(`ANDROID_HOME`, by default `~/Library/Android/sdk`) and a JDK of 21 or later (`JAVA_HOME`, by
default Android Studio's on a Mac).

| Command | What it does |
|---|---|
| `npm run apk` | A debug APK, in `android/app/build/outputs/apk/debug/` |
| `npm run apk:release` | A release APK. Signed when `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` name a key; unsigned otherwise. `PINE_VERSION` and `PINE_VERSION_CODE` set its version |
| `npm run smoke` | Builds, installs on an emulator without a window and opens the app against a test machine of its own |

The Release workflow (`.github/workflows/release.yml`) builds the release APK for every release
from `main` and attaches it to the GitHub release, with `versionName` the release's version and
`versionCode` major × 1 000 000 + minor × 1 000 + patch. It takes the key from four secrets of
the environment `release`; without them it builds no APK and says so. To build the APK of a
release again, run the workflow by hand from `main` with that release's version:
`gh workflow run release.yml -f version=0.38.0`.
