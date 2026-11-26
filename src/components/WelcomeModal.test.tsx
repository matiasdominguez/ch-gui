import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/render";
import { WelcomeModal } from "./WelcomeModal";

describe("WelcomeModal", () => {
  it("renders nothing when not opened", () => {
    renderWithProviders(
      <WelcomeModal
        opened={false}
        onClose={() => {}}
        onAddConnection={() => {}}
      />,
    );
    expect(screen.queryByText("Welcome to ch-gui")).not.toBeInTheDocument();
  });

  it("renders the first step when opened", () => {
    renderWithProviders(
      <WelcomeModal
        opened={true}
        onClose={() => {}}
        onAddConnection={() => {}}
      />,
    );
    expect(screen.getByText("Welcome to ch-gui")).toBeInTheDocument();
    expect(
      screen.getByText(/native ClickHouse client for macOS/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^back$/i }),
    ).not.toBeInTheDocument();
  });

  it("advances through all three steps via Next", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <WelcomeModal
        opened={true}
        onClose={() => {}}
        onAddConnection={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(
      screen.getByRole("button", { name: /add connection/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /next/i }),
    ).not.toBeInTheDocument();
  });

  it("step 2 'Add connection' calls both onAddConnection and onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onAddConnection = vi.fn();
    renderWithProviders(
      <WelcomeModal
        opened={true}
        onClose={onClose}
        onAddConnection={onAddConnection}
      />,
    );

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /add connection/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAddConnection).toHaveBeenCalledTimes(1);
  });

  it("Done on the last step calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(
      <WelcomeModal
        opened={true}
        onClose={onClose}
        onAddConnection={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /done/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Skip on earlier steps calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(
      <WelcomeModal
        opened={true}
        onClose={onClose}
        onAddConnection={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^skip$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape key closes the modal", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(
      <WelcomeModal
        opened={true}
        onClose={onClose}
        onAddConnection={() => {}}
      />,
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
