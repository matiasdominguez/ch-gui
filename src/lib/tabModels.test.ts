import { describe, expect, it } from "vitest";

import { closedTabModels, TAB_MODEL_SCHEME } from "./tabModels";

describe("closedTabModels", () => {
  it("selects only the models of closed tabs", () => {
    const model = (scheme: string, path: string) => ({ uri: { scheme, path } });
    const open = model(TAB_MODEL_SCHEME, "open");
    const closed = model(TAB_MODEL_SCHEME, "closed");
    const other = model("inmemory", "other");
    expect(closedTabModels([open, closed, other], ["open"])).toEqual([closed]);
  });
});
