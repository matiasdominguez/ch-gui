import {
  Divider,
  Modal,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  useMantineColorScheme,
  type MantineColorScheme,
} from "@mantine/core";

import {
  DEFAULT_LIVE_QUERIES_INTERVAL,
  DEFAULT_POLLING_INTERVAL,
  effectivePollingInterval,
  LIVE_QUERIES_OPTIONS,
  SERVER_ACTIVITY_OPTIONS,
  type PollingInterval,
} from "../lib/pollingInterval";
import { useUserPrefs } from "../state/userPreferences";

interface Props {
  opened: boolean;
  onClose: () => void;
}

function optionLabel(pref: PollingInterval): string {
  if (pref === "off") return "Off";
  return `${pref / 1000}s`;
}

function toInterval(v: string): PollingInterval {
  return v === "off" ? "off" : (Number(v) as PollingInterval);
}

function intervalOptions(options: PollingInterval[]) {
  return options.map((p) => ({ value: String(p), label: optionLabel(p) }));
}

export function SettingsModal({ opened, onClose }: Props) {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const serverActivityMs = useUserPrefs((s) => s.serverActivityPollingMs);
  const hideServerActivity = useUserPrefs((s) => s.hideServerActivityTab);
  const setServerActivityInterval = useUserPrefs(
    (s) => s.setServerActivityPollingInterval,
  );
  const setHideServerActivity = useUserPrefs((s) => s.setHideServerActivityTab);

  const liveQueriesMs = useUserPrefs((s) => s.liveQueriesPollingMs);
  const hideLiveQueries = useUserPrefs((s) => s.hideLiveQueriesTab);
  const setLiveQueriesInterval = useUserPrefs(
    (s) => s.setLiveQueriesPollingInterval,
  );
  const setHideLiveQueries = useUserPrefs((s) => s.setHideLiveQueriesTab);

  return (
    <Modal opened={opened} onClose={onClose} title="Settings" centered>
      <Stack gap="lg">
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Theme
          </Text>
          <Text size="xs" c="dimmed">
            Auto follows the macOS appearance setting.
          </Text>
          <SegmentedControl
            value={colorScheme}
            onChange={(v) => setColorScheme(v as MantineColorScheme)}
            data={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "auto", label: "Auto" },
            ]}
            aria-label="Theme"
          />
        </Stack>

        <Divider />

        <Switch
          checked={!hideServerActivity}
          onChange={(e) => {
            const show = e.currentTarget.checked;
            setHideServerActivity(!show);
            // A shown tab with polling off would show stale data.
            if (show && serverActivityMs === "off") {
              setServerActivityInterval(DEFAULT_POLLING_INTERVAL);
            }
          }}
          label="Show Server Activity"
          description="A view in the sidebar's Monitor tab. Hide it if you don't watch server errors and failures."
        />
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Server Activity polling
          </Text>
          <Text size="xs" c="dimmed">
            How often the sidebar refreshes server errors, materialized view
            failures, pending mutations, the replication queue, and Kafka
            consumer health. Off also turns off the alert dot on the Monitor
            tab.
          </Text>
          <SegmentedControl
            value={String(
              effectivePollingInterval(serverActivityMs, hideServerActivity),
            )}
            onChange={(v) => setServerActivityInterval(toInterval(v))}
            data={intervalOptions(SERVER_ACTIVITY_OPTIONS)}
            disabled={hideServerActivity}
            aria-label="Server Activity polling interval"
          />
        </Stack>

        <Divider />

        <Switch
          checked={!hideLiveQueries}
          onChange={(e) => {
            const show = e.currentTarget.checked;
            setHideLiveQueries(!show);
            if (show && liveQueriesMs === "off") {
              setLiveQueriesInterval(DEFAULT_LIVE_QUERIES_INTERVAL);
            }
          }}
          label="Show Live Queries"
          description="A view in the sidebar's Monitor tab. Hide it if you don't watch running queries."
        />
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Live Queries polling
          </Text>
          <Text size="xs" c="dimmed">
            How often Live Queries refreshes the list of queries running on the
            server.
          </Text>
          <SegmentedControl
            value={String(
              effectivePollingInterval(liveQueriesMs, hideLiveQueries),
            )}
            onChange={(v) => setLiveQueriesInterval(toInterval(v))}
            data={intervalOptions(LIVE_QUERIES_OPTIONS)}
            disabled={hideLiveQueries}
            aria-label="Live Queries polling interval"
          />
        </Stack>
      </Stack>
    </Modal>
  );
}
