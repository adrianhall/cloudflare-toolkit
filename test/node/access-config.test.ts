import { describe, expect, it } from "vitest";
import { defineAccessConfig } from "../../src/lib/access-config.js";

describe("Access config public helper", () => {
  it("returns the exact typed configuration object", () => {
    const config = {
      policies: [{ name: "all", decision: "allow" as const, include: [{ everyone: {} }] }],
      applications: [
        { name: "app", domain: "app.example.com", policies: [{ name: "all", precedence: 1 }] }
      ]
    };
    expect(defineAccessConfig(config)).toBe(config);
  });
});
