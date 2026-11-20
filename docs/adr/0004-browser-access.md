# 0004: Browser access to the Pine app's pine

Status: accepted. Amends what ADR 0001 says about a network of the app's own, and ADR 0003 on
how a host key is trusted and what the Worker carries.

## Context

An owner who installs the Pine app on a Mac from a disk image is in their conversations at once:
the app carries pine and starts the daemon. To have the same conversations on a phone or another
computer, the web client (ADR 0003) and the mobile apps (ADR 0001) need SSH: Remote Login turned
on, the computer's address, a key pasted into `authorized_keys`, a host key fingerprint compared, and
away from home Tailscale Funnel or a server with a public address. Few owners get through that.

ADR 0001 says the mobile app "embeds no network of its own": how a machine is reached is the
owner's business. That stays true of the mobile apps. This decision gives the Pine app a way in of its
own, for its own pine alone, which the owner turns on. The app runs on a Mac today, and is packed
for other systems later: nothing below depends on macOS but the keychain the host key is kept
with, which is the system's own on each.

## Decision

**The app runs an SSH server of its own, the access server.** In the app's main process
(`desktop/electron/access/server.ts`), on `ssh2` without its native binding, with Ed25519 host and
client keys, ECDH (Curve25519 or P-256, the web client's SSH library has no Curve25519) and
AES-GCM. It does two things and nothing else: it answers the one remote command the web client
sends (`remoteCommand()` in `src/remote.ts`, compared as a string, no shell) with the service
line of this computer's own daemon, and it opens direct-tcpip channels to exactly that daemon's
loopback port. A shell, a pty, sftp, every other command, every other destination, a password and
keyboard-interactive are refused. Only keys paired at that computer are accepted. SSH was kept, rather
than a protocol of pine's, because the web client already speaks it end to end and the daemon
stays on the loopback, unchanged: the app gets the token from `pine service` as before, and hands
the line to an authenticated SSH client as `sshd` would.

**Pairing by a QR code.** "Add a device" opens a pairing: a random 128-bit code, for one use, two
minutes, cancelled when the dialog closes. The link is `<service>/#pair=<machine id>.<code>`;
both values are in the fragment, which no server sees. The machine id is the fingerprint of the
computer's host key, so the link is how the browser trusts that key: a second way, beside the owner's
press on "Trust this key", for that machine alone, and never over a key kept already. The
browser shows four digits and the app asks the owner with the device's name and the same digits:
only Allow stores the key. Pairing happens at that computer and nowhere else.

**Named as the browser knows it.** The browser cannot tell what kind of computer it pairs with.
It keeps a paired computer among its machines as `paired:<machine id>`, and names it by the name
the computer gives with its yes (its computer name), which the owner may rename; before that, and
where there is no name, "your computer": no text of the web client calls it a Mac. The app names
itself by its platform, as the rest of its page does: "This Mac" on macOS, "This computer"
elsewhere (`computerWord` in `desktop/src/machines.ts`).

**Peer to peer.** The browser and the computer talk over one WebRTC data channel that carries the
SSH bytes. In the app `node-datachannel` (libdatachannel, prebuilt), chosen in ticket 01: it loads in
the packed, hardened-runtime app on arm64 and under Rosetta, so `werift`, kept in reserve, was not
needed. In the browser the peer connection lives in the web bridge, the top-level document, never
in the page's iframe. Peer to peer means no server carries the conversation, and costs nothing per
byte.

**A meeting service that keeps sockets and nothing else.** Routes of the existing Worker under
`/meet/`, at the web client's own address so that the bridge's policy needs no change. One Durable
Object per machine id, with hibernating WebSockets, so a waiting computer costs no duration; it keeps
no storage. A computer waits under its machine id only after it signed a challenge with that key; a newer
proven socket replaces an older one. A browser that asks for a machine id gets a few opaque
messages passed both ways (at most 64, of 16 KiB each, within 30 seconds), and the service is out
of it. It logs nothing. The meeting logic (`web/relay/src/meet.ts`) has no Cloudflare in it; the
Durable Object is one adapter.

**No relay fallback.** No TURN server and no carrying of the bytes by the Worker. Where two
devices cannot connect directly (some cellular networks behind carrier NAT), the owner is told so
and advised to try another network. The STUN servers that help a connection (`ICE`) are the service's
configuration, read by both sides. A relay (TURN) is not carried today: the app keeps only `stun:`
and `stuns:` addresses, and both sides keep only each server's `urls`, without a username or a
credential, so a fallback needs a release of the Pine app and of the web client.

**One official service.** The project runs the Worker `pine` (`--env official`) at
`https://pine.drcmda.workers.dev`: the web client and the meeting service, the SSH relay off. It
is the app's default (`OFFICIAL_SERVICE`); an owner who runs their own deployment (`--env full`,
relay on) names it in the settings. The default configuration, which pull request previews
upload, declares no Durable Object: Cloudflare does not let a Worker that holds one be uploaded as
a preview version.

## Alternatives considered

**Remote Login (the system's `sshd`) with a key the app adds.** Rejected: it gives a paired
browser a shell on the computer, and the computer's SSH access to other machines; it needs an admin's yes in
System Settings, and still an address to reach.

**A port on the local network, or the control API behind a login.** Rejected: rule 10 keeps the
daemon on the loopback, and a port of the network reaches nobody away from home.

**A relay that carries the bytes (TURN, or the Worker).** Left out, not rejected: it would cost
per byte on a free plan that has no such allowance, and adding it takes a release of both clients
besides the service's configuration. Its absence is the accepted risk below.

**`werift` (pure TypeScript) for the app's data channel.** Kept as the fallback behind the same
small interface; not needed once `node-datachannel` loaded in the packed, signed app.

**The meeting service storing who waits.** Rejected: open sockets are the state. A record of
machines would be a list of every owner's computers, kept by the project.

## Consequences

- Rule 10 gains a second way a host key is trusted in the web client (the pairing link), and the
  Worker carries small opaque meeting messages beside SSH for the relay, keeping no storage.
- The access server's two permissions (the remote command's answer, a channel to the daemon's
  loopback port) are an invariant: a change that widens them needs a test that shows why it is
  safe.
- A share of connections from cellular data to a computer behind a home router fails, an estimated 20
  to 40 percent over IPv4; IPv6 on both sides helps.
- The official address is a commitment: a browser's key and its paired machines belong to it, so
  moving the service makes every owner pair again.
- A locked phone drops the connection; it is made again when the owner returns. Work goes on at
  the computer. The computer has to be awake and the app open.
- The crossing of real networks is proven by no test: it is tried by hand before a release, from
  a phone on cellular data, on another Wi-Fi and on the same Wi-Fi.
