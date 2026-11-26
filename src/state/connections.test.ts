import { beforeEach, describe, expect, it, vi } from "vitest";

import { useConnections } from "./connections";
import { listConnections } from "../lib/db";
import {
  deletePassword as kcDelete,
  savePassword as kcSave,
} from "../lib/tauri";
import type { Connection } from "../types";

vi.mock("../lib/db", () => ({
  listConnections: vi.fn().mockResolvedValue([]),
  upsertConnection: vi.fn().mockResolvedValue(undefined),
  deleteConnection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/tauri", () => ({
  savePassword: vi.fn().mockResolvedValue(undefined),
  deletePassword: vi.fn().mockResolvedValue(undefined),
  loadPassword: vi.fn().mockResolvedValue(null),
}));

const CONN: Connection = {
  id: "c1",
  name: "Prod",
  host: "ch.example.com",
  port: 9440,
  user: "reader",
  secure: true,
  defaultDatabase: null,
  customCaPem: null,
  clusterName: null,
  clusterFanout: true,
};

describe("useConnections.save keychain semantics", () => {
  beforeEach(() => {
    vi.mocked(kcSave).mockClear();
    vi.mocked(kcDelete).mockClear();
  });

  it("null password leaves the keychain completely untouched", async () => {
    await useConnections.getState().save(CONN, null);
    expect(kcSave).not.toHaveBeenCalled();
    expect(kcDelete).not.toHaveBeenCalled();
  });

  it("empty string is an explicit blank and deletes the entry", async () => {
    await useConnections.getState().save(CONN, "");
    expect(kcDelete).toHaveBeenCalledWith("c1");
    expect(kcSave).not.toHaveBeenCalled();
  });

  it("non-empty password is stored", async () => {
    await useConnections.getState().save(CONN, "s3cret");
    expect(kcSave).toHaveBeenCalledWith("c1", "s3cret");
    expect(kcDelete).not.toHaveBeenCalled();
  });
});

describe("useConnections active connection", () => {
  const STAGING: Connection = { ...CONN, id: "c2", name: "Staging" };
  beforeEach(() => {
    localStorage.clear();
    useConnections.setState({ connections: [], activeId: null, loaded: false });
  });

  it("makes a newly added connection active, and remembers it", async () => {
    vi.mocked(listConnections).mockResolvedValue([CONN]);
    await useConnections.getState().save(CONN, null);
    expect(useConnections.getState().activeId).toBe("c1");

    vi.mocked(listConnections).mockResolvedValue([CONN, STAGING]);
    await useConnections.getState().save(STAGING, null);
    expect(useConnections.getState().activeId).toBe("c2");
    expect(localStorage.getItem("ch-gui-active-connection")).toBe("c2");
  });

  it("leaves the active connection alone when one is edited", async () => {
    vi.mocked(listConnections).mockResolvedValue([CONN, STAGING]);
    useConnections.setState({ connections: [CONN, STAGING], activeId: "c2" });
    await useConnections.getState().save({ ...CONN, name: "Prod EU" }, null);
    expect(useConnections.getState().activeId).toBe("c2");
  });

  it("restores the last active connection on launch", async () => {
    localStorage.setItem("ch-gui-active-connection", "c2");
    vi.mocked(listConnections).mockResolvedValue([CONN, STAGING]);
    await useConnections.getState().load();
    expect(useConnections.getState().activeId).toBe("c2");
  });

  it("falls back to the first connection when the saved one is gone", async () => {
    localStorage.setItem("ch-gui-active-connection", "deleted-id");
    vi.mocked(listConnections).mockResolvedValue([CONN, STAGING]);
    await useConnections.getState().load();
    expect(useConnections.getState().activeId).toBe("c1");
  });
});
