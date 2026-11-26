import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_LIVE_QUERIES_INTERVAL,
  DEFAULT_POLLING_INTERVAL,
} from "../lib/pollingInterval";
import { useUserPrefs } from "../state/userPreferences";
import { renderWithProviders } from "../test/render";
import { SettingsModal } from "./SettingsModal";

function resetPrefs() {
  window.localStorage.clear();
  useUserPrefs.setState({
    serverActivityPollingMs: DEFAULT_POLLING_INTERVAL,
    hideServerActivityTab: false,
    liveQueriesPollingMs: DEFAULT_LIVE_QUERIES_INTERVAL,
    hideLiveQueriesTab: false,
  });
}

describe("SettingsModal", () => {
  beforeEach(resetPrefs);

  it("renders nothing when not opened", () => {
    renderWithProviders(<SettingsModal opened={false} onClose={() => {}} />);
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("renders the controls when opened", () => {
    renderWithProviders(<SettingsModal opened={true} onClose={() => {}} />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", {
        name: /server activity polling interval/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /show server activity/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", {
        name: /live queries polling interval/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /show live queries/i }),
    ).toBeInTheDocument();
  });

  it("sets the colour scheme to dark when the user picks Dark", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsModal opened={true} onClose={() => {}} />);

    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(within(group).getByRole("radio", { name: "Light" })).toBeChecked();

    await user.click(within(group).getByRole("radio", { name: "Dark" }));
    expect(document.documentElement).toHaveAttribute(
      "data-mantine-color-scheme",
      "dark",
    );
  });

  it("changes the Server Activity interval when user picks an option", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsModal opened={true} onClose={() => {}} />);

    const group = screen.getByRole("radiogroup", {
      name: /server activity polling interval/i,
    });

    await user.click(within(group).getByRole("radio", { name: "Off" }));
    expect(useUserPrefs.getState().serverActivityPollingMs).toBe("off");

    await user.click(within(group).getByRole("radio", { name: "60s" }));
    expect(useUserPrefs.getState().serverActivityPollingMs).toBe(60000);

    await user.click(within(group).getByRole("radio", { name: "5s" }));
    expect(useUserPrefs.getState().serverActivityPollingMs).toBe(5000);
  });

  it("reflects the current Server Activity value in its segmented control", () => {
    useUserPrefs.setState({ serverActivityPollingMs: 30000 });
    renderWithProviders(<SettingsModal opened={true} onClose={() => {}} />);
    const group = screen.getByRole("radiogroup", {
      name: /server activity polling interval/i,
    });
    expect(within(group).getByRole("radio", { name: "30s" })).toBeChecked();
  });

  it("toggles hideServerActivityTab via the Show switch", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsModal opened={true} onClose={() => {}} />);

    const toggle = screen.getByRole("switch", {
      name: /show server activity/i,
    });
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(useUserPrefs.getState().hideServerActivityTab).toBe(true);

    await user.click(toggle);
    expect(useUserPrefs.getState().hideServerActivityTab).toBe(false);
  });

  it("changes the Live Queries interval when user picks an option", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsModal opened={true} onClose={() => {}} />);

    const group = screen.getByRole("radiogroup", {
      name: /live queries polling interval/i,
    });

    await user.click(within(group).getByRole("radio", { name: "Off" }));
    expect(useUserPrefs.getState().liveQueriesPollingMs).toBe("off");

    await user.click(within(group).getByRole("radio", { name: "10s" }));
    expect(useUserPrefs.getState().liveQueriesPollingMs).toBe(10000);

    await user.click(within(group).getByRole("radio", { name: "2s" }));
    expect(useUserPrefs.getState().liveQueriesPollingMs).toBe(2000);
  });

  it("reflects the current Live Queries value in its segmented control", () => {
    useUserPrefs.setState({ liveQueriesPollingMs: 5000 });
    renderWithProviders(<SettingsModal opened={true} onClose={() => {}} />);
    const group = screen.getByRole("radiogroup", {
      name: /live queries polling interval/i,
    });
    expect(within(group).getByRole("radio", { name: "5s" })).toBeChecked();
  });

  it("toggles hideLiveQueriesTab via the Show switch", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsModal opened={true} onClose={() => {}} />);

    const toggle = screen.getByRole("switch", {
      name: /show live queries/i,
    });
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(useUserPrefs.getState().hideLiveQueriesTab).toBe(true);

    await user.click(toggle);
    expect(useUserPrefs.getState().hideLiveQueriesTab).toBe(false);
  });

  it("shows Off and disables the Server Activity interval when the tab is hidden", () => {
    useUserPrefs.setState({
      serverActivityPollingMs: 10000,
      hideServerActivityTab: true,
    });
    renderWithProviders(<SettingsModal opened={true} onClose={() => {}} />);

    const group = screen.getByRole("radiogroup", {
      name: /server activity polling interval/i,
    });
    expect(within(group).getByRole("radio", { name: "Off" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "10s" })).not.toBeChecked();
    for (const radio of within(group).getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
  });

  it("shows Off and disables the Live Queries interval when the tab is hidden", () => {
    useUserPrefs.setState({
      liveQueriesPollingMs: 2000,
      hideLiveQueriesTab: true,
    });
    renderWithProviders(<SettingsModal opened={true} onClose={() => {}} />);

    const group = screen.getByRole("radiogroup", {
      name: /live queries polling interval/i,
    });
    expect(within(group).getByRole("radio", { name: "Off" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "2s" })).not.toBeChecked();
    for (const radio of within(group).getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
  });

  it("preserves the stored Server Activity interval when the user toggles Show off then on", async () => {
    const user = userEvent.setup();
    useUserPrefs.setState({ serverActivityPollingMs: 30000 });
    renderWithProviders(<SettingsModal opened={true} onClose={() => {}} />);

    const toggle = screen.getByRole("switch", {
      name: /show server activity/i,
    });
    await user.click(toggle);
    await user.click(toggle);

    expect(useUserPrefs.getState().serverActivityPollingMs).toBe(30000);
    const group = screen.getByRole("radiogroup", {
      name: /server activity polling interval/i,
    });
    expect(within(group).getByRole("radio", { name: "30s" })).toBeChecked();
  });

  it("turns Live Queries polling on when the tab is shown with polling off", async () => {
    const user = userEvent.setup();
    useUserPrefs.setState({
      liveQueriesPollingMs: "off",
      hideLiveQueriesTab: true,
    });
    renderWithProviders(<SettingsModal opened={true} onClose={() => {}} />);

    await user.click(
      screen.getByRole("switch", { name: /show live queries/i }),
    );

    expect(useUserPrefs.getState().hideLiveQueriesTab).toBe(false);
    expect(useUserPrefs.getState().liveQueriesPollingMs).toBe(
      DEFAULT_LIVE_QUERIES_INTERVAL,
    );
  });

  it("turns Server Activity polling on when the tab is shown with polling off", async () => {
    const user = userEvent.setup();
    useUserPrefs.setState({
      serverActivityPollingMs: "off",
      hideServerActivityTab: true,
    });
    renderWithProviders(<SettingsModal opened={true} onClose={() => {}} />);

    await user.click(
      screen.getByRole("switch", { name: /show server activity/i }),
    );

    expect(useUserPrefs.getState().serverActivityPollingMs).toBe(
      DEFAULT_POLLING_INTERVAL,
    );
  });

  it("keeps polling off when the user hides a tab", async () => {
    const user = userEvent.setup();
    useUserPrefs.setState({ liveQueriesPollingMs: "off" });
    renderWithProviders(<SettingsModal opened={true} onClose={() => {}} />);

    await user.click(
      screen.getByRole("switch", { name: /show live queries/i }),
    );

    expect(useUserPrefs.getState().hideLiveQueriesTab).toBe(true);
    expect(useUserPrefs.getState().liveQueriesPollingMs).toBe("off");
  });

  it("calls onClose when user dismisses the modal", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<SettingsModal opened={true} onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
