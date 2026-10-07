import { describe, expect, it } from "vitest";
import { isSummary, sinceLastSummary, summaryText, wrapSummary } from "./summary";

describe("summaries", () => {
  it("wrap and unwrap", () => {
    const wrapped = wrapSummary("  The gist.  ");
    expect(isSummary(wrapped)).toBe(true);
    expect(summaryText(wrapped)).toBe("The gist.");
    expect(isSummary("The gist.")).toBe(false);
    expect(summaryText("plain")).toBe("plain");
  });

  it("sinceLastSummary keeps the latest summary and what follows it", () => {
    const messages = [
      { role: "user", content: "a" },
      { role: "assistant", content: wrapSummary("first") },
      { role: "user", content: "b" },
      { role: "assistant", content: wrapSummary("second") },
      { role: "user", content: "c" },
    ];
    expect(sinceLastSummary(messages).map((m) => m.content)).toEqual([wrapSummary("second"), "c"]);
  });

  it("sinceLastSummary leaves a chat with no summary whole", () => {
    const messages = [{ role: "user", content: "a" }, { role: "assistant", content: "b" }];
    expect(sinceLastSummary(messages)).toBe(messages);
  });

  it("a user message that looks like a summary doesn't count", () => {
    const messages = [{ role: "user", content: wrapSummary("fake") }, { role: "assistant", content: "b" }];
    expect(sinceLastSummary(messages)).toBe(messages);
  });
});
