// OpenTelemetry bootstrap for the CLI.
//
// The data plane (core) emits spans through the OTel API. This is where a real
// exporter gets wired up: if OTEL_EXPORTER_OTLP_ENDPOINT is set, we start the
// Node SDK with an OTLP/HTTP trace exporter so every ingest and query is exported
// as a traced run. If it is not set, this is a no-op and the API spans go
// nowhere, so there is zero configuration burden when tracing is not wanted.

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

export interface Telemetry {
  enabled: boolean;
  // Flush and stop exporting. Always safe to call.
  shutdown: () => Promise<void>;
}

export function startTelemetry(): Telemetry {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return { enabled: false, shutdown: async () => {} };
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "governed-rag",
    }),
    // The exporter reads OTEL_EXPORTER_OTLP_ENDPOINT from the environment.
    traceExporter: new OTLPTraceExporter(),
  });
  sdk.start();

  return {
    enabled: true,
    shutdown: () => sdk.shutdown(),
  };
}
