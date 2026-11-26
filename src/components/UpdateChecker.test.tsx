import { MantineProvider } from "@mantine/core";
import { Notifications, notifications } from "@mantine/notifications";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkMock, relaunchMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  relaunchMock: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: checkMock }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: relaunchMock }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => "0.2.19" }));

import { useTabs } from "../state/tabs";
import { UpdateChecker } from "./UpdateChecker";

function fakeUpdate() {
  let finish = () => {};
  const done = new Promise<void>((r) => (finish = r));
  const update = {
    version: "0.2.20",
    currentVersion: "0.2.19",
    body: "",
    downloadAndInstall: vi.fn(async (cb: (e: unknown) => void) => {
      cb({ event: "Started", data: { contentLength: 100 } });
      await done;
      cb({ event: "Finished" });
    }),
  };
  return { update, finish: () => act(() => finish()) };
}

function Harness({
  opened,
  onClose,
  onOpen = () => {},
}: {
  opened: boolean;
  onClose: () => void;
  onOpen?: () => void;
}) {
  return (
    <MantineProvider>
      <Notifications />
      <UpdateChecker opened={opened} onClose={onClose} onOpen={onOpen} />
    </MantineProvider>
  );
}

describe("UpdateChecker", () => {
  beforeEach(() => {
    checkMock.mockReset();
    relaunchMock.mockReset();
    relaunchMock.mockResolvedValue(undefined);
    act(() => notifications.clean());
    act(() => useTabs.setState({ tabs: [], activeId: null, closedStack: [] }));
  });

  it("installs, then waits for the user instead of restarting", async () => {
    const { update, finish } = fakeUpdate();
    checkMock.mockResolvedValue(update);
    render(<Harness opened onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    await finish();
    expect(await screen.findByText(/is installed/)).toBeInTheDocument();
    expect(relaunchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });

  it("warns that restarting cancels a running query", async () => {
    act(() => {
      const id = useTabs
        .getState()
        .open({ title: "Slow report", sql: "SELECT 1" });
      useTabs.getState().patch(id, { runningQueryId: "q1" });
    });
    const { update, finish } = fakeUpdate();
    checkMock.mockResolvedValue(update);
    render(<Harness opened onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    await finish();
    expect(
      await screen.findByText(/Restarting cancels “Slow report”/),
    ).toBeInTheDocument();
  });

  it("points to the dialog from a toast when it was closed meanwhile", async () => {
    const { update, finish } = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const onOpen = vi.fn();
    const { rerender } = render(<Harness opened onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    rerender(<Harness opened={false} onClose={() => {}} onOpen={onOpen} />);
    await finish();
    const toast = (await screen.findByText("ch-gui 0.2.20 is ready")).closest(
      ".mantine-Notification-root",
    ) as HTMLElement;
    fireEvent.click(within(toast).getByRole("button", { name: "Restart…" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("Later dismisses a toast already showing", async () => {
    const { update, finish } = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const { rerender } = render(<Harness opened onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    rerender(<Harness opened={false} onClose={() => {}} />);
    await finish();
    await screen.findByText("ch-gui 0.2.20 is ready");
    rerender(<Harness opened onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    await waitFor(() =>
      expect(screen.queryByText("ch-gui 0.2.20 is ready")).toBeNull(),
    );
  });

  it("keeps an install failure on screen instead of re-checking", async () => {
    checkMock.mockResolvedValue({
      version: "0.2.20",
      currentVersion: "0.2.19",
      body: "",
      downloadAndInstall: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    render(<Harness opened onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    expect(await screen.findByText("disk full")).toBeInTheDocument();
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it("says so when the restart fails", async () => {
    const { update, finish } = fakeUpdate();
    checkMock.mockResolvedValue(update);
    relaunchMock.mockRejectedValue(new Error("denied"));
    render(<Harness opened onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    await finish();
    fireEvent.click(await screen.findByRole("button", { name: "Restart now" }));
    expect(
      await screen.findByText(/denied\. Try again, or quit and reopen/),
    ).toBeInTheDocument();
    relaunchMock.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    expect(relaunchMock).toHaveBeenCalledTimes(2);
  });

  it("shows the installed update on reopen instead of offering it again", async () => {
    const { update, finish } = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const { rerender } = render(<Harness opened onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    await finish();
    await screen.findByText(/is installed/);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    rerender(<Harness opened={false} onClose={() => {}} />);
    rerender(<Harness opened onClose={() => {}} />);
    expect(await screen.findByText(/is installed/)).toBeInTheDocument();
    expect(checkMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText("ch-gui 0.2.20 is ready")).toBeNull(),
    );
  });
});
