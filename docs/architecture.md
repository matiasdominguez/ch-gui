# Architecture

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
└── vendor/klickhouse/            # vendored fork
```
