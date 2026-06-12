// EDGAR client for the live ingest path.
//
// SEC fair-access rules require a declared User-Agent that identifies the
// requester and a conservative request rate. We honor both: the User-Agent is
// required at construction, and a simple minimum-interval limiter spaces requests
// out. Tests never touch this; they load cached fixture documents instead, so CI
// never hits EDGAR.

import type { FilingForm } from "../types.js";

export interface EdgarClientOptions {
  // Required. SEC asks for "Sample Company Name AdminContact@example.com" style.
  userAgent: string;
  // Minimum milliseconds between requests. Default is well under SEC's limit but
  // deliberately polite.
  minIntervalMs?: number;
  // Injectable for tests; defaults to global fetch.
  fetchImpl?: typeof fetch;
}

export interface RecentFiling {
  form: FilingForm;
  accession: string;
  filingDate: string;
  primaryDocument: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class EdgarClient {
  private readonly userAgent: string;
  private readonly minIntervalMs: number;
  private readonly fetchImpl: typeof fetch;
  private lastRequestAt = 0;

  constructor(options: EdgarClientOptions) {
    if (!options.userAgent || options.userAgent.trim().length === 0) {
      throw new Error(
        "EdgarClient requires a User-Agent (set EDGAR_USER_AGENT) to respect SEC fair-access rules.",
      );
    }
    this.userAgent = options.userAgent;
    this.minIntervalMs = options.minIntervalMs ?? 250;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  // Space requests out to stay within fair-access limits. The next slot is
  // reserved synchronously before awaiting, so concurrent callers chain in order
  // rather than all reading the same timestamp and firing at once.
  private async throttle(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.lastRequestAt + this.minIntervalMs);
    this.lastRequestAt = slot;
    const wait = slot - now;
    if (wait > 0) {
      await sleep(wait);
    }
  }

  private async get(url: string): Promise<Response> {
    await this.throttle();
    const response = await this.fetchImpl(url, {
      headers: {
        // SEC keys fair access off this header; it must be present and honest.
        "user-agent": this.userAgent,
        "accept-encoding": "gzip, deflate",
      },
    });
    if (!response.ok) {
      throw new Error(`EDGAR request failed: ${response.status} for ${url}`);
    }
    return response;
  }

  // List a company's recent 10-K and 10-Q filings, newest first. Used by the live
  // corpus build to discover which primary documents to fetch.
  async listRecentFilings(cik: string): Promise<RecentFiling[]> {
    const padded = cik.padStart(10, "0");
    const response = await this.get(`https://data.sec.gov/submissions/CIK${padded}.json`);
    const json = (await response.json()) as {
      filings: {
        recent: {
          form: string[];
          accessionNumber: string[];
          filingDate: string[];
          primaryDocument: string[];
        };
      };
    };
    const recent = json.filings.recent;
    const out: RecentFiling[] = [];
    for (let i = 0; i < recent.form.length; i++) {
      const form = recent.form[i];
      const primaryDocument = recent.primaryDocument[i];
      // Skip entries without a primary document; some older or amended filings
      // leave it empty, which would build a URL ending in "/" and 404.
      if ((form === "10-K" || form === "10-Q") && primaryDocument) {
        out.push({
          form,
          accession: recent.accessionNumber[i]!,
          filingDate: recent.filingDate[i]!,
          primaryDocument,
        });
      }
    }
    return out;
  }

  // Fetch the HTML of a filing's primary document.
  async fetchDocument(cik: string, accession: string, primaryDocument: string): Promise<string> {
    // EDGAR's archive path uses the unpadded CIK and the accession with dashes
    // removed as the folder name.
    const folder = accession.replace(/-/g, "");
    const cikNumber = String(Number.parseInt(cik, 10));
    const url = `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${folder}/${primaryDocument}`;
    const response = await this.get(url);
    return response.text();
  }
}
