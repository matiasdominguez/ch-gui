import { create } from "zustand";

import { deleteConnection, listConnections, upsertConnection } from "../lib/db";
import {
  deletePassword as kcDelete,
  loadPassword as kcLoad,
  savePassword as kcSave,
} from "../lib/tauri";
import type { Connection, ConnectionConfigPayload } from "../types";

// macOS can prompt the user on every keychain read, so passwords stay cached.
const passwordCache = new Map<string, string>();

const ACTIVE_KEY = "ch-gui-active-connection";
function readActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
function writeActive(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* Browser storage can throw, and the session works without it. */
  }
}

interface ConnectionsState {
  connections: Connection[];
  activeId: string | null;
  loaded: boolean;
  loadError: string | null;
  load: () => Promise<void>;
  /** `null` leaves the keychain alone, and an empty string deletes the entry. */
  save: (c: Connection, password: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  buildPayload: (id: string) => Promise<ConnectionConfigPayload>;
  disableFanout: (id: string) => Promise<boolean>;
}

export const useConnections = create<ConnectionsState>((set, get) => ({
  connections: [],
  activeId: null,
  loaded: false,
  loadError: null,
  async load() {
    try {
      const connections = await listConnections();
      const stored = readActive();
      const activeId =
        get().activeId ??
        (connections.some((c) => c.id === stored) ? stored : null) ??
        connections[0]?.id ??
        null;
      writeActive(activeId);
      set({ connections, activeId, loaded: true, loadError: null });
    } catch (err: unknown) {
      const e = err as { message?: string };
      set({ loadError: e.message ?? String(err) });
    }
  },
  async save(c, password) {
    const isNew = !get().connections.some((x) => x.id === c.id);
    await upsertConnection(c);
    if (password === null) {
      // Null leaves the stored password alone; deleting here would wipe it.
    } else if (password.length > 0) {
      await kcSave(c.id, password);
      passwordCache.set(c.id, password);
    } else {
      await kcDelete(c.id);
      passwordCache.set(c.id, "");
    }
    const connections = await listConnections();
    const activeId = isNew ? c.id : (get().activeId ?? c.id);
    writeActive(activeId);
    set({ connections, activeId });
  },
  async remove(id) {
    await deleteConnection(id);
    await kcDelete(id);
    passwordCache.delete(id);
    const connections = await listConnections();
    const activeId =
      get().activeId === id ? (connections[0]?.id ?? null) : get().activeId;
    writeActive(activeId);
    set({ connections, activeId });
  },
  setActive(id) {
    writeActive(id);
    set({ activeId: id });
  },
  async disableFanout(id) {
    const c = get().connections.find((x) => x.id === id);
    if (!c || c.clusterFanout === false) return false;
    await get().save({ ...c, clusterFanout: false }, null);
    return true;
  },
  async buildPayload(id) {
    const c = get().connections.find((x) => x.id === id);
    if (!c) throw new Error(`unknown connection ${id}`);
    let password = passwordCache.get(c.id);
    if (password === undefined) {
      password = (await kcLoad(c.id)) ?? "";
      passwordCache.set(c.id, password);
    }
    return {
      id: c.id,
      host: c.host,
      port: c.port,
      user: c.user,
      password,
      secure: c.secure,
      default_database: c.defaultDatabase,
      custom_ca_pem: c.customCaPem,
      cluster_name: c.clusterName,
      cluster_fanout: c.clusterFanout,
    };
  },
}));
