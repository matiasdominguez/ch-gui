use ch_gui_lib::clickhouse::client::Client;
use ch_gui_lib::clickhouse::value::CellValue;

mod common;

const SETS_TYPED: &str = "Array(Tuple(a LowCardinality(String), b LowCardinality(String), c String, items Array(Tuple(k LowCardinality(String), b LowCardinality(String), v String))))";

async fn run(client: &Client, tag: &str, sql: &str) -> Result<usize, String> {
    client
        .run_query(sql, tag, None)
        .await
        .map(|r| r.rows.len())
        .map_err(|e| e.to_string())
}

#[tokio::test]
async fn named_tuples_decode() {
    let Some(client) = common::try_connect().await else {
        return;
    };
    run(
        &client,
        "test-types",
        "DROP TABLE IF EXISTS chgui_named_tuple",
    )
    .await
    .unwrap();
    run(
        &client,
        "test-types",
        &format!("CREATE TABLE chgui_named_tuple (t DateTime64(3), sets {SETS_TYPED}) ENGINE = MergeTree ORDER BY t"),
    )
    .await
    .unwrap();
    run(
        &client,
        "test-types",
        "INSERT INTO chgui_named_tuple VALUES \
         (now64(3), [('v1', 'stable', 'fp-1', [('e1', 'stable', '1'), ('f1', 'beta', 'x')])]), \
         (now64(3), [('v2', 'beta', 'fp-2', [])]), \
         (now64(3), [])",
    )
    .await
    .unwrap();

    for (label, sql, rows) in [
        ("whole column", "SELECT sets FROM chgui_named_tuple", 3),
        (
            "nested items array",
            "SELECT sets[1].items FROM chgui_named_tuple",
            3,
        ),
        (
            "named tuple literal",
            "SELECT CAST(('a', 'b'), 'Tuple(x String, y String)')",
            1,
        ),
        (
            "backtick field name",
            "SELECT CAST((1, 'b'), 'Tuple(`my field` UInt8, y String)')",
            1,
        ),
        (
            "Array(named Tuple)",
            "SELECT CAST([('a', 'b')], 'Array(Tuple(x String, y String))')",
            1,
        ),
    ] {
        assert_eq!(
            run(&client, "test-types", sql)
                .await
                .unwrap_or_else(|e| panic!("{label}: {e}")),
            rows,
            "{label}"
        );
    }
    assert_eq!(run(&client, "test-types", "SELECT 1").await.unwrap(), 1);
    run(
        &client,
        "test-types",
        "DROP TABLE IF EXISTS chgui_named_tuple",
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn enums_decode_as_labels() {
    let Some(client) = common::try_connect().await else {
        return;
    };
    let res = client
        .run_query(
            "SELECT \
                CAST('TOO_MANY_ROWS', 'Enum8(''TIMEOUT_EXCEEDED'' = 1, ''TOO_MANY_ROWS'' = 2)') AS e8, \
                CAST(NULL, 'Nullable(Enum8(''a'' = 1))') AS n, \
                CAST('b', 'Enum16(''a'' = -5, ''b'' = 300)') AS e16, \
                CAST('it''s, (x)', 'Enum8(''it''''s, (x)'' = 1)') AS tricky",
            "test-enum",
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        res.rows[0],
        vec![
            CellValue::Str("TOO_MANY_ROWS".into()),
            CellValue::Null,
            CellValue::Str("b".into()),
            CellValue::Str("it's, (x)".into()),
        ]
    );
    assert!(run(
        &client,
        "test-types",
        "SELECT type FROM system.projections LIMIT 1"
    )
    .await
    .is_ok());
    assert_eq!(run(&client, "test-types", "SELECT 1").await.unwrap(), 1);
}

#[tokio::test]
async fn composites_render_like_clickhouse_client() {
    let Some(client) = common::try_connect().await else {
        return;
    };
    let res = client
        .run_query(
            "SELECT \
                [toDate('2024-04-05'), toDate('2024-04-06')] AS dates, \
                (toDateTime64('2024-04-05 10:20:30.123', 3, 'UTC'), 'José') AS pair, \
                map('k', CAST('B' AS Enum8('A' = 0, 'B' = 1))) AS labels, \
                [NULL, toDateTime('2024-04-05 10:20:30', 'UTC')] AS nullable",
            "test-composite",
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        res.rows[0],
        vec![
            CellValue::Other("['2024-04-05','2024-04-06']".into()),
            CellValue::Other("('2024-04-05 10:20:30.123','José')".into()),
            CellValue::Other("{'k':'B'}".into()),
            CellValue::Other("[NULL,'2024-04-05 10:20:30']".into()),
        ]
    );
    // "Copy as SQL VALUES" depends on invalid UTF-8 round-tripping through `\xNN`.
    let res = client
        .run_query("SELECT [unhex('FF61')] AS raw", "test-composite", None)
        .await
        .unwrap();
    let CellValue::Other(literal) = &res.rows[0][0] else {
        panic!("expected Other, got {:?}", res.rows[0][0]);
    };
    assert_eq!(literal, r"['\xFFa']");
    let res = client
        .run_query(
            &format!("SELECT hex(arrayJoin({literal})) AS h"),
            "test-composite",
            None,
        )
        .await
        .unwrap();
    assert_eq!(res.rows[0][0], CellValue::Str("FF61".into()));
}

#[tokio::test]
async fn decimals_keep_their_point() {
    let Some(client) = common::try_connect().await else {
        return;
    };
    let res = client
        .run_query(
            "SELECT \
                toDecimal64('0.05', 2), \
                toDecimal32('-0.05', 2), \
                toDecimal128('-1.5', 2), \
                toDecimal128('12176604855658925139400819154902602262', 0), \
                toDecimal256('-123.456', 3), \
                [toDecimal64('0.05', 2)], \
                toInt256(-5), \
                toUInt256('115792089237316195423570985008687907853269984665640564039457584007913129639935')",
            "test-decimal",
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        res.rows[0],
        vec![
            CellValue::Decimal("0.05".into()),
            CellValue::Decimal("-0.05".into()),
            CellValue::Decimal("-1.50".into()),
            CellValue::Decimal("12176604855658925139400819154902602262".into()),
            CellValue::Decimal("-123.456".into()),
            CellValue::Other("[0.05]".into()),
            CellValue::BigInt("-5".into()),
            CellValue::BigInt(
                "115792089237316195423570985008687907853269984665640564039457584007913129639935"
                    .into()
            ),
        ]
    );
}

#[tokio::test]
async fn non_utf8_names_and_errors_decode() {
    let Some(client) = common::try_connect().await else {
        return;
    };
    let res = client
        .run_query(r"SELECT ['\xFF'], ['\xFE']", "test-non-utf8", None)
        .await
        .unwrap();
    let names: Vec<_> = res.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, [r"['\xFF']", r"['\xFE']"]);
    assert_eq!(res.rows[0].len(), 2);

    let res = client
        .run_query(
            r"SELECT 1, 1, 7 AS `\xFF`, 8 AS `\\xFF`",
            "test-non-utf8",
            None,
        )
        .await
        .unwrap();
    let names: Vec<_> = res.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["1", "1 (2)", r"\xFF", r"\xFF (2)"]);
    assert_eq!(
        res.rows[0],
        [
            CellValue::Int(1),
            CellValue::Int(1),
            CellValue::Int(7),
            CellValue::Int(8)
        ]
    );

    let err = client
        .run_query(r"SELECT throwIf(1, 'bad \xFF byte')", "test-non-utf8", None)
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains(r"bad \xFF byte"), "{err}");
    assert_eq!(run(&client, "test-types", "SELECT 1").await.unwrap(), 1);
}

