import { describe, expect, it } from "vitest";

import { innerTables, tableKind } from "./tableKind";

describe("tableKind", () => {
  it("names each relation in words", () => {
    expect(tableKind("MergeTree")).toBe("Table");
    expect(tableKind("View")).toBe("View");
    expect(tableKind("MaterializedView")).toBe("Materialized view");
    expect(tableKind("Kafka")).toBe("Kafka queue");
    expect(tableKind("Dictionary")).toBe("Dictionary");
  });

  it("finds materialized views' storage tables, and only those", () => {
    const uuid = ".inner_id.e216f127-5a2c-4fa8-b64f-d0c71db1ed3e";
    expect(
      innerTables([
        { name: "daily_mv", engine: "MaterializedView" },
        { name: uuid, engine: "MergeTree" },
        { name: ".inner.daily_mv", engine: "MergeTree" },
        { name: ".inner.reports", engine: "MergeTree" },
        { name: ".inner_id.archive", engine: "MergeTree" },
        { name: "orders", engine: "MergeTree" },
      ]),
    ).toEqual(new Set([uuid, ".inner.daily_mv"]));
  });
});
