import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useConnectionUI } from "../state/connectionUI";
import { useConnections } from "../state/connections";
import { renderWithProviders } from "../test/render";
import { ConnectionForm } from "./ConnectionForm";
import { ConnectionList } from "./ConnectionList";

vi.mock("../lib/tauri", () => ({
  loadPassword: vi.fn().mockResolvedValue(null),
  testConnection: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  countSavedQueries: vi.fn(),
  listConnections: vi.fn().mockResolvedValue([]),
  upsertConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));

const save = vi.fn().mockResolvedValue(undefined);

function renderForm() {
  const onClose = vi.fn();
  const ui = renderWithProviders(<ConnectionForm onClose={onClose} />);
  return { ui, onClose };
}

function type(
  ui: ReturnType<typeof renderWithProviders>,
  label: RegExp,
  v: string,
) {
  fireEvent.change(ui.getByLabelText(label), { target: { value: v } });
}

describe("ConnectionForm", () => {
  beforeEach(() => {
    save.mockClear();
    useConnections.setState({
      connections: [],
      activeId: null,
      loaded: true,
      loadError: null,
      save,
    });
  });

  it("focuses Name when the dialog opens", async () => {
    const ui = renderWithProviders(<ConnectionList />);
    fireEvent.click(ui.getByRole("button", { name: "New" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(ui.getByLabelText(/^Name/)),
    );
    useConnectionUI.getState().closeNewConnection();
  });

  it("warns when TLS is off for a remote host only", () => {
    const { ui } = renderForm();
    const warning = /TLS is off/;
    type(ui, /^Host/, "clickhouse.example.com");
    expect(ui.queryByText(warning)).toBeNull();
    fireEvent.click(ui.getByLabelText("Secure (TLS)"));
    expect(ui.getByText(warning)).toBeTruthy();
    type(ui, /^Host/, "localhost");
    expect(ui.queryByText(warning)).toBeNull();
    type(ui, /^Host/, "");
    expect(ui.queryByText(warning)).toBeNull();
  });

  it("swaps 9440 for 9000 when TLS goes off, and back", () => {
    const { ui } = renderForm();
    const port = ui.getByLabelText("Port") as HTMLInputElement;
    expect(port.value).toBe("9440");
    fireEvent.click(ui.getByLabelText("Secure (TLS)"));
    expect(port.value).toBe("9000");
    fireEvent.click(ui.getByLabelText("Secure (TLS)"));
    expect(port.value).toBe("9440");
  });

  it("keeps a custom port when TLS flips", () => {
    const { ui } = renderForm();
    type(ui, /^Port/, "19440");
    fireEvent.click(ui.getByLabelText("Secure (TLS)"));
    expect((ui.getByLabelText("Port") as HTMLInputElement).value).toBe("19440");
  });

  it("strips the scheme and port from a pasted URL", () => {
    const { ui } = renderForm();
    type(ui, /^Host/, "https://ch.example.com:8443/play");
    fireEvent.blur(ui.getByLabelText(/^Host/));
    expect((ui.getByLabelText(/^Host/) as HTMLInputElement).value).toBe(
      "ch.example.com",
    );
  });

  it("marks missing fields inline instead of saving", async () => {
    const { ui } = renderForm();
    type(ui, /^Host/, "ch.example.com");
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    await ui.findByText("Enter a name");
    ui.getByText("Enter a user");
    expect(ui.queryByText("Enter a host")).toBeNull();
    expect(save).not.toHaveBeenCalled();

    type(ui, /^Name/, "Prod");
    expect(ui.queryByText("Enter a name")).toBeNull();
  });

  it("saves when the form submits, as Enter does", async () => {
    const { ui, onClose } = renderForm();
    type(ui, /^Name/, "Prod");
    type(ui, /^Host/, "ch.example.com");
    type(ui, /^User/, "analyst");
    fireEvent.submit(ui.getByLabelText(/^User/).closest("form")!);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Prod",
        host: "ch.example.com",
        port: 9440,
      }),
      "",
    );
  });
});
