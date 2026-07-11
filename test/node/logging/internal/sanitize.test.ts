import { describe, expect, it } from "vitest";
import { sanitizeTerminalText } from "../../../../src/lib/logging/internal/sanitize.js";

describe("sanitizeTerminalText()", () => {
  it("returns the input unchanged when it contains no control characters", () => {
    expect(sanitizeTerminalText("server started on port 8787")).toBe("server started on port 8787");
  });

  it("returns an empty string unchanged", () => {
    expect(sanitizeTerminalText("")).toBe("");
  });

  it("escapes newline as the readable \\n sequence", () => {
    expect(sanitizeTerminalText("line one\nline two")).toBe("line one\\nline two");
  });

  it("escapes carriage return as the readable \\r sequence", () => {
    expect(sanitizeTerminalText("before\rafter")).toBe("before\\rafter");
  });

  it("escapes tab as the readable \\t sequence", () => {
    expect(sanitizeTerminalText("a\tb")).toBe("a\\tb");
  });

  it("escapes ESC (ANSI introducer) as a hex sequence", () => {
    expect(sanitizeTerminalText("\x1b[31mRED\x1b[0m")).toBe("\\x1b[31mRED\\x1b[0m");
  });

  it("escapes NUL as a hex sequence", () => {
    expect(sanitizeTerminalText("a\x00b")).toBe("a\\x00b");
  });

  it("escapes DEL as a hex sequence", () => {
    expect(sanitizeTerminalText("a\x7fb")).toBe("a\\x7fb");
  });

  it("escapes an arbitrary C0 control character (bell) as a hex sequence", () => {
    expect(sanitizeTerminalText("a\x07b")).toBe("a\\x07b");
  });

  it("escapes multiple mixed control characters in a single string", () => {
    const input = "fake line\n\x1b[31minjected\x1b[0m\treal\x00end";
    expect(sanitizeTerminalText(input)).toBe(
      "fake line\\n\\x1b[31minjected\\x1b[0m\\treal\\x00end"
    );
  });
});
