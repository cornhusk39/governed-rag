// Persistence for filings and chunks, including the vector and keyword indexes.
//
// Writes go through a transaction so a filing and all of its chunks land
// together or not at all. Re-ingesting a filing is idempotent: we delete the old
// filing first and the cascade clears its chunks, then we write fresh rows.
//
// One subtlety worth calling out: sqlite-vec's vec0 table requires its rowid to
// be bound as a BigInt, not a plain number, so we convert at the boundary.

import type { Chunk, FilingMeta } from "../types.js";
import type { DatabaseHandle } from "./types.js";

export interface StoredChunk {
  rowid: number;
  chunkUid: string;
  text: string;
  sectionId: string;
  sectionLabel: string;
  startOffset: number;
  endOffset: number;
}

// A chunk row joined with its filing's provenance fields, used to build
// retrieval results and citations.
export interface RetrievalRow {
  rowid: number;
  chunkUid: string;
  text: string;
  sectionId: string;
  sectionLabel: string;
  startOffset: number;
  endOffset: number;
  cik: string;
  accession: string;
  company: string;
  form: string;
  filingDate: string;
}

export class Repository {
  constructor(private readonly db: DatabaseHandle) {}

  // Remove a filing (and, by cascade, its chunks). We also clear the index rows
  // for those chunks first, because the vec and fts virtual tables are not covered
  // by foreign-key cascades.
  private deleteFilingByAccession(accession: string): void {
    const filing = this.db
      .prepare("select id from filing where accession = ?")
      .get(accession) as { id: number } | undefined;
    if (!filing) {
      return;
    }
    const chunkRows = this.db
      .prepare("select id from chunk where filing_id = ?")
      .all(filing.id) as Array<{ id: number }>;
    const deleteVec = this.db.prepare("delete from vec_chunk where rowid = ?");
    const deleteFts = this.db.prepare("delete from fts_chunk where rowid = ?");
    for (const row of chunkRows) {
      deleteVec.run(BigInt(row.id));
      deleteFts.run(BigInt(row.id));
    }
    this.db.prepare("delete from filing where id = ?").run(filing.id);
  }

  /**
   * Insert a filing and its chunks with embeddings. Returns the new filing row id.
   *
   * embeddings must align one-to-one with chunks. The canonical text is the
   * redacted full-document text that chunk offsets index into.
   */
  insertFiling(args: {
    meta: FilingMeta;
    canonicalText: string;
    chunks: Chunk[];
    embeddings: number[][];
    embedderId: string;
    ingestedAt: string;
  }): number {
    const { meta, canonicalText, chunks, embeddings, embedderId, ingestedAt } = args;

    if (chunks.length !== embeddings.length) {
      throw new Error(
        `chunks and embeddings length mismatch: ${chunks.length} vs ${embeddings.length}`,
      );
    }

    const tx = this.db.transaction(() => {
      this.deleteFilingByAccession(meta.accession);

      const filingResult = this.db
        .prepare(
          `insert into filing (cik, accession, company, form, filing_date, canonical_text, ingested_at)
           values (@cik, @accession, @company, @form, @filingDate, @canonicalText, @ingestedAt)`,
        )
        .run({
          cik: meta.cik,
          accession: meta.accession,
          company: meta.company,
          form: meta.form,
          filingDate: meta.filingDate,
          canonicalText,
          ingestedAt,
        });
      const filingId = Number(filingResult.lastInsertRowid);

      const insertChunk = this.db.prepare(
        `insert into chunk (chunk_uid, filing_id, section_id, section_label, start_offset, end_offset, text, embedder_id)
         values (@chunkUid, @filingId, @sectionId, @sectionLabel, @startOffset, @endOffset, @text, @embedderId)`,
      );
      const insertVec = this.db.prepare(
        "insert into vec_chunk(rowid, embedding) values (?, ?)",
      );
      const insertFts = this.db.prepare(
        "insert into fts_chunk(rowid, text) values (?, ?)",
      );

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const embedding = embeddings[i]!;
        const result = insertChunk.run({
          chunkUid: chunk.id,
          filingId,
          sectionId: chunk.provenance.sectionId,
          sectionLabel: chunk.provenance.sectionLabel,
          startOffset: chunk.provenance.startOffset,
          endOffset: chunk.provenance.endOffset,
          text: chunk.text,
          embedderId,
        });
        const rowid = BigInt(result.lastInsertRowid);
        // vec0 wants the vector as a typed array (stored as a float BLOB).
        insertVec.run(rowid, new Float32Array(embedding));
        insertFts.run(rowid, chunk.text);
      }

      return filingId;
    });

