import {
  Alert,
  Button,
  Checkbox,
  Group,
  NumberInput,
  PasswordInput,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { CaretRightIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";

import {
  defaultPort,
  isLoopbackHost,
  normalizeHost,
  portAfterTlsToggle,
  TLS_PORT,
} from "../lib/connectionHost";
import { notifyError } from "../lib/notify";
import { loadPassword, testConnection } from "../lib/tauri";
import { useConnections } from "../state/connections";
import type { Connection } from "../types";

interface Props {
  initial?: Connection | null;
  onClose: () => void;
}

type RequiredField = "name" | "host" | "user";

export function ConnectionForm({ initial, onClose }: Props) {
  const save = useConnections((s) => s.save);

  const isEditing = Boolean(initial);

  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState<number>(initial?.port ?? TLS_PORT);
  const [user, setUser] = useState(initial?.user ?? "");
  const [password, setPassword] = useState("");
  const [secure, setSecure] = useState(initial?.secure ?? true);
  const [defaultDatabase, setDefaultDatabase] = useState(
    initial?.defaultDatabase ?? "",
  );
  const [customCaPem, setCustomCaPem] = useState(initial?.customCaPem ?? "");
  const [clusterName, setClusterName] = useState(initial?.clusterName ?? "");
  const [clusterFanout, setClusterFanout] = useState<boolean>(
    initial?.clusterFanout ?? true,
  );
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(initial?.customCaPem) ||
      Boolean(initial?.clusterName) ||
      initial?.clusterFanout === false,
  );
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState<Set<RequiredField>>(new Set());
  // True once the password field shows the user's intent: they typed in it, or
  // the Keychain read finished. Until then "" only means the read is pending or
  // was denied, and saving must not treat it as "delete the password".
  const passwordKnownRef = useRef(!initial);

  useEffect(() => {
    if (!initial) return;
    loadPassword(initial.id)
      .then((p) => {
        if (passwordKnownRef.current) return;
        passwordKnownRef.current = true;
        if (p) setPassword(p);
      })
      .catch(() => {
        // The Keychain read failed or was denied. The intent stays unknown, so
        // Save keeps the stored secret.
      });
  }, [initial]);

  function buildConnection(): Connection {
    return {
      id: initial?.id ?? uuid(),
      name: name.trim(),
      host: normalizeHost(host),
      port,
      user: user.trim(),
      secure,
      defaultDatabase: defaultDatabase.trim() || null,
      customCaPem: customCaPem.trim() || null,
      clusterName: clusterName.trim() || null,
      clusterFanout,
    };
  }

  function buildPayload(c: Connection) {
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
  }

  async function onTest() {
    setTesting(true);
    try {
      const c = buildConnection();
      await testConnection(buildPayload(c));
      notifications.show({
        color: "teal",
        title: "Connection OK",
        message: "SELECT 1 succeeded.",
      });
    } catch (err: unknown) {
      const e = err as { message?: string };
      notifyError("Connection failed", e.message ?? String(err));
    } finally {
      setTesting(false);
    }
  }

  function clearMissing(field: RequiredField) {
    if (!missing.has(field)) return;
    const next = new Set(missing);
    next.delete(field);
    setMissing(next);
  }

  async function onSave() {
    if (saving) return;
    const c = buildConnection();
    const empty = new Set<RequiredField>(
      (["name", "host", "user"] as const).filter((f) => !c[f]),
    );
    setMissing(empty);
    if (empty.size) return;
    setSaving(true);
    try {
      // null leaves the Keychain alone, "" deletes the password, and any other
      // value stores it.
      await save(c, passwordKnownRef.current ? password : null);
      notifications.show({
        color: "teal",
        title: isEditing ? "Connection updated" : "Connection saved",
        message: c.name,
      });
      onClose();
    } catch (err: unknown) {
      const e = err as { message?: string };
      notifyError("Save failed", e.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  const canTest = Boolean(host.trim() && user.trim());

  return (
    <Stack
      component="form"
      gap="sm"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
    >
      <TextInput
        label="Name"
        placeholder="e.g. Production"
        value={name}
        onChange={(e) => {
          setName(e.currentTarget.value);
          clearMissing("name");
        }}
        error={missing.has("name") && "Enter a name"}
        // `required` would let the browser block the submit before onSave shows
        // its inline errors.
        withAsterisk
        data-autofocus
      />
      <Group grow align="start">
        <TextInput
          label="Host"
          placeholder="clickhouse.example.com"
          value={host}
          onChange={(e) => {
            setHost(e.currentTarget.value);
            clearMissing("host");
          }}
          onBlur={() => setHost(normalizeHost(host))}
          error={missing.has("host") && "Enter a host"}
          withAsterisk
        />
        <NumberInput
          label="Port"
          value={port}
          onChange={(v) =>
            setPort(typeof v === "number" ? v : defaultPort(secure))
          }
          min={1}
          max={65535}
          allowDecimal={false}
        />
      </Group>
      <Group grow align="start">
        <TextInput
          label="User"
          value={user}
          onChange={(e) => {
            setUser(e.currentTarget.value);
            clearMissing("user");
          }}
          error={missing.has("user") && "Enter a user"}
          withAsterisk
        />
        <PasswordInput
          label="Password"
          value={password}
          onChange={(e) => {
            passwordKnownRef.current = true;
            setPassword(e.currentTarget.value);
          }}
          placeholder={isEditing ? "(unchanged)" : ""}
        />
      </Group>
      <Group justify="space-between" align="end">
        <TextInput
          label="Default database"
          placeholder="default"
          value={defaultDatabase}
          onChange={(e) => setDefaultDatabase(e.currentTarget.value)}
          flex={1}
        />
        <Switch
          label="Secure (TLS)"
          checked={secure}
          onChange={(e) => {
            const next = e.currentTarget.checked;
            setSecure(next);
            setPort((p) => portAfterTlsToggle(p, next));
          }}
        />
      </Group>
      {!secure && normalizeHost(host) !== "" && !isLoopbackHost(host) && (
        <Alert color="yellow" p="xs">
          <Text size="xs">
            TLS is off, so your password and query results cross the network
            unencrypted.
          </Text>
        </Alert>
      )}
      <Button
        variant="subtle"
        color="gray"
        size="compact-sm"
        className="chg-disclosure-button"
        onClick={() => setShowAdvanced((v) => !v)}
        aria-expanded={showAdvanced}
        leftSection={
          <CaretRightIcon
            className="chg-tree-caret"
            data-open={showAdvanced || undefined}
            weight="bold"
          />
        }
        style={{ alignSelf: "flex-start" }}
      >
        {showAdvanced ? "Hide" : "Show"} advanced
      </Button>
      {showAdvanced && (
        <Stack gap="sm">
          <Stack gap={4}>
            <Checkbox
              label="Run Server Activity queries on all replicas"
              checked={clusterFanout}
              onChange={(e) => setClusterFanout(e.currentTarget.checked)}
            />
            <Text size="xs" c="dimmed">
              Uses <code>clusterAllReplicas()</code> to show materialized view
              failures and server errors from every replica. Requires the{" "}
              <code>REMOTE</code> grant on the server. Turn this off if Server
              Activity shows error 497 <code>ACCESS_DENIED</code>.
            </Text>
            <TextInput
              label="Cluster name"
              placeholder="Leave blank to use the {cluster} macro"
              value={clusterName}
              onChange={(e) => setClusterName(e.currentTarget.value)}
              disabled={!clusterFanout}
            />
            <Text size="xs" c="dimmed">
              The cluster that <code>clusterAllReplicas()</code> queries. Many
              managed ClickHouse servers define the <code>{"{cluster}"}</code>{" "}
              macro. Leave the field blank to use it.
            </Text>
          </Stack>
          <Stack gap={4}>
            <Text size="xs" c="dimmed">
              Custom CA certificate (PEM). Needed only when your VPN inspects
              TLS traffic with a private CA.
            </Text>
            <Textarea
              placeholder="-----BEGIN CERTIFICATE-----..."
              value={customCaPem}
              onChange={(e) => setCustomCaPem(e.currentTarget.value)}
              autosize
              minRows={3}
              maxRows={8}
            />
          </Stack>
        </Stack>
      )}
      <Group justify="space-between" mt="md" className="chg-modal-footer">
        <Tooltip label="Enter a host and user first" disabled={canTest}>
          {/* A disabled button fires no mouse events; the span does. */}
          <span>
            <Button
              variant="default"
              onClick={onTest}
              loading={testing}
              disabled={!canTest}
            >
              Test connection
            </Button>
          </span>
        </Tooltip>
        <Group>
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}
