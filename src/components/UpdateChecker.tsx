import {
  Alert,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  Progress,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useEffect, useState } from "react";

import { useTabs } from "../state/tabs";

const READY_TOAST = "update-ready";

interface Props {
  opened: boolean;
  onClose: () => void;
  onOpen: () => void;
}

type Phase =
  | { kind: "checking" }
  | { kind: "up-to-date"; current: string }
  | { kind: "available"; update: Update }
  | {
      kind: "downloading";
      update: Update;
      downloaded: number;
      total: number | null;
    }
  | { kind: "installing"; update: Update }
  | { kind: "ready"; update: Update; restartError?: string }
  | { kind: "error"; message: string };

/** Phases kept across a close and reopen, so the dialog never offers again an
 * update that is installing or installed. */
const STICKY: Phase["kind"][] = ["downloading", "installing", "ready"];

export function UpdateChecker({ opened, onClose, onOpen }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [deferred, setDeferred] = useState(false);
  // Select the stable tab list. Filtering inside the selector would return a
  // new array each time and re-render forever.
  const tabs = useTabs((s) => s.tabs);
  const running = tabs.filter((t) => t.runningQueryId);
  const sticky = STICKY.includes(phase.kind);
  const readyUpdate = phase.kind === "ready" ? phase.update : null;

  // The toast's button opens the dialog instead of restarting, so the warning
  // about running queries always shows first.
  useEffect(() => {
    if (!readyUpdate || opened || deferred) return;
    notifications.show({
      id: READY_TOAST,
      autoClose: false,
      title: `ch-gui ${readyUpdate.version} is ready`,
      message: (
        <Stack gap={6}>
          <Text size="sm">
            It runs the next time you open ch-gui. Restart to use it now.
          </Text>
          <Group gap="xs">
            <Button
              size="compact-sm"
              onClick={() => {
                notifications.hide(READY_TOAST);
                onOpen();
              }}
            >
              Restart…
            </Button>
          </Group>
        </Stack>
      ),
    });
  }, [readyUpdate, opened, deferred, onOpen]);

  // Only opening re-checks, so a failed install stays on screen while the
  // dialog is open.
  useEffect(() => {
    if (!opened || sticky) return;
    setPhase({ kind: "checking" });
    let cancelled = false;
    (async () => {
      try {
        const update = await check();
        if (cancelled) return;
        if (update) {
          setPhase({ kind: "available", update });
        } else {
          const current = await import("@tauri-apps/api/app").then((m) =>
            m.getVersion(),
          );
          if (!cancelled) setPhase({ kind: "up-to-date", current });
        }
      } catch (err) {
        if (!cancelled)
          setPhase({
            kind: "error",
            message: String(err instanceof Error ? err.message : err),
          });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check on open only; see above.
  }, [opened]);

  function restart() {
    notifications.hide(READY_TOAST);
    relaunch().catch((err: unknown) =>
      setPhase((p) =>
        p.kind === "ready"
          ? {
              ...p,
              restartError: String(err instanceof Error ? err.message : err),
            }
          : p,
      ),
    );
  }

  async function install(update: Update) {
    let total: number | null = null;
    let downloaded = 0;
    setPhase({ kind: "downloading", update, downloaded, total });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          setPhase({ kind: "downloading", update, downloaded: 0, total });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setPhase({ kind: "downloading", update, downloaded, total });
        } else if (event.event === "Finished") {
          setPhase({ kind: "installing", update });
        }
      });
      // Never restart automatically, since the user may have a query running.
      setPhase({ kind: "ready", update });
    } catch (err) {
      setPhase({
        kind: "error",
        message: String(err instanceof Error ? err.message : err),
      });
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Check for updates"
      centered
      size="md"
    >
      <Stack>
        {renderBody(
          phase,
          install,
          onClose,
          running,
          () => {
            setDeferred(true);
            notifications.hide(READY_TOAST);
            onClose();
          },
          restart,
        )}
      </Stack>
    </Modal>
  );
}

function renderBody(
  phase: Phase,
  install: (u: Update) => void,
  onClose: () => void,
  running: { id: string; title: string }[],
  later: () => void,
  restart: () => void,
) {
  if (phase.kind === "checking") {
    return (
      <Group>
        <Loader size="sm" />
        <Text>Checking for updates…</Text>
      </Group>
    );
  }
  if (phase.kind === "up-to-date") {
    return (
      <>
        <Text>You have the latest version ({phase.current}).</Text>
        <Group justify="flex-end">
          <Button onClick={onClose}>Close</Button>
        </Group>
      </>
    );
  }
  if (phase.kind === "available") {
    const u = phase.update;
    return (
      <>
        <Text>
          Version <Code>{u.version}</Code> is available
          {u.currentVersion ? (
            <>
              {" "}
              (you have <Code>{u.currentVersion}</Code>)
            </>
          ) : null}
          .
        </Text>
        {u.body ? (
          <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
            {u.body}
          </Text>
        ) : null}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Later
          </Button>
          <Button onClick={() => install(u)}>Install</Button>
        </Group>
      </>
    );
  }
  if (phase.kind === "downloading") {
    const pct =
      phase.total && phase.total > 0
        ? Math.min(100, Math.round((phase.downloaded / phase.total) * 100))
        : null;
    return (
      <>
        <Text>Downloading {phase.update.version}…</Text>
        <Progress value={pct ?? 0} animated striped={pct === null} />
        <Text size="xs" c="dimmed">
          {pct !== null
            ? `${pct}%`
            : `${(phase.downloaded / 1024 / 1024).toFixed(1)} MB`}
        </Text>
      </>
    );
  }
  if (phase.kind === "installing") {
    return (
      <Group>
        <Loader size="sm" />
        <Text>Installing…</Text>
      </Group>
    );
  }
  if (phase.kind === "ready") {
    return (
      <>
        <Text>
          Version <Code>{phase.update.version}</Code> is installed. It runs the
          next time you open ch-gui. Restart to use it now.
        </Text>
        {phase.restartError && (
          <Alert color="red" title="ch-gui couldn't restart">
            {phase.restartError}. Try again, or quit and reopen ch-gui to use
            the new version.
          </Alert>
        )}
        {running.length > 0 && (
          <Alert color="yellow" title="A query is still running">
            Restarting cancels {running.map((t) => `“${t.title}”`).join(", ")}{" "}
            and clears every tab's results. Every tab keeps its SQL.
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={later}>
            Later
          </Button>
          <Button onClick={restart}>Restart now</Button>
        </Group>
      </>
    );
  }
  return (
    <>
      <Alert color="red" title="Update check failed">
        {phase.message}
      </Alert>
      <Group justify="flex-end">
        <Button onClick={onClose}>Close</Button>
      </Group>
    </>
  );
}
