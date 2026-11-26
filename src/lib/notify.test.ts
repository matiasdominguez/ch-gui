import { notifications } from "@mantine/notifications";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn(), hide: vi.fn() },
}));

describe("notifyError", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(notifications.show).mockClear();
    vi.mocked(notifications.hide).mockClear();
  });

  async function load() {
    return (await import("./notify")).notifyError;
  }

  it("shows a red toast that stays until dismissed", async () => {
    const notifyError = await load();
    notifyError("Save failed", "disk full", "save");
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "save",
        color: "red",
        title: "Save failed",
        message: "disk full",
        autoClose: false,
      }),
    );
  });

  it("replaces a repeat of the same failure", async () => {
    const notifyError = await load();
    notifyError("Connection failed", "refused");
    notifyError("Connection failed", "refused");
    expect(notifications.hide).toHaveBeenCalledWith("error:Connection failed");
    expect(notifications.hide).not.toHaveBeenCalledWith(
      expect.not.stringMatching("error:Connection failed"),
    );
  });

  it("closes the oldest error past three", async () => {
    const notifyError = await load();
    for (const t of ["A", "B", "C", "D"]) notifyError(t, "x");
    expect(notifications.hide).toHaveBeenCalledWith("error:A");
    expect(notifications.hide).not.toHaveBeenCalledWith("error:B");
  });

  it("frees a slot when the user dismisses an error", async () => {
    const notifyError = await load();
    notifyError("A", "x");
    const onClose = vi.mocked(notifications.show).mock.calls[0][0].onClose!;
    onClose({} as never);
    for (const t of ["B", "C", "D"]) notifyError(t, "x");
    expect(notifications.hide).not.toHaveBeenCalledWith("error:B");
  });
});
