import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("./Errors", () => ({ Errors: () => <div>errors panel</div> }));
vi.mock("./Kafka", () => ({ Kafka: () => <div>kafka panel</div> }));
vi.mock("./RunningQueries", () => ({
  RunningQueries: () => <div>live panel</div>,
}));

import type { MonitorView } from "../lib/activeTab";
import { renderWithProviders } from "../test/render";
import { MonitorDot, monitorDotStale, MonitorPane } from "./MonitorPane";

function renderPane(
  views: MonitorView[],
  view: MonitorView | null,
  extra: Partial<Parameters<typeof MonitorPane>[0]> = {},
) {
  const onViewChange = vi.fn();
  renderWithProviders(
    <MonitorPane
      views={views}
      view={view}
      onViewChange={onViewChange}
      activityAlerts={0}
      healthAlert={false}
      kafkaStuck={0}
      payload={null}
      connectionId={null}
      {...extra}
    />,
  );
  return onViewChange;
}

describe("MonitorPane", () => {
  it("mounts only the chosen panel", () => {
    renderPane(["activity", "kafka", "running"], "kafka");
    expect(screen.getByText("kafka panel")).toBeInTheDocument();
    expect(screen.queryByText("errors panel")).toBeNull();
    expect(screen.queryByText("live panel")).toBeNull();
  });

  it("switches panels through the segmented control", async () => {
    const onViewChange = renderPane(["activity", "running"], "activity");
    await userEvent.click(screen.getByRole("radio", { name: "Live" }));
    expect(onViewChange).toHaveBeenCalledWith("running");
  });

  it("shows failure counts and the health alert on their panels", () => {
    renderPane(["activity", "kafka"], "activity", {
      activityAlerts: 3,
      healthAlert: true,
      kafkaStuck: 2,
    });
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByLabelText("Cluster health alert")).toBeInTheDocument();
  });

  it("drops the switch when only one panel is on", () => {
    renderPane(["running"], "running");
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText("live panel")).toBeInTheDocument();
  });
});

describe("MonitorDot", () => {
  it("says what it counts: new failures and stuck Kafka tables", () => {
    renderWithProviders(<MonitorDot newFailures={3} stuckKafka={1} health />);
    expect(
      screen.getByRole("img", {
        name: "3 new in the last 5 minutes; 1 stuck Kafka table",
      }),
    ).toBeInTheDocument();
  });

  it("names the backlog when only the health alert is on", () => {
    renderWithProviders(<MonitorDot newFailures={0} stuckKafka={0} health />);
    expect(
      screen.getByRole("img", { name: /pending mutations/i }),
    ).toBeInTheDocument();
  });

  it("hides when all is quiet", () => {
    renderWithProviders(
      <MonitorDot newFailures={0} stuckKafka={0} health={false} />,
    );
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("fades and says so when the last check failed", () => {
    renderWithProviders(
      <MonitorDot newFailures={2} stuckKafka={0} health={false} stale />,
    );
    const dot = screen.getByRole("img", {
      name: "2 new in the last 5 minutes (as of the last successful check)",
    });
    expect(dot).toHaveStyle({ opacity: "0.4" });
  });
});

describe("monitorDotStale", () => {
  const quiet = {
    activityShown: true,
    activityFailed: false,
    activityAlerting: false,
    kafkaFailed: false,
    kafkaStuck: 0,
  };

  it("fades when a source that feeds the dot failed its last check", () => {
    expect(
      monitorDotStale({
        ...quiet,
        activityFailed: true,
        activityAlerting: true,
      }),
    ).toBe(true);
    expect(
      monitorDotStale({ ...quiet, kafkaFailed: true, kafkaStuck: 2 }),
    ).toBe(true);
  });

  it("ignores a failed source that feeds nothing", () => {
    expect(
      monitorDotStale({
        ...quiet,
        activityShown: false,
        activityFailed: true,
        activityAlerting: true,
        kafkaStuck: 1,
      }),
    ).toBe(false);
    expect(
      monitorDotStale({ ...quiet, activityFailed: true, kafkaStuck: 1 }),
    ).toBe(false);
    expect(monitorDotStale({ ...quiet, kafkaFailed: true })).toBe(false);
  });
});
