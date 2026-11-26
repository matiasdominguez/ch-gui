import { describe, expect, it } from "vitest";

import { isNumericClickHouseType } from "./chartTypes";

describe("isNumericClickHouseType", () => {
  it.each([
    ["Int8"],
    ["Int32"],
    ["Int64"],
    ["Int128"],
    ["Int256"],
    ["UInt8"],
    ["UInt64"],
    ["Float32"],
    ["Float64"],
    ["Decimal(10, 2)"],
    ["Decimal32(4)"],
    ["Nullable(Int64)"],
    ["Nullable(Float32)"],
    ["Nullable(Decimal(10, 2))"],
  ])("matches %s", (t) => {
    expect(isNumericClickHouseType(t)).toBe(true);
  });

  it.each([
    ["String"],
    ["FixedString(16)"],
    ["Date"],
    ["DateTime"],
    ["DateTime64(3)"],
    ["UUID"],
    ["Bool"],
    ["LowCardinality(String)"],
    ["LowCardinality(UInt64)"],
    ["Map(String, UInt64)"],
    ["Array(Int32)"],
    ["Enum8('a' = 1)"],
    ["Tuple(Int32, String)"],
    [""],
  ])("rejects %s", (t) => {
    expect(isNumericClickHouseType(t)).toBe(false);
  });
});