const COLUMN_TYPES: &[&str] = &[
    "Nullable(String)",
    "String",
    "Nullable(Float64)",
    "UInt64",
    "LowCardinality(String)",
    "Float64",
    "LowCardinality(Nullable(String))",
    "Nullable(DateTime64(3, 'UTC'))",
    "Nullable(Int64)",
    "DateTime64(3, 'UTC')",
    "Date",
    "Decimal(38, 2)",
    "DateTime",
    "UInt32",
    "Int32",
    "Nullable(DateTime64(3))",
    "Float32",
    "Nullable(Int32)",
    "Nullable(Float32)",
    "Nullable(UInt64)",
    "JSON",
    "Nullable(UInt32)",
    "Decimal(18, 2)",
    "UInt8",
    "Array(String)",
    "DateTime64(3)",
    "AggregateFunction(uniqCombined(12), Nullable(String))",
    "Nullable(Decimal(18, 2))",
    "AggregateFunction(max, DateTime64(3, 'UTC'))",
    "AggregateFunction(argMax, Nullable(String), Tuple(DateTime64(3, 'UTC'), Nullable(String)))",
    "Nullable(DateTime)",
    "SimpleAggregateFunction(max, Float64)",
    "Nullable(UInt8)",
    "Nullable(Decimal(18, 6))",
    "Nullable(DateTime('UTC'))",
    "UUID",
    "AggregateFunction(count)",
    "AggregateFunction(countIf, UInt8)",
    "DateTime('UTC')",
    "Nullable(Date)",
    "Nullable(Bool)",
    "Array(Tuple(a LowCardinality(String), b LowCardinality(String), c String, items Array(Tuple(k LowCardinality(String), b LowCardinality(String), v String))))",
    "Array(Tuple(a LowCardinality(String), b LowCardinality(String), c String, items Array(Tuple(k LowCardinality(String), b LowCardinality(String), h String, v String))))",
    "Array(LowCardinality(Nullable(String)))",
    "AggregateFunction(max, Float64)",
    "Map(LowCardinality(String), Float64)",
    "Map(String, String)",
    "AggregateFunction(min, Float64)",
    "AggregateFunction(quantilesIf(0.25, 0.5, 0.75, 0.9, 0.99), Float64, UInt8)",
    "UInt16",
    "Int64",
    "Decimal(38, 0)",
    "AggregateFunction(sum, Float64)",
    "DateTime64(6, 'UTC')",
    "Array(Date)",
    "Array(LowCardinality(String))",
    "Map(LowCardinality(String), Float32)",
    "Nullable(UUID)",
    "Array(UInt32)",
    "Array(Nullable(Float64))",
    "Enum8('a' = 1, 'b' = 2, 'c' = 3, 'd' = 4, 'e' = 5, 'f' = 6)",
    "AggregateFunction(uniqHLL12, Nullable(String))",
    "DateTime64(9)",
    "Enum8('a, b' = 1, 'it''s' = 2, 'c' = 3)",
    "Array(Float32)",
    "Decimal(19, 2)",
    "Enum8('zero' = 0, 'one' = 1, 'two' = 2, 'three' = 3)",
];