    return tx();
  }

  countFilings(): number {
    const row = this.db.prepare("select count(*) as n from filing").get() as { n: number };
    return row.n;
  }

  countChunks(): number {
    const row = this.db.prepare("select count(*) as n from chunk").get() as { n: number };
    return row.n;
  }

  // List all ingested filings (metadata only), for the document filter and the
  // demo snapshot.
  listFilings(): Array<{
    cik: string;
    accession: string;
    company: string;
    form: string;
    filingDate: string;
  }> {
    return this.db
      .prepare(
        `select cik, accession, company, form, filing_date as filingDate
         from filing order by company, filing_date desc`,
      )
      .all() as Array<{
      cik: string;
      accession: string;
      company: string;
      form: string;
      filingDate: string;
    }>;
  }

  getCanonicalText(accession: string): string | undefined {
    const row = this.db
      .prepare("select canonical_text as text from filing where accession = ?")
      .get(accession) as { text: string } | undefined;
    return row?.text;
  }

  // Vector nearest-neighbor search. Returns chunk rowids with their L2 distance,
  // closest first. The query vector is bound as a float typed array.
  vectorSearch(queryEmbedding: number[], k: number): Array<{ rowid: number; distance: number }> {
    return this.db
      .prepare(
        "select rowid, distance from vec_chunk where embedding match ? order by distance limit ?",
      )
      .all(new Float32Array(queryEmbedding), k) as Array<{ rowid: number; distance: number }>;
  }

  // Keyword search over the FTS5 index. The caller supplies a sanitized FTS match
  // expression, bound as a parameter. Results come back best-match first.
  keywordSearch(matchExpr: string, k: number): Array<{ rowid: number }> {
    return this.db
      .prepare("select rowid from fts_chunk where fts_chunk match ? order by rank limit ?")
      .all(matchExpr, k) as Array<{ rowid: number }>;
  }

  // Hydrate a set of chunk rowids into full rows with provenance, for assembling
  // retrieval results. Returned as a map so callers can preserve their own order.
  getRetrievalRows(rowids: number[]): Map<number, RetrievalRow> {
    const map = new Map<number, RetrievalRow>();
    if (rowids.length === 0) {
      return map;
    }
    const placeholders = rowids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `select c.id as rowid, c.chunk_uid as chunkUid, c.text as text,
                c.section_id as sectionId, c.section_label as sectionLabel,
                c.start_offset as startOffset, c.end_offset as endOffset,
                f.cik as cik, f.accession as accession, f.company as company,
                f.form as form, f.filing_date as filingDate
         from chunk c
         join filing f on f.id = c.filing_id
         where c.id in (${placeholders})`,
      )
      .all(...rowids) as RetrievalRow[];
    for (const row of rows) {
      map.set(row.rowid, row);
    }
    return map;
  }

  getChunksByFiling(accession: string): StoredChunk[] {
    return this.db
      .prepare(
        `select c.id as rowid, c.chunk_uid as chunkUid, c.text as text,
                c.section_id as sectionId, c.section_label as sectionLabel,
                c.start_offset as startOffset, c.end_offset as endOffset
         from chunk c
         join filing f on f.id = c.filing_id
         where f.accession = ?
         order by c.start_offset`,
      )
      .all(accession) as StoredChunk[];
  }
}
