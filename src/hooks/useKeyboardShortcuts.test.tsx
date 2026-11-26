import { Drawer, Modal } from "@mantine/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useTabs } from "../state/tabs";
import { renderWithProviders } from "../test/render";
import {
  useKeyboardShortcuts,
  type KeyboardShortcutOptions,
} from "./useKeyboardShortcuts";

const { listen } = vi.hoisted(() => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

function noop() {}

function clickMenu(id: string) {
  const [event, handler] = listen.mock.lastCall!;
  expect(event).toBe("app:menu-action");
  act(() => handler({ payload: id }));
}

function Harness(props: Partial<KeyboardShortcutOptions>) {
  const full: KeyboardShortcutOptions = {
    onRun: noop,
    onRunAll: noop,
    onSave: noop,
    onCancel: noop,
    onCloseTab: noop,
    onNewTab: noop,
    onFormat: noop,
    onPaletteOpen: noop,
    onCheatOpen: noop,
    ...props,
  };
  useKeyboardShortcuts(full);
  return null;
}

function seedActiveTab(): string {
  let id = "";
  act(() => {
    id = useTabs.getState().open({ title: "T", sql: "SELECT 1" });
  });
  return id;
}

function pressMetaEnter(shift: boolean) {
  const ev = new KeyboardEvent("keydown", {
    code: "Enter",
    metaKey: true,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(ev);
  return ev;
}

describe("useKeyboardShortcuts ⌘T", () => {
  it("opens a new tab like ⌘N", () => {
    const onNewTab = vi.fn();
    render(<Harness onNewTab={onNewTab} />);

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyT",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(onNewTab).toHaveBeenCalledTimes(1);
  });
});

describe("useKeyboardShortcuts ⌘⇧↵ (run all)", () => {
  it("invokes onRunAll on Cmd/Ctrl+Shift+Enter for the active tab", () => {
    const onRunAll = vi.fn();
    const id = seedActiveTab();
    render(<Harness onRunAll={onRunAll} />);

    pressMetaEnter(true);

    expect(onRunAll).toHaveBeenCalledTimes(1);
    expect(onRunAll.mock.calls[0][0]).toMatchObject({ id });
  });

  it("prevents default so the browser doesn't also handle ⌘⇧↵", () => {
    seedActiveTab();
    render(<Harness onRunAll={() => {}} />);
    const ev = pressMetaEnter(true);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("keeps plain ⌘↵ on onRun, not onRunAll", () => {
    const onRun = vi.fn();
    const onRunAll = vi.fn();
    seedActiveTab();
    render(<Harness onRun={onRun} onRunAll={onRunAll} />);

    pressMetaEnter(false);

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRunAll).not.toHaveBeenCalled();
  });
});

describe("useKeyboardShortcuts modal gate", () => {
  function pressMetaP() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyP",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  it("keeps shortcuts live while closed modals and drawers stay mounted", () => {
    const onPaletteOpen = vi.fn();
    renderWithProviders(
      <>
        <Harness onPaletteOpen={onPaletteOpen} />
        <Modal opened={false} onClose={noop} title="closed modal">
          x
        </Modal>
        <Drawer opened={false} onClose={noop} title="closed drawer">
          y
        </Drawer>
      </>,
    );
    pressMetaP();
    expect(onPaletteOpen).toHaveBeenCalledTimes(1);
  });

  it("suppresses shortcuts while a Mantine modal is open", async () => {
    const onPaletteOpen = vi.fn();
    const { rerender } = renderWithProviders(
      <>
        <Harness onPaletteOpen={onPaletteOpen} />
        <Modal opened onClose={noop} title="open modal">
          x
        </Modal>
      </>,
    );
    await screen.findByRole("dialog");
    pressMetaP();
    expect(onPaletteOpen).not.toHaveBeenCalled();

    rerender(
      <>
        <Harness onPaletteOpen={onPaletteOpen} />
        <Modal opened={false} onClose={noop} title="open modal">
          x
        </Modal>
      </>,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    pressMetaP();
    expect(onPaletteOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps shortcuts live beside an open drawer", async () => {
    const onPaletteOpen = vi.fn();
    renderWithProviders(
      <>
        <Harness onPaletteOpen={onPaletteOpen} />
        <Drawer opened onClose={noop} title="open drawer" trapFocus={false}>
          <button>inside</button>
        </Drawer>
      </>,
    );
    await screen.findByRole("dialog");
    (document.activeElement as HTMLElement | null)?.blur();
    pressMetaP();
    expect(onPaletteOpen).toHaveBeenCalledTimes(1);
  });

  it("suppresses shortcuts while focus is inside a drawer", async () => {
    const onPaletteOpen = vi.fn();
    renderWithProviders(
      <>
        <Harness onPaletteOpen={onPaletteOpen} />
        <Drawer opened onClose={noop} title="open drawer" trapFocus={false}>
          <button>inside</button>
        </Drawer>
      </>,
    );
    (await screen.findByText("inside")).focus();
    pressMetaP();
    expect(onPaletteOpen).not.toHaveBeenCalled();
  });

  it("lets ⌘. (cancel query) through while a drawer is open", async () => {
    const onCancel = vi.fn();
    const id = seedActiveTab();
    act(() => {
      useTabs.getState().patch(id, { runningQueryId: "q1" });
    });
    renderWithProviders(
      <>
        <Harness onCancel={onCancel} />
        <Drawer opened onClose={noop} title="open drawer">
          y
        </Drawer>
      </>,
    );
    await screen.findByRole("dialog");
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "Period",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("useKeyboardShortcuts ⌘W", () => {
  it("routes close through onCloseTab with the active tab", () => {
    const onCloseTab = vi.fn();
    const id = seedActiveTab();
    render(<Harness onCloseTab={onCloseTab} />);

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyW",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(onCloseTab).toHaveBeenCalledTimes(1);
    expect(onCloseTab.mock.calls[0][0]).toMatchObject({ id });
  });
});

describe("useKeyboardShortcuts ⌘A", () => {
  function pressMetaA(target: EventTarget) {
    const ev = new KeyboardEvent("keydown", {
      code: "KeyA",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(ev);
    return ev;
  }

  it("selects nothing with focus outside a text field", () => {
    render(
      <>
        <Harness />
        <button>outside</button>
      </>,
    );
    const button = screen.getByText("outside");
    button.focus();
    expect(pressMetaA(button).defaultPrevented).toBe(true);
  });

  it("leaves ⌘A to an input that has focus", () => {
    render(
      <>
        <Harness />
        <input aria-label="field" />
      </>,
    );
    const input = screen.getByLabelText("field");
    input.focus();
    expect(pressMetaA(input).defaultPrevented).toBe(false);
  });
});

describe("useKeyboardShortcuts menu actions", () => {
  it("runs the same callback as the key", () => {
    const onRun = vi.fn();
    const id = seedActiveTab();
    render(<Harness onRun={onRun} />);

    clickMenu("run");
    pressMetaEnter(false);

    expect(onRun).toHaveBeenCalledTimes(2);
    expect(onRun.mock.calls[0][0]).toMatchObject({ id });
    expect(onRun.mock.calls[1][0]).toMatchObject({ id });
  });

  it("does nothing while a Mantine modal is open", async () => {
    const onNewTab = vi.fn();
    renderWithProviders(
      <>
        <Harness onNewTab={onNewTab} />
        <Modal opened onClose={noop} title="open modal">
          x
        </Modal>
      </>,
    );
    await screen.findByRole("dialog");

    clickMenu("new-tab");

    expect(onNewTab).not.toHaveBeenCalled();
  });

  it("cancels the key so the menu accelerator does not fire too", () => {
    const onFormat = vi.fn();
    render(<Harness onFormat={onFormat} />);

    const ev = new KeyboardEvent("keydown", {
      code: "KeyL",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(ev);

    expect(onFormat).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });
});
