import { afterEach, describe, expect, it } from "vitest";

import { startTelemetry } from "./telemetry.js";

const original = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

afterEach(() => {
  if (original === undefined) {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  } else {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = original;
  }
});

describe("startTelemetry", () => {
  it("is a no-op when no OTLP endpoint is configured", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const telemetry = startTelemetry();
    expect(telemetry.enabled).toBe(false);
    // Shutdown is always safe to call.
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });
});
