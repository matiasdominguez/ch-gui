# ch-gui

A macOS desktop client for ClickHouse that uses the native TCP protocol.
Browse schemas, preview data, write SQL, and copy or export results.

Built with Tauri 2, React 19, and Rust. The backend talks to ClickHouse
through a vendored fork of
[`klickhouse`](https://github.com/Protryon/klickhouse).

## Features

### Connections

- Manage connections to several clusters. Passwords stay in the macOS
  Keychain.
- Set a custom CA certificate (PEM) per connection, for self-signed
  certificates or for proxies that inspect TLS.
- The app checks for updates at launch, and **Help → Check for
  Updates…** checks on demand. After each update, a **What's New**
  window lists the changes from `src/lib/changelog.json`.

### Editor

- Monaco SQL editor with autocomplete for keywords and schema objects.
  Table aliases resolve across databases. Formatting uses the server's
  `formatQuery`.
- ClickHouse function docs appear on hover and in completions. They come
  from a bundled `system.functions` snapshot, updated with the connected
  server's list.
- ⌘↵ runs the statement under the cursor, or the selection. ⌘⇧↵ runs the
  whole editor. A script runs its statements in order and stops at the
  first error. The toolbar shows the connection and the running
  statement.
- `{name}` placeholders are substituted on the client. Text values are
  quoted for you; `{!name}` values go in unquoted. See
  [Parameterized queries](#parameterized-queries-and-the-security-model).
- Saved queries per connection (⌘S), a Samples section of health-check
  queries, query history per connection in SQLite, and open tabs that
  persist across restarts.
- Cancel (⌘.) closes the TCP connection and sends `KILL QUERY`. A
  progress bar shows rows, bytes, and percent done from the server's
  progress packets.
- Server logs, from `error` to `trace`, stream into a collapsible panel.
- ⌘P opens the command palette. ⌘? lists the keyboard shortcuts.

### Results

- The grid renders only the visible rows and columns (TanStack Table and
  TanStack Virtual), so `SELECT *` on a wide table stays fast. Column
  widths and sort order persist when you rerun a query.
- Drag to select a rectangle of cells. ⌘C copies it as TSV and ⌘⇧C as a
  Markdown table. The **Copy ▾** menu adds CSV, JSON rows, SQL `VALUES`,
  and a Python list. **Export** writes CSV, TSV, or JSON Lines.
- Double-click a cell to see its full value. JSON is pretty-printed, with
  a **Raw** toggle.
- A `SELECT` without a `LIMIT` returns at most 10,000 rows. A badge shows
  when the limit applied, and a per-tab switch turns it off.
- Bar and line charts for any result with a numeric column.
- A monospace viewer for single-column `EXPLAIN` output.
- Large numbers arrive as strings, so JavaScript `Number` never rounds
  them. `SimpleAggregateFunction` columns decode as their inner type. An
  `AggregateFunction` column fails with an error that suggests
  `finalizeAggregation()`.

### Schema and server

- The sidebar loads databases, tables, and columns from `system.*` as
  you expand them. Each table offers **Preview 100 rows**, **Copy DDL**,
  and **Copy names**.
- A column drawer shows null and unique counts, the minimum and maximum,
  and a histogram or the most frequent values.
- A dependency graph (`@xyflow/react` and `dagre`) shows the views and
  materialized views that read from a table.
- **Δ** lists every server setting that differs from the ClickHouse
  default.
- Sidebar tabs show **Server Activity** (`system.errors` and related
  tables), **Live Queries**, and, when Kafka tables exist, **Kafka
  consumer health**. Each tab refreshes on its own interval, set in
  Settings, over one shared background connection. If the account cannot
  query the whole cluster, the tabs read only the connected node.

## Install (beta)

- Requires macOS 11 (Big Sur) or later on Apple silicon. Intel Macs are
  not supported.
- Read `version` from <https://downloads.matiasdominguez.dev/latest.json>,
  then download
  `https://downloads.matiasdominguez.dev/chgui_<version>_aarch64.dmg`.
- The app is signed with a Developer ID and notarized by Apple, so macOS
  opens it without a warning.
- Download ch-gui only from `downloads.matiasdominguez.dev`. To check a
  download, run `shasum -a 256 chgui_<version>_aarch64.dmg` and compare the
  result with the SHA-256 on that version's entry in
  [Releases](https://github.com/matiasdominguez/ch-gui/releases).
- The app updates itself. Version 0.2.0 and older must run **Help →
  Check for Updates** once.

## Parameterized queries and the security model

ch-gui substitutes `{name}` placeholders into the query text on the
client, before it sends the query. The server binds no parameters.

- `{name}` is text. The value goes in as a quoted, escaped string: `US`
  becomes `'US'`. A value that starts with `'` goes in as typed, for
  lists such as `'US','CA'`. Inside quotes, as in `'{name}'`, the value
  is escaped but not quoted again.
- `{#name}` is a number and `{!name}` is raw SQL, such as a column name
  or an expression. Both go in as typed. `{@name}` is a date, quoted
  unless it starts with a quote, a letter, or `(`.
- Braces inside comments are not placeholders, and neither are names
  that start with a digit, as in `\d{3}`.

Raw and number values reach the server as typed, so a raw value can
change what the query does.

This is deliberate. ch-gui is a single-user desktop app that runs with
the user's own ClickHouse credentials. A value that changes the query
runs with the same permissions as SQL the user types, so it grants no
access the user lacks.

Names read from the server are different, because other users on the
cluster choose them. ch-gui escapes every database, table, and view name
and every query id before putting it in SQL.

Before using ch-gui in a shared or managed setting, such as a web
frontend, a kiosk build, or a service account, move substitution to
server-side parameter binding or validate every value strictly.

## What ch-gui stores and sends

- Passwords stay in the macOS Keychain.
- Query history stays unencrypted in the app's SQLite file for 90 days,
  and longer when pinned. Open tabs and their parameter values stay
  unencrypted in the app's local storage. A statement that contains a
  secret, such as `CREATE USER ... IDENTIFIED BY '...'`, is saved as
  typed.
- ClickHouse servers receive your OS username and hostname, which appear
  in `system.query_log`.
- Update checks contact `downloads.matiasdominguez.dev`. ch-gui sends no
  telemetry.
- Exports hold the exact values from the server. A spreadsheet treats a
  value that starts with `=`, `+`, `-`, or `@` as a formula, so be careful
  opening exports of data that other people can write.
- With **Secure** off, your password and query results cross the network
  unencrypted.

Report security problems as described in [SECURITY.md](SECURITY.md).

## Architecture

```
┌────────────────────────── Tauri App ──────────────────────────┐
│                                                                │
│  React frontend           ←→  Tauri IPC  ←→  Rust backend     │
│  ───────────────                              ─────────────    │
│  Mantine + Monaco                             commands.rs      │
│  TanStack Table                               clickhouse/      │
│  Zustand + TanStack Query                      client.rs       │
│  components/                                   tls.rs          │
│                                                value.rs        │
│                                               keychain.rs      │
│                                               pool.rs          │
│                                               state.rs         │
│                                               storage (SQLite) │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                Native TCP (port 9000) / TLS (9440)
                              │
                              ▼
                          ClickHouse
```

The life of a query:

1. The UI calls `run_query({ cfg, sql, queryId, logLevel? })`.
2. The backend takes a pooled `klickhouse::Client` or opens one. If the
   UI asked for logs, it subscribes to log packets and runs
   `SET send_logs_level=…`.
3. `klickhouse` streams `Block`s. The backend converts them to JSON
   cells, keeps large numbers as strings, and returns
   `{ columns, rows, stats }`.
4. Log packets arrive as `query-log` Tauri events tagged with the
   `queryId`.
5. `cancel_query` opens a new connection and sends `KILL QUERY` for the
   query's tag, a leading SQL comment `-- chgui:<uuid>`.

## Vendored `klickhouse`

`vendor/klickhouse/` holds `klickhouse` 0.13.2 from crates.io, with the
upstream commit in `vendor/klickhouse/.cargo_vcs_info.json`, plus the
patches below. Most changed sections have a `// chgui patch:` comment, and
`grep -rn "chgui patch" vendor/klickhouse/src` lists them. Not every edit
for the server-supplied sizes patch has one, so its bullet names the files.

- **Server log streaming** (`server_log.rs`, new; `client.rs`, `lib.rs`).
  Upstream discards `Log` packets. The fork decodes them into `LogEntry`
  batches and exposes `Client::subscribe_logs()`.
- **`receive_log_data`** (`internal_client_in.rs`). Upstream calls
  `unimplemented!()` and panics on the first log packet. ClickHouse never
  compresses log packets, even on LZ4 connections, so the fork reads them
  with `CompressionMethod::None`.
- **JSON columns** (`block.rs`, `types/mod.rs`). `JSON`, `JSON(...)`, and
  `Object('json')` parse as `String`. `Block::read` skips the 8-byte
  serialization-version prefix that ClickHouse 24.10 and later send when
  `output_format_native_write_json_as_string=1`. JSON nested in another type
  fails with an error that suggests `toJSONString`, because the fork reads
  that prefix only for top-level columns.
- **Aggregate types** (`types/mod.rs`). `SimpleAggregateFunction(f, T)`
  decodes as `T`. `AggregateFunction` fails with an error that suggests
  `finalizeAggregation`, where upstream misreads the rest of the stream.
- **Column names in type errors** (`block.rs`). `TypeParseError` names
  the column.
- **Connect-time SET failure is a warning** (`client.rs`).
  `SET date_time_input_format='best_effort'` fails on readonly profiles.
  The fork logs a warning and connects; upstream refuses to connect.
- **Decode errors reach the caller** (`client.rs`). When the connection
  task hits a fatal error, the fork sends the error to the running
  query's block stream and to every queued query, so the app shows the
  error instead of an empty grid.
- **Named tuples** (`types/mod.rs`). The fork drops the field names from
  `Tuple(name Type, ...)` before parsing. Upstream fails with "malformed
  arguments to type" on any named tuple and misreads the rest of the
  stream.
- **Enum8 and Enum16** (`types/mod.rs`). Upstream rejects both types. The
  fork parses their `'name' = N` entries, including names with quotes,
  commas, or parentheses, and the app shows the label instead of the
  number.
- **Client identity** (`client.rs`, `internal_client_out.rs`). The fork sends
  a client name, so the server's logs show which app ran a query.
- **Invalid UTF-8** (`io.rs`). Names and error text escape invalid bytes as
  `\xNN`. Upstream fails the query.
- **Repeated column names** (`block.rs`). A repeated name gets a suffix, as in
  `1 (2)`. Upstream keeps only the last column of that name.
- **DateTime64 before 1970** (`values/date.rs`). ClickHouse stores these dates
  as negative numbers, and upstream reads them as unsigned and panics.
- **Server-supplied sizes** (`block.rs`, `internal_client_in.rs`, `io.rs`,
  `protocol.rs`, `types/mod.rs`, `types/deserialize/`). The fork rejects a
  block with rows and no columns, a type nested more than 64 levels, a
  `Decimal` scale above 76, a `DateTime64` precision above 9, a `DateTime` or
  `DateTime64` timezone that is a lone quote, a `FixedString` of size 0 or
  past the limit, decreasing array or map offsets, and a `LowCardinality`
  column with no dictionary. It limits `Tuple()` to 65,536 rows per block,
  because those rows carry no bytes. It limits what `String`, `FixedString`,
  and fixed-size columns and a `PartUUIDs` packet reserve before data arrives,
  and it removes the `unsafe` buffers from string reads. `Nullable` masks and decompression
  buffers still reserve up to 1 GiB and 4 GiB from a size the server sends.
- **No `Debug` on `ClientOptions`** (`client.rs`), because it holds the
  plaintext password.
- **Lint allow** (`lib.rs`). `#![allow(mismatched_lifetime_syntaxes)]`
  silences five warnings in unchanged upstream code.
- **Tests** for these patches are in `block.rs`, `client.rs`, and
  `types/tests.rs`.

To compare the fork with upstream:

```bash
curl -L https://crates.io/api/v1/crates/klickhouse/0.13.2/download | tar xz -C /tmp
diff -ru -x target -x Cargo.lock /tmp/klickhouse-0.13.2 vendor/klickhouse
```

Remove a patch when an upstream release includes the same fix.

## Development

### Requirements

- macOS with the Xcode command line tools. Tauri also builds for Linux
  and Windows, but nobody has tested those builds.
- Rust, installed with rustup. `rust-toolchain.toml` pins the version.
- Node 22.13 or later in the 22 line, or Node 24 or later. Some
  dependencies do not support Node 23. `.nvmrc` says `22`, so `nvm use`
  picks your newest Node 22. `.npmrc` sets `engine-strict`, so npm
  refuses other versions.
- npm. Bun writes a `bun.lockb` file that the repo does not use.

### Setup

```bash
git clone https://github.com/matiasdominguez/ch-gui.git
cd ch-gui
npm install
```

### Run in development

Reloads the UI and rebuilds the Rust backend on change:

```bash
npm run tauri dev
```

### Type-check and build

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

### Tests

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

## Connecting over TLS

- Use port `9440`.
- Turn on **Secure**.
- If a VPN or proxy between you and the server inspects TLS with a
  private CA, paste that CA's PEM into the connection's **Custom CA
  certificate** field. Otherwise the app trusts the macOS system
  certificates, and uses the bundled `webpki-roots` certificates only when
  it finds none.

## Repository layout

```
.
├── src/                          # React frontend
│   ├── App.tsx
│   ├── components/               # ConnectionList, SchemaTree, QueryEditor, …
│   ├── hooks/                    # useChFunctions, useKeyboardShortcuts, …
│   ├── lib/                      # Tauri wrappers, csv, sqlSplit, changelog, …
│   ├── state/                    # Zustand stores: connections, tabs, preferences
│   ├── test/                     # vitest setup and a shared render helper
│   └── types/
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml                # points klickhouse at ../vendor/klickhouse
│   ├── tests/                    # integration tests against a live ClickHouse
│   └── src/
│       ├── main.rs / lib.rs      # Tauri builder and plugin registration
│       ├── commands.rs           # #[tauri::command] handlers
│       ├── clickhouse/
│       │   ├── client.rs         # run and cancel queries, logs, monitoring queries
│       │   ├── tls.rs            # rustls config and custom CA loading
│       │   └── value.rs          # klickhouse Value → IPC cell
│       ├── pool.rs               # client pool per connection
│       ├── keychain.rs
│       ├── state.rs              # Tauri-managed state
│       └── error.rs
├── scripts/
│   ├── bump-version.sh           # sets the version in every release file
│   ├── docker-compose.test-ch.yml
│   ├── fetch-ch-functions.ts
│   └── smoke/                    # AppleScript UI smoke tests
└── vendor/klickhouse/            # vendored fork (see above)
```

## Out of scope

- EXPLAIN visualization
- Natural language to SQL
- Typed input fields for parameters

## License

ch-gui is under the [MIT license](LICENSE). The vendored `klickhouse` crate keeps
its own [MIT](vendor/klickhouse/LICENSE-MIT) and
[Apache 2.0](vendor/klickhouse/LICENSE-APACHE) licenses.