fn split_top_level(s: &str) -> Vec<String> {
    let (mut out, mut cur, mut depth, mut quoted) = (Vec::new(), String::new(), 0, false);
    for c in s.chars() {
        match c {
            '\'' => quoted = !quoted,
            '(' if !quoted => depth += 1,
            ')' if !quoted => depth -= 1,
            ',' if !quoted && depth == 0 => {
                out.push(cur.trim().to_string());
                cur.clear();
                continue;
            }
            _ => {}
        }
        cur.push(c);
    }
    out.push(cur.trim().to_string());
    out
}

/// `generateRandom` cannot make JSON or aggregate states, so those types get literal rows and
/// `-State` combinators.
fn fill_sql(table: &str, ty: &str) -> String {
    let quote = |s: &str| format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"));
    if ty == "JSON" {
        return format!(
            r#"INSERT INTO {table} SELECT arrayJoin(['{{"a":1,"b":{{"c":"x","d":[1,2]}}}}', '{{"e":null,"f":1.5}}'])::JSON"#
        );
    }
    let Some(inner) = ty
        .strip_prefix("AggregateFunction(")
        .and_then(|s| s.strip_suffix(')'))
    else {
        return format!(
            "INSERT INTO {table} SELECT * FROM generateRandom({}, 7, 8, 3) LIMIT 40",
            quote(&format!("c {ty}"))
        );
    };
    let parts = split_top_level(inner);
    let (func, args) = parts.split_first().unwrap();
    let (name, params) = func.split_at(func.find('(').unwrap_or(func.len()));
    if args.is_empty() {
        return format!(
            "INSERT INTO {table} SELECT {name}State{params}() FROM numbers(50) GROUP BY number % 10"
        );
    }
    let structure: Vec<_> = args
        .iter()
        .enumerate()
        .map(|(i, a)| format!("a{i} {a}"))
        .collect();
    let call: Vec<_> = (0..args.len()).map(|i| format!("a{i}")).collect();
    format!(
        "INSERT INTO {table} SELECT {name}State{params}({}) \
         FROM (SELECT * FROM generateRandom({}, 7, 8, 3) LIMIT 200) \
         GROUP BY cityHash64(a0) % 10",
        call.join(", "),
        quote(&structure.join(", "))
    )
}

