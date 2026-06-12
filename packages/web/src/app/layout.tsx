import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Governed RAG",
  description:
    "RAG you could defend to a compliance officer: span-level citations, groundedness verification, and a full audit trail.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="site-nav">
          <a className="brand" href="/">
            Governed RAG
          </a>
          <a href="/">Queries</a>
          <a href="/audit">Audit log</a>
        </nav>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
