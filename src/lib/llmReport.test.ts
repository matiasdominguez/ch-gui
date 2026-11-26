import { describe, expect, it } from "vitest";

import type { ConnectionConfigPayload, MvFailure, ServerError } from "../types";
import {
  llmReport,
  mvFailureReport,
  serverErrorReport,
  type ErrorDetail,
} from "./llmReport";

const CONN = { id: "c1" } as ConnectionConfigPayload;
const DETAIL: ErrorDetail = {
  sql: "SELECT foo FROM t LIMIT 10000\n",
  queryId: "0b7e7a52-1111-2222-3333-444455556666",
  message: "Code: 47. DB::Exception: Unknown identifier foo",
  statement: null,
  conn: CONN,
};

describe("llmReport", () => {
  it("lays out versions, the query_log pointer, SQL, and error", () => {
    expect(llmReport(DETAIL, { server: "26.3.33.24", app: "0.2.15" })).toBe(
      [
        "A ClickHouse query failed. Explain the error and fix the query.",
        "",
        "ClickHouse server: 26.3.33.24",
        "Client: ch-gui 0.2.15",
        "In system.query_log: WHERE query LIKE '%chgui:0b7e7a52-1111-2222-3333-444455556666%'",
        "",
        "SQL:",
        "```sql",
        "SELECT foo FROM t LIMIT 10000",
        "```",
        "",
        "Error:",
        "```",
        "Code: 47. DB::Exception: Unknown identifier foo",
        "```",
      ].join("\n"),
    );
  });

  it("names the failed statement of a script", () => {
    const out = llmReport({ ...DETAIL, statement: { idx: 2, total: 5 } }, {});
    expect(out).toContain("Failed at statement 2 of 5.");
  });

  it("says unknown when the versions haven't loaded", () => {
    const out = llmReport(DETAIL, {});
    expect(out).toContain("ClickHouse server: unknown");
    expect(out).toContain("Client: ch-gui unknown");
  });

  it("keeps ClickHouse's full stack trace", () => {
    const message = [
      "server exception: 47 DB::Exception: Unknown expression identifier `x`",
      "0. DB::Exception::Exception(DB::Exception::MessageMasked&&, int, bool) @ 0x0000000014112690",
      "23. ? @ 0x00000000000803c8",
    ].join("\n");
    expect(llmReport({ ...DETAIL, message }, {})).toContain(
      "```\n" + message + "\n```",
    );
  });

  it("handles long SQL full of backtick-quoted identifiers", () => {
    const sql = "SELECT " + Array(200_000).fill("`c`").join(", ");
    const out = llmReport({ ...DETAIL, sql }, {});
    expect(out).toContain("```sql\nSELECT `c`, `c`");
  });

  it("uses a longer fence when the text contains one", () => {
    const out = llmReport({ ...DETAIL, sql: "SELECT '```' AS x" }, {});
    expect(out).toContain("````sql\nSELECT '```' AS x\n````");
  });
});

describe("serverErrorReport", () => {
  const LOCAL = { cluster_fanout: false, cluster_name: null };
  const err: ServerError = {
    name: "NETWORK_ERROR",
    code: 210,
    count: 379,
    last_error_time: "2026-09-27 17:02:44",
    last_error_message: "Connection reset by peer, while reading from socket",
    remote: false,
    recent: false,
  };

  it("lays out the error, its count, when it fired, and a query_log lookup", () => {
    const r = serverErrorReport(
      err,
      { server: "26.3.1", app: "0.2.16" },
      LOCAL,
    );
    expect(r).toContain("ClickHouse server: 26.3.1\nClient: ch-gui 0.2.16");
    expect(r).toContain("Error: NETWORK_ERROR (code 210)");
    expect(r).toContain("Count: 379 since the server started (system.errors)");
    expect(r).toContain("Last seen: 2026-09-27 17:02:44 (UTC)");
    expect(r).toContain(
      "```\nConnection reset by peer, while reading from socket\n```",
    );
    expect(r).toContain(
      "WHERE exception_code = 210 AND event_date >= today() - 7",
    );
    expect(r).not.toContain("remote server");
  });

  it("notes an error received from a remote server", () => {
    const r = serverErrorReport({ ...err, remote: true }, {}, LOCAL);
    expect(r).toContain("Received from a remote server");
    expect(r).toContain("ClickHouse server: unknown");
  });

  it("fences a message that contains backticks, and fills an empty one", () => {
    expect(
      serverErrorReport(
        { ...err, last_error_message: "bad ```x``` here" },
        {},
        LOCAL,
      ),
    ).toContain("````\nbad ```x``` here\n````");
    expect(
      serverErrorReport({ ...err, last_error_message: "" }, {}, LOCAL),
    ).toContain("```\n(no message)\n```");
  });

  it("reads every replica's query_log when the panel fans out", () => {
    const r = serverErrorReport(
      err,
      {},
      {
        cluster_fanout: true,
        cluster_name: "prod_1",
      },
    );
    expect(r).toContain("FROM clusterAllReplicas('prod_1', system.query_log)");
    expect(r).toContain("SELECT hostName() AS host, event_time");
    expect(r).toContain("needs the REMOTE grant");
    expect(r).toContain(
      "Count: 379, summed over replicas since each server started",
    );
    expect(r).not.toContain("FROM system.query_log\n");
  });

  it("falls back to the {cluster} macro, as the backend does", () => {
    for (const cluster_name of [null, "", "bad'name"]) {
      expect(
        serverErrorReport(err, {}, { cluster_fanout: true, cluster_name }),
      ).toContain("clusterAllReplicas('{cluster}', system.query_log)");
    }
  });
});