fn is_plain_number(s: &str) -> bool {
    let digits = |d: &str| !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit());
    let s = s.strip_prefix('-').unwrap_or(s);
    match s.split_once('.') {
        Some((int, frac)) => digits(int) && digits(frac),
        None => digits(s),
    }
}

async fn count(client: &Client, table: &str) -> usize {
    let res = client
        .run_query(&format!("SELECT count() FROM {table}"), "test-types", None)
        .await
        .unwrap();
    match res.rows[0][0] {
        CellValue::Int(n) => n as usize,
        ref c => panic!("count() returned {c:?}"),
    }
}

#[tokio::test]
async fn every_production_type_decodes() {
    let Some(setup) = common::try_connect().await else {
        return;
    };
    let mut failures = Vec::new();
    for (i, ty) in COLUMN_TYPES.iter().enumerate() {
        let table = format!("chgui_type_{i}");
        for sql in [
            format!("DROP TABLE IF EXISTS {table}"),
            format!("CREATE TABLE {table} (c {ty}) ENGINE = Memory"),
            fill_sql(&table, ty),
        ] {
            if let Err(e) = run(&setup, "test-types", &sql).await {
                panic!("setup for {ty} failed: {e}\n{sql}");
            }
        }
        let expected = count(&setup, &table).await;
        assert!(expected > 0, "{ty}: setup inserted no rows");

        // An AggregateFunction column closes the connection it fails on, so each type gets a fresh client.
        let client = common::try_connect().await.unwrap();
        let got = client
            .run_query(&format!("SELECT c FROM {table}"), "test-types", None)
            .await;
        if ty.starts_with("AggregateFunction(") {
            match got {
                Err(e) if e.to_string().contains("finalizeAggregation") => {}
                Err(e) => failures.push(format!("{ty}: unexpected error {e}")),
                Ok(_) => failures.push(format!("{ty}: decoded a raw aggregate state")),
            }
            let client = common::try_connect().await.unwrap();
            let sql = format!("SELECT finalizeAggregation(c) FROM {table}");
            match run(&client, "test-types", &sql).await {
                Ok(n) if n == expected => {}
                Ok(n) => failures.push(format!("{ty}: finalized {n} rows, expected {expected}")),
                Err(e) => failures.push(format!("{ty}: finalizeAggregation failed: {e}")),
            }
        } else {
            match got {
                Ok(res) if res.rows.len() == expected => {
                    let leak = res.rows.iter().find_map(|r| match &r[0] {
                        CellValue::Other(s)
                            if ["makeDate(", "parseDateTime", "toUUID("]
                                .iter()
                                .any(|m| s.contains(m)) =>
                        {
                            Some(s.clone())
                        }
                        _ => None,
                    });
                    if let Some(s) = leak {
                        failures.push(format!("{ty}: rendered as SQL: {s}"));
                    }
                    let bad_number = res.rows.iter().find_map(|r| match &r[0] {
                        CellValue::Decimal(s) | CellValue::BigInt(s) if !is_plain_number(s) => {
                            Some(s.clone())
                        }
                        _ => None,
                    });
                    if let Some(s) = bad_number {
                        failures.push(format!("{ty}: malformed number {s}"));
                    }
                }
                Ok(res) => failures.push(format!(
                    "{ty}: {} rows, expected {expected}",
                    res.rows.len()
                )),
                Err(e) => failures.push(format!("{ty}: {e}")),
            }
        }
        run(&setup, "test-types", &format!("DROP TABLE {table}"))
            .await
            .unwrap();
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
    assert_eq!(COLUMN_TYPES.len(), 67);
}
