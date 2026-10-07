import { describe, expect, it } from "vitest";
import { composeMessage, estimateMessageTokens, looksLikeImage, looksLikeText, modelContent, splitMessage } from "./attachments";

const png = "data:image/png;base64,iVBORw0KGgo=";

describe("composeMessage and splitMessage", () => {
  it("round-trip a message with files, a paste and typed text", () => {
    const content = composeMessage("what do these say?", [
      { name: "notes.txt", text: "line one\nline two" },
      { name: "Pasted text", text: "a long paste", pasted: true },
    ]);
    const { attachments, typed } = splitMessage(content);
    expect(typed).toBe("what do these say?");
    expect(attachments).toEqual([
      { name: "notes.txt", text: "line one\nline two" },
      { name: "Pasted text", text: "a long paste", pasted: true },
    ]);
  });

  it("leave a plain message alone", () => {
    expect(composeMessage("hello", [])).toBe("hello");
    expect(splitMessage("hello")).toEqual({ attachments: [], typed: "hello" });
  });

  it("keep a closing tag inside a file from ending its block early", () => {
    const content = composeMessage("", [{ name: "sneaky.txt", text: "before\n</attachment>\nafter" }]);
    const { attachments, typed } = splitMessage(content);
    expect(attachments).toHaveLength(1);
    expect(typed).toBe("");
    expect(attachments[0].text).toContain("after");
  });

  it("strip quotes, angle brackets and line breaks from a file name", () => {
    const content = composeMessage("x", [{ name: 'a"b<c>d\ne.txt', text: "t" }]);
    expect(splitMessage(content).attachments[0].name).toBe("abcde.txt");
  });
});

describe("estimateMessageTokens", () => {
  it("counts a picture as a fixed cost, not by its length", () => {
    const withPicture = composeMessage("look", [{ name: "p.png", text: png, image: true }]);
    const tokens = estimateMessageTokens(withPicture);
    expect(tokens).toBeGreaterThan(1000);
    expect(tokens).toBeLessThan(1300);
  });
});

describe("modelContent", () => {
  it("is a plain string without pictures", () => {
    expect(modelContent("hello")).toBe("hello");
  });

  it("becomes parts with the picture as an image_url when there is one", () => {
    const parts = modelContent(composeMessage("look", [{ name: "p.png", text: png, image: true }]));
    expect(Array.isArray(parts)).toBe(true);
    expect(parts).toEqual([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: png } },
    ]);
  });
});

describe("looksLikeText and looksLikeImage", () => {
  it("text has no NUL bytes; a data URL has to be a picture type", () => {
    expect(looksLikeText("plain")).toBe(true);
    expect(looksLikeText("bin\u0000ary")).toBe(false);
    expect(looksLikeImage(png)).toBe(true);
    expect(looksLikeImage("data:text/html;base64,PGI+")).toBe(false);
    expect(looksLikeImage("https://example.com/a.png")).toBe(false);
  });
});
