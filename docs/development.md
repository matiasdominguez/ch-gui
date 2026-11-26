# Development

## Requirements

- macOS with the Xcode command line tools. Tauri also builds for Linux
  and Windows, but nobody has tested those builds.
- Rust, installed with rustup. `rust-toolchain.toml` pins the version.
- Node 22.13 or later in the 22 line, or Node 24 or later. Some
  dependencies do not support Node 23. `.nvmrc` says `22`, so `nvm use`
  picks your newest Node 22. `.npmrc` sets `engine-strict`, so npm
  refuses other versions.
- npm. Bun writes a `bun.lockb` file that the repo does not use.

## Setup

```bash
git clone https://github.com/matiasdominguez/ch-gui.git
cd ch-gui
npm install
```

## Run in development

Reloads the UI and rebuilds the Rust backend on change:

```bash
npm run tauri dev
```

## Type-check and build

```bash
npx tsc --noEmit                      # TypeScript only
(cd src-tauri && cargo check)         # Rust only
npm run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

The last command writes the `.dmg` to
`src-tauri/target/release/bundle/dmg/`. The override is needed without the
project's updater signing key, because plain `npm run tauri build` writes the
`.dmg` and then exits 1. Your build still checks the official update server, so
an update can replace it with an official release.

Before you distribute your own build, change `identifier` and the updater's
`endpoints` and `pubkey` in `src-tauri/tauri.conf.json`, and `SERVICE` in
`src-tauri/src/keychain.rs`. A build that keeps the official identifier reads
and writes the official app's saved connections, history, and Keychain entries.

## Tests

```bash
npm test                              # vitest: src/**/*.test.ts(x)
(cd src-tauri && cargo test)          # Rust unit tests
(cd vendor/klickhouse && cargo test --lib)  # the fork's unit tests, including the patches
npm run lint                          # eslint, configured in eslint.config.js
npm run format:check                  # prettier; `npm run format` fixes files
(cd src-tauri && cargo fmt --check && cargo clippy)
```

Upstream's `vendor/klickhouse/tests/` needs a ClickHouse server on
`localhost:9000`, such as the Docker server below, so `--lib` skips
those tests. The repo has no CI; run these checks before opening a PR.

**Integration tests.** `src-tauri/tests/` tests the backend against a live
server. `integration_ch.rs` covers every backend read function, and the other
files cover type decoding, readonly users, column stats, client info, and
new-row counts. The tests skip themselves when nothing listens on
`127.0.0.1:9000`, so plain `cargo test` works offline. A server that answers
but refuses the connection fails them. To run them against a server:

```bash
docker compose -f scripts/docker-compose.test-ch.yml up -d --wait   # ClickHouse 26.3, ports 9000 and 8123
(cd src-tauri && cargo test --tests)
docker compose -f scripts/docker-compose.test-ch.yml down
```

`CH_TEST_HOST`, `CH_TEST_PORT`, `CH_TEST_USER`, and `CH_TEST_PASSWORD`
point the tests at another server. The app can use the same container:
host `localhost`, port `9000`, user `default`, no password, **Secure**
off.

**UI smoke tests.** `scripts/smoke/` drives the running app through
AppleScript and the macOS accessibility API, and saves a screenshot of
each step to `/tmp/chgui_smoke/`. No test checks the images; open them
and look. The tests need Accessibility and Screen Recording permission
for the terminal that runs them, a running `npm run tauri dev`, and a
connection with the test schema. See `scripts/smoke/README.md`.

**Function docs snapshot.** `scripts/fetch-ch-functions.ts` writes
`system.functions` from the Docker server (HTTP port 8123) to
`src/assets/ch-functions.json`, the bundled copy the editor uses for
function docs. Rerun it and commit the JSON whenever the ClickHouse
version in the compose file changes:

```bash
npx tsx scripts/fetch-ch-functions.ts
```
