# Vendored code

| Library  | Version | Source                                        | License |
|----------|---------|-----------------------------------------------|---------|
| Three.js | r186    | `github.com/mrdoob/three.js`, tag `r186` (commit `9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8`), files `build/three.module.js` and `build/three.core.js` | MIT (`three/LICENSE`) |

## Why vendored instead of npm or a CDN

- **No install step, no install scripts.** Nothing runs on your machine except the code in this repo.
- **No CDN trust.** A compromised CDN can't swap the file; the page's CSP only allows same-origin scripts.
- **Pinned by content, not by name.** `checksums.sha256` holds the SHA-256 of every file here. CI fails if a single byte changes or an unlisted file appears.
- **Unminified on purpose**, so the code you ship is the code you can read and diff.

## Audit notes for r186

- No `eval` or `new Function`.
- `fetch` / `XMLHttpRequest` appear only inside Three.js loaders (`FileLoader`, `ImageBitmapLoader`), which Drillbux never calls. The CSP sets `connect-src 'none'`, so they couldn't reach the network anyway.

## Updating

1. Fetch the new tag's `build/three.module.js`, `build/three.core.js` and `LICENSE` from the official repository and confirm the tag's commit.
2. Read the diff (`git diff --no-index`), especially for new network or dynamic-code paths.
3. Regenerate the manifest from inside `vendor/`: `sha256sum three/three.module.js three/three.core.js three/LICENSE > checksums.sha256`
4. Run `npm run check` and play through a field before committing.
