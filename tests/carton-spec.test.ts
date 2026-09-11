import { describe, expect, it } from "vitest";
import { formatCartonSpec } from "../lib/catalog/carton-spec";

describe("箱规状态文案", () => {
  it("临时值必须与已确认值明确区分", () => {
    expect(formatCartonSpec(60, "pending")).toBe("临时 60 / 待确认");
    expect(formatCartonSpec(60, "confirmed")).toBe("60 件/箱");
    expect(formatCartonSpec(null, "pending")).toBe("待确认");
  });
});
