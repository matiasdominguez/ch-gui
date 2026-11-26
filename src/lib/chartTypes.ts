/** Omits LowCardinality, Map, Array, and Enum. Users can cast those in SQL. */
const NUMERIC_TYPE_RE =
  /^(Nullable\()?(U?Int(8|16|32|64|128|256)|Float(32|64)|Decimal)/;

export function isNumericClickHouseType(type: string): boolean {
  return NUMERIC_TYPE_RE.test(type);
}
