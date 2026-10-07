import { describe, expect, it } from "vitest";
import { parseRemembered } from "./memory";

const current = { notes: "Old notes.", soul: "Old soul." };

describe("parseRemembered", () => {
  it("reads both sections in either order", () => {
    expect(parseRemembered("[NOTES]\nNew notes.\n\n[SOUL]\nNew soul.", current)).toEqual({ notes: "New notes.", soul: "New soul." });
    expect(parseRemembered("[SOUL]\nNew soul.\n\n[NOTES]\nNew notes.", current)).toEqual({ notes: "New notes.", soul: "New soul." });
  });

  it("keeps the part the model left out", () => {
    expect(parseRemembered("[NOTES]\nOnly notes.", current)).toEqual({ notes: "Only notes.", soul: "Old soul." });
    expect(parseRemembered("[SOUL]\nOnly soul.", current)).toEqual({ notes: "Old notes.", soul: "Only soul." });
  });

  it("treats an answer with no markers as the notes", () => {
    expect(parseRemembered("Just prose.", current)).toEqual({ notes: "Just prose.", soul: "Old soul." });
  });

  it("tidies blank lines and trims", () => {
    expect(parseRemembered("[NOTES]\n\n\n\nA.\n\n\n\nB.\n\n", current).notes).toBe("A.\n\nB.");
  });
});
