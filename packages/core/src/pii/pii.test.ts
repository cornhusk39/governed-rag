import { describe, expect, it } from "vitest";

import { detectPii, redactPii } from "./pii.js";

describe("detectPii", () => {
  it("finds emails, phones, SSNs, and account-shaped numbers", () => {
    const text =
      "Contact jane.roe@contoso-robotics.example or (425) 555-0143. SSN 078-05-1120, account 1234567890123.";
    const types = detectPii(text)
      .map((s) => s.type)
      .sort();
    expect(types).toEqual(["account-number", "email", "phone", "ssn"]);
  });

  it("does not flag ordinary financial figures written with commas", () => {
    const text = "Net revenue was $8,420 and operating income was $612 for the year.";
    expect(detectPii(text)).toHaveLength(0);
  });
});

describe("redactPii", () => {
  it("replaces each value with a typed placeholder", () => {
    const { text } = redactPii("Reach us at jane.roe@contoso-robotics.example today.");
    expect(text).toBe("Reach us at [REDACTED:email] today.");
  });

  it("never leaks the raw value into the output or the hits", () => {
    const raw = "SSN 078-05-1120 on file.";
    const result = redactPii(raw);
    expect(result.text).not.toContain("078-05-1120");
    // Hits carry only type and placeholder offsets, never the secret.
    for (const hit of result.hits) {
      expect(hit).not.toHaveProperty("value");
      const placeholder = result.text.slice(hit.start, hit.end);
      expect(placeholder).toBe("[REDACTED:ssn]");
    }
  });

  it("returns the text unchanged when there is nothing to redact", () => {
    const clean = "The Company operates regional distribution centers.";
    const result = redactPii(clean);
    expect(result.text).toBe(clean);
    expect(result.hits).toHaveLength(0);
  });
});
