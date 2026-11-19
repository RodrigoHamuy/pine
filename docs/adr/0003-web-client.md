# 0003: The web client

Status: accepted. Supersedes what ADR 0001 says about a page served to a browser.

## Context

ADR 0001 kept a PWA in reserve and said why it was not the first choice: a page served to a
browser cannot keep the token from the page, cannot hold an SSH connection, and would need the
control API on a network. The Pine app's page, though, is content from outside (an answer can
repeat a web page), and rule 10 in `AGENTS.md` holds every client to keep the token from it.

Owners asked for pine from a work laptop, a borrowed computer or a tablet: places where nothing
can be installed, and where neither the desktop app nor the phone app runs. Two things changed
what a browser can do:

- WebCrypto has Ed25519 in every current engine (Chrome 137, Firefox 130, Safari 17), with keys
  that can be made non-extractable and kept in IndexedDB.
- A browser cannot open TCP, but a small Worker can carry a WebSocket to a TCP connection, so an
  SSH client written for the browser can reach `sshd` with SSH end to end inside it.

## Decision

**A web client in `web/`, a package of its own, beside `desktop/` and `mobile/`.** It is the Pine
app's page, built for the browser, for the owner's own pine over SSH. No daemon runs in the
browser, and the control API stays on the loopback of the machine.

**The top-level document holds key and token.** The web bridge (`web/src/host.ts`) plays the part
`desktop/electron/main.ts` plays: it holds the browser's SSH key, the machines and their trusted
host keys, the SSH connection and the daemon's token, and makes every call to the control API.

**The page runs in an iframe sandboxed with scripts only, under an opaque origin.** What it draws
reaches neither the bridge's IndexedDB, nor the key, nor the token. The bridge answers messages
from that iframe's window alone, only a method of a fixed list (`web/src/protocol.ts`), with its
arguments checked one by one. The iframe gets no other permission, `allow-same-origin` least of
all. Media reach the page as bytes under `MEDIA`'s rules, and only `http(s)` addresses are
opened, in a new tab with `noopener`.

**SSH runs in the browser.** On `@microsoft/dev-tunnels-ssh`, with Ed25519 on WebCrypto. The key
is made non-extractable and only its public half is ever exported. A host key is trusted only as
the owner confirmed it, by the exact fingerprint shown, before the key is offered; a changed one
is refused. The daemon is reached through a direct-tcpip channel to the machine's loopback and
nowhere else, after `pine service` was run as `remoteCommand()` in `src/remote.ts` says.

**The relay carries SSH and nothing else.** A Cloudflare Worker (`web/relay`) between the
browser's WebSocket and a TCP connection: it sees neither key nor token, checks that both sides
speak SSH, reaches public addresses only (checked after the name is looked up), caps connections
per client address, and keeps and logs nothing. The same Worker serves the build.

**A tailnet machine through Tailscale Funnel.** A browser joins no VPN, and the relay refuses the
addresses of a tailnet. Funnel publishes a machine's `sshd` behind Tailscale's TLS at its name in
the tailnet; the relay connects to a `.ts.net` name, on Funnel's ports alone, by that name through
TLS with the certificate checked for it, after the name's addresses passed the same check. SSH
stays end to end inside that TLS.

## Alternatives considered

**A PWA as ADR 0001 pictured it, with the token in the page.** Rejected: whatever the page draws
could read it.

**The control API on a network, behind a login.** Rejected: rule 10 and the daemon's loopback-only
control API stay as they are. SSH already authenticates the owner and protects the bytes.

**A relay that terminates SSH, or a server that holds the key.** Rejected: the relay would then
hold what reaches the owner's machine. A relay that carries bytes it cannot read holds nothing.

**Reaching the loopback or private addresses from the relay.** Rejected: a public relay would
become a way into whatever network it runs beside. Its one way to the loopback,
`RELAY_ALLOW_LOOPBACK`, is the smoke's, given to `wrangler dev` on its command line, and a test
fails when a deployed configuration sets it.

## Consequences

- Rule 10 has a fourth holder of the token: the web bridge, beside `main.ts`, the preview's server
  and the mobile app's native plugin.
- The page's bridge has a third implementation (`web/src/frame-bridge.ts`); a change of the page is
  checked in `desktop/`, `mobile/` and `web/`.
- The page can do nothing that needs a pine on the computer in front of the owner (`local: false`):
  no terminal, no voice input, no folder of this computer.
- Clearing the site's data in the browser forgets the key; the owner adds the new one to each
  machine again.
- What no suite of `npm test` reaches (the opaque origin, a message from another window, the token
  kept from the page) is proven by `npm run smoke` in `web/`, by hand before a release.
- Each pull request that touches the web client gets a preview version of the Worker; the live
  version is deployed by hand only.
