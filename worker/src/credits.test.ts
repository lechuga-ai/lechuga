import { describe, expect, it } from "vitest";
import { costUsdFor, creditsFor, estimateTokens } from "./credits";
import config from "../config.json";

const flash = config.models[0];

describe("creditsFor", () => {
  it("charges the published rate per million tokens", () => {
    expect(creditsFor(flash.id, 1_000_000, 1_000_000)).toBe(flash.credit_per_million_prompt_tokens + flash.credit_per_million_completion_tokens);
  });

  it("rounds up, so a reply that used any tokens costs at least one credit", () => {
    expect(creditsFor(flash.id, 1, 0)).toBe(1);
    expect(creditsFor(flash.id, 0, 1)).toBe(1);
  });

  it("costs nothing when nothing was used", () => {
    expect(creditsFor(flash.id, 0, 0)).toBe(0);
  });

  it("falls back to the first model's rates for an id it doesn't know", () => {
    expect(creditsFor("@cf/nobody/nothing", 1_000_000, 0)).toBe(flash.credit_per_million_prompt_tokens);
  });
});

describe("costUsdFor", () => {
  it("is the unrounded charge, in dollars, divided back down by the markup", () => {
    const dollars = (flash.credit_per_million_prompt_tokens * 0.0001) / config.costs.markup;
    expect(costUsdFor(flash.id, 1_000_000, 0)).toBeCloseTo(dollars, 10);
  });
});

describe("estimateTokens", () => {
  it("counts about four characters a token, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});