describe("mvFailureReport", () => {
  const LOCAL = { cluster_fanout: false, cluster_name: null };
  const f: MvFailure = {
    event_time: "2026-09-27 18:00:01",
    view_name: "smoke.audit_mv",
    view_type: "Materialized",
    status: "ExceptionWhileProcessing",
    exception: "Code: 395. DB::Exception: audit rule failed",
    initial_query_id: "q-42",
    initial_query: "INSERT INTO smoke.orders VALUES (1, 2)",
    recent: false,
  };

  it("lays out the view, the exception, the INSERT, and the lookups", () => {
    const r = mvFailureReport(f, { server: "26.3.1", app: "0.2.18" }, LOCAL);
    expect(r).toContain("ClickHouse server: 26.3.1\nClient: ch-gui 0.2.18");
    expect(r).toContain("View: smoke.audit_mv (Materialized)");
    expect(r).toContain("Status: ExceptionWhileProcessing");
    expect(r).toContain("INSERT query_id: q-42");
    expect(r).toContain(
      "```\nCode: 395. DB::Exception: audit rule failed\n```",
    );
    expect(r).toContain("```sql\nINSERT INTO smoke.orders VALUES (1, 2)\n```");
    expect(r).toContain(
      "FROM system.tables\nWHERE concat(database, '.', name) = 'smoke.audit_mv'",
    );
    expect(r).toContain(
      "FROM system.query_views_log\nWHERE view_name = 'smoke.audit_mv'",
    );
  });

  it("cuts a huge INSERT and says how long it was", () => {
    const big = "INSERT INTO t VALUES " + "(1),".repeat(3000);
    const r = mvFailureReport({ ...f, initial_query: big }, {}, LOCAL);
    expect(r).toContain(`… (cut; ${big.length} characters in all)`);
    expect(r).not.toContain(big);
  });

  it("separates the two lookups with a blank line", () => {
    expect(mvFailureReport(f, {}, LOCAL)).toContain(
      "```\n\nIts failures in the last 7 days:",
    );
  });

  it("says when the INSERT hasn't reached query_log", () => {
    const r = mvFailureReport({ ...f, initial_query: "" }, {}, LOCAL);
    expect(r).toContain("The triggering INSERT isn't in query_log yet.");
  });

  it("escapes names in the lookups and keeps dotted names whole", () => {
    const r = mvFailureReport({ ...f, view_name: "db.it's" }, {}, LOCAL);
    expect(r).toContain("= 'db.it\\'s'");
    const dotted = mvFailureReport(
      { ...f, view_name: "analytics.prod.audit_mv" },
      {},
      LOCAL,
    );
    expect(dotted).toContain(
      "WHERE concat(database, '.', name) = 'analytics.prod.audit_mv'",
    );
  });

  it("reads every replica's log when the panel fans out", () => {
    const r = mvFailureReport(
      f,
      {},
      {
        cluster_fanout: true,
        cluster_name: "prod_1",
      },
    );
    expect(r).toContain(
      "FROM clusterAllReplicas('prod_1', system.query_views_log)",
    );
    expect(r).toContain(
      "SELECT hostName() AS host, create_table_query\nFROM clusterAllReplicas('prod_1', system.tables)",
    );
    expect(r).toContain("needs the REMOTE grant");
  });
});
