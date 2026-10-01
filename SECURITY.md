# Security Policy

## Reporting a vulnerability

If you find a security issue, please report it privately rather than opening a
public issue:

**GitHub:** https://github.com/HieuDZ609/universe-gesture/security/advisories/new
→ "Report a vulnerability"

I aim to acknowledge reports within 72 hours. Since this is a solo-maintained
side project, expect a fix or a mitigation note within a week.

Please include: what you did, what you expected, what happened, and the browser
/ OS / Node version if relevant.

## Threat model

This project is deliberately small in surface area. Understanding what it does
*not* do matters as much as what it does.

**Everything runs in your browser.** There is no backend, no server-side code,
and no database. A deployment of this repo is a set of static files.

**Camera frames never leave your machine.** Hand tracking uses MediaPipe's
HandLandmarker running locally via WebAssembly. No video frame, landmark, or
derived measurement is uploaded, logged, or sent to any server. The only
outbound requests the app can make are to fetch the MediaPipe model and WASM
runtime, and those happen once at startup — the WASM files are copied from
`node_modules` at install time and served from your own origin, so in practice
even those are local.

**No telemetry.** There is no analytics, no error reporting service, and no
`localStorage` persistence. Closing the tab leaves nothing behind.

**No network input.** The app reads no data from any source other than the
camera you explicitly grant. It does not fetch user-supplied URLs or files.

**No secrets in the repository.** There are no API keys, tokens, or credentials
of any kind, and the project has no build step that injects them.

## What is in place

| Control | Detail |
|---|---|
| Content Security Policy | Set in `index.html`. `default-src 'self'`; no `unsafe-eval`; `object-src 'none'`; `frame-ancestors 'none'`. `'wasm-unsafe-eval'` is required for MediaPipe. |
| Referrer policy | `no-referrer` — nothing about your visit leaks to any outbound request. |
| No inline HTML injection | The HUD builds nodes with `createElement` / `textContent`; there is no `innerHTML` sink fed by runtime data. |
| Camera lifecycle | Every track is `stop()`ped on toggle-off, `pagehide`, and `beforeunload`, so the browser recording indicator goes out. |
| No audio | `getUserMedia` requests `audio: false`. |
| Pinned dependencies | All versions are exact (no `^` / `~`), and `package-lock.json` pins integrity hashes. `npm audit` currently reports 0 vulnerabilities. |
| Secrets scanning | Enabled by GitHub on this public repository. |
| Dependency alerts | Dependabot alerts are enabled. |

## Out of scope

- Vulnerabilities in Three.js, MediaPipe, Vite, or the browser itself. Report
  those upstream — see the [Credits](README.md#credits--license) section.
- Model output being wrong. Hand tracking is probabilistic; a misdetected
  gesture is a quality issue, not a security issue.
- Denial of service via an unusually weak GPU.
- Physical privacy: the app cannot help with someone else positioning a camera
  to watch you. That is a property of the hardware, not this software.
