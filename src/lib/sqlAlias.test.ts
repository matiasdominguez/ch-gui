import { describe, expect, it } from "vitest";

import { extractAliases } from "./sqlAlias";

describe("extractAliases", () => {
  it("returns empty when no FROM/JOIN is present", () => {
    expect(extractAliases("SELECT 1")).toEqual(new Map());
  });

  it("extracts a bare FROM table and keys to itself", () => {
    const m = extractAliases("SELECT * FROM users");
    expect(m.get("users")).toEqual({ table: "users" });
    expect(m.size).toBe(1);
  });

  it("extracts a db-qualified table", () => {
    const m = extractAliases("SELECT * FROM app.users");
    expect(m.get("users")).toEqual({ db: "app", table: "users" });
  });

  it("extracts an explicit AS alias", () => {
    const m = extractAliases("SELECT * FROM users AS u WHERE 1");
    expect(m.get("u")).toEqual({ table: "users" });
    expect(m.get("users")).toEqual({ table: "users" });
  });

  it("extracts an implicit alias (no AS)", () => {
    const m = extractAliases("SELECT * FROM users u WHERE 1");
    expect(m.get("u")).toEqual({ table: "users" });
    expect(m.get("users")).toEqual({ table: "users" });
  });

  it("does NOT treat a trailing SQL keyword as an alias", () => {
    const m = extractAliases("SELECT * FROM users WHERE a = 1");
    expect(m.has("WHERE")).toBe(false);
    expect(m.get("users")).toEqual({ table: "users" });
  });

  it("keyword filtering is case-insensitive", () => {
    const m = extractAliases("SELECT * FROM users where a = 1");
    expect(m.has("where")).toBe(false);
  });

  it("handles JOIN with an alias", () => {
    const m = extractAliases(
      "SELECT * FROM users u JOIN events e ON u.id = e.user_id",
    );
    expect(m.get("u")).toEqual({ table: "users" });
    expect(m.get("e")).toEqual({ table: "events" });
  });

  it("keeps db on db-qualified aliased tables", () => {
    const m = extractAliases("SELECT * FROM app.users AS u");
    expect(m.get("u")).toEqual({ db: "app", table: "users" });
    expect(m.get("users")).toEqual({ db: "app", table: "users" });
  });

  it("last occurrence wins on alias collision (documented behavior)", () => {
    const m = extractAliases(
      "SELECT * FROM a_tbl x JOIN b_tbl x ON x.id = x.id",
    );
    expect(m.get("x")).toEqual({ table: "b_tbl" });
  });

  it("matches multiple JOINs in one query", () => {
    const m = extractAliases(
      "SELECT * FROM a JOIN b ON 1 JOIN c AS alias_c ON 1",
    );
    expect(m.get("a")).toEqual({ table: "a" });
    expect(m.get("b")).toEqual({ table: "b" });
    expect(m.get("c")).toEqual({ table: "c" });
    expect(m.get("alias_c")).toEqual({ table: "c" });
  });

  it("is case-insensitive on the FROM/JOIN keywords", () => {
    const m = extractAliases("select * from users u join events e on 1");
    expect(m.get("u")).toEqual({ table: "users" });
    expect(m.get("e")).toEqual({ table: "events" });
  });
});
