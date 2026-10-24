# Security policy

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security tab → "Report a vulnerability"). Don't open a public issue. You'll get an acknowledgement within 7 days.

## What Drillbux is and isn't

Drillbux is a static, client-side browser game. It has **no backend, no accounts, no payment code and no network calls**. All "purchases" are simulated counters in your browser's local storage.

## Protections in this repository

| Threat | Control |
|---|---|
| Malicious npm dependency / install script | Zero dependencies. `package.json` is checked for empty dependency fields and no lifecycle scripts; `.npmrc` sets `ignore-scripts=true` as a backstop. |
| Tampered third-party library | Three.js is vendored from the official tag and pinned by SHA-256 (`vendor/checksums.sha256`), verified in CI on every push. |
| Compromised CDN or injected script | CSP `script-src 'self'`, `connect-src 'none'`, no inline scripts, no remote origins. |
| Compromised GitHub Action | Every action is pinned to a full commit SHA; Dependabot proposes reviewed bumps. Workflows use a read-only token, `persist-credentials: false`, and never use `pull_request_target`. |
| XSS | The UI is built with a DOM helper that only creates text nodes. `innerHTML`, `eval`, `new Function` and `document.write` are banned by the scanner in `src/`. |
| Tampered save data | `localStorage` is treated as untrusted: schema-validated, numbers range-checked, unknown items dropped, prototype-pollution keys ignored. The reservoir and every crate roll are re-derived from the seed, never read from storage. |
| Prompt injection against AI coding agents | No agent instruction files are committed. The scanner fails on agent config files (`CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `.claude/` …), on hidden/bidi Unicode, on HTML comments in Markdown, and on common injection phrases. See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). |
| Leaked secrets | The scanner checks for common key formats (Anthropic, OpenAI, GitHub, AWS, Google, Slack, Cloudflare, private keys). |

Run every check locally with `npm run check` (it needs Node 20+ and nothing else).

## Recommended GitHub settings for the maintainer

These live in repository settings, not in code, so they have to be switched on by hand:

1. Turn on **two-factor authentication** for your account.
2. Settings → Code security: turn on **secret scanning**, **push protection**, **Dependabot alerts** and **private vulnerability reporting**.
3. Settings → Branches: protect `main`: require pull requests, require the `CI / check` status, block force pushes.
4. Settings → Actions → General: set workflow permissions to **read repository contents**, and require approval for workflows from outside contributors.
5. Settings → Pages: source **GitHub Actions**.
