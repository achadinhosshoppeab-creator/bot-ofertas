import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type PriceHistoryRow = {
  productId: string;
  source: string;
  price: number;
  fetchedAt: string;
};

export type PublishedRow = {
  productId: string;
  source: string;
  price: number;
  publishedAt: string;
  messageId: string | null;
};

export type Db = Database.Database;

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  source TEXT NOT NULL,
  price REAL NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_source_product_fetched
  ON price_history (source, product_id, fetched_at);

CREATE TABLE IF NOT EXISTS published (
  product_id TEXT NOT NULL,
  source TEXT NOT NULL,
  price REAL NOT NULL,
  published_at TEXT NOT NULL,
  message_id TEXT,
  PRIMARY KEY (source, product_id)
);

CREATE INDEX IF NOT EXISTS idx_published_published_at
  ON published (published_at);

CREATE TABLE IF NOT EXISTS offers_seen (
  product_id TEXT NOT NULL,
  source TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (source, product_id)
);

CREATE TABLE IF NOT EXISTS drafts (
  product_id TEXT NOT NULL,
  source TEXT NOT NULL,
  price REAL NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source, product_id)
);
`;

export function openDatabase(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(MIGRATIONS);
}

export function insertPriceHistory(
  db: Db,
  row: {
    productId: string;
    source: string;
    price: number;
    fetchedAt?: Date | string;
  },
): void {
  const fetchedAt =
    typeof row.fetchedAt === "string"
      ? row.fetchedAt
      : (row.fetchedAt ?? new Date()).toISOString();

  // Evita inflar o banco: ignora se o último registro tem o mesmo preço há menos de 6 h.
  const last = db
    .prepare(
      `SELECT price, fetched_at FROM price_history WHERE source = ? AND product_id = ?
       ORDER BY fetched_at DESC LIMIT 1`,
    )
    .get(row.source, row.productId) as { price: number; fetched_at: string } | undefined;
  if (last && last.price === row.price && Date.parse(fetchedAt) - Date.parse(last.fetched_at) < 6 * 60 * 60 * 1000) {
    return;
  }

  db.prepare(
    `INSERT INTO price_history (product_id, source, price, fetched_at)
     VALUES (@productId, @source, @price, @fetchedAt)`,
  ).run({
    productId: row.productId,
    source: row.source,
    price: row.price,
    fetchedAt,
  });
}

export function getPricesLastDays(
  db: Db,
  params: {
    productId: string;
    source: string;
    days: number;
    now?: Date;
  },
): number[] {
  const now = params.now ?? new Date();
  const since = new Date(
    now.getTime() - params.days * 24 * 60 * 60 * 1000,
  ).toISOString();

  const rows = db
    .prepare(
      `SELECT price
       FROM price_history
       WHERE source = @source
         AND product_id = @productId
         AND fetched_at >= @since
       ORDER BY fetched_at ASC`,
    )
    .all({
      source: params.source,
      productId: params.productId,
      since,
    }) as Array<{ price: number }>;

  return rows.map((row) => row.price);
}

export function getPriceHistoryLastDays(
  db: Db,
  params: {
    productId: string;
    source: string;
    days: number;
    now?: Date;
  },
): Array<{ price: number; fetchedAt: string }> {
  const now = params.now ?? new Date();
  const since = new Date(
    now.getTime() - params.days * 24 * 60 * 60 * 1000,
  ).toISOString();

  return db
    .prepare(
      `SELECT price, fetched_at AS fetchedAt
       FROM price_history
       WHERE source = @source
         AND product_id = @productId
         AND fetched_at >= @since
       ORDER BY fetched_at ASC`,
    )
    .all({
      source: params.source,
      productId: params.productId,
      since,
    }) as Array<{ price: number; fetchedAt: string }>;
}

export function countPublishedSince(db: Db, since: Date): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS total FROM published WHERE published_at >= ?`)
    .get(since.toISOString()) as { total: number };
  return row.total;
}

export function getLastPublishedAt(db: Db): Date | undefined {
  const row = db
    .prepare(`SELECT MAX(published_at) AS last FROM published`)
    .get() as { last: string | null };
  return row.last ? new Date(row.last) : undefined;
}

export function getPublished(
  db: Db,
  params: { productId: string; source: string },
): PublishedRow | undefined {
  const row = db
    .prepare(
      `SELECT product_id AS productId,
              source,
              price,
              published_at AS publishedAt,
              message_id AS messageId
       FROM published
       WHERE source = @source AND product_id = @productId`,
    )
    .get(params) as
    | {
        productId: string;
        source: string;
        price: number;
        publishedAt: string;
        messageId: string | null;
      }
    | undefined;

  return row;
}

export function upsertPublished(
  db: Db,
  row: {
    productId: string;
    source: string;
    price: number;
    publishedAt?: Date | string;
    messageId?: string | null;
  },
): void {
  const publishedAt =
    typeof row.publishedAt === "string"
      ? row.publishedAt
      : (row.publishedAt ?? new Date()).toISOString();

  db.prepare(
    `INSERT INTO published (product_id, source, price, published_at, message_id)
     VALUES (@productId, @source, @price, @publishedAt, @messageId)
     ON CONFLICT(source, product_id) DO UPDATE SET
       price = excluded.price,
       published_at = excluded.published_at,
       message_id = excluded.message_id`,
  ).run({
    productId: row.productId,
    source: row.source,
    price: row.price,
    publishedAt,
    messageId: row.messageId ?? null,
  });
}

export function hasDraft(db: Db, params: { productId: string; source: string }): boolean {
  return (
    db.prepare(`SELECT 1 FROM drafts WHERE source = @source AND product_id = @productId`).get(params) !== undefined
  );
}

export function insertDraft(db: Db, row: { productId: string; source: string; price: number; createdAt?: Date }): void {
  db.prepare(
    `INSERT OR REPLACE INTO drafts (product_id, source, price, created_at)
     VALUES (@productId, @source, @price, @createdAt)`,
  ).run({ ...row, createdAt: (row.createdAt ?? new Date()).toISOString() });
}

/** Registra as ofertas aprovadas desta rodada; retorna quantas nunca tinham aparecido. */
export function markOffersSeen(db: Db, offers: readonly { productId: string; source: string }[], now = new Date()): number {
  const iso = now.toISOString();
  const insert = db.prepare(
    `INSERT INTO offers_seen (product_id, source, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (source, product_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  );
  let fresh = 0;
  const tx = db.transaction(() => {
    for (const offer of offers) {
      const changes = insert.run(offer.productId, offer.source, iso, iso).changes;
      // Em insert novo, first_seen_at == last_seen_at == agora.
      const row = db.prepare("SELECT first_seen_at FROM offers_seen WHERE source = ? AND product_id = ?").get(offer.source, offer.productId) as { first_seen_at: string };
      if (changes > 0 && row.first_seen_at === iso) {
        fresh += 1;
      }
    }
  });
  tx();
  return fresh;
}

/** Apaga histórico mais antigo que `days` dias (mantém o banco pequeno). */
export function prunePriceHistory(db: Db, days: number, now = new Date()): number {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare("DELETE FROM price_history WHERE fetched_at < ?").run(cutoff).changes;
}

export type StateExport = { published: PublishedRow[]; offersSeen: Array<{ productId: string; source: string; firstSeenAt: string; lastSeenAt: string }> };

/** Exporta o estado pequeno (publicados + vistos) para semear outro ambiente. */
export function exportState(db: Db): StateExport {
  const published = db
    .prepare("SELECT product_id, source, price, published_at, message_id FROM published")
    .all()
    .map((r) => {
      const row = r as { product_id: string; source: string; price: number; published_at: string; message_id: string | null };
      return { productId: row.product_id, source: row.source, price: row.price, publishedAt: row.published_at, messageId: row.message_id };
    });
  const offersSeen = db
    .prepare("SELECT product_id, source, first_seen_at, last_seen_at FROM offers_seen")
    .all()
    .map((r) => {
      const row = r as { product_id: string; source: string; first_seen_at: string; last_seen_at: string };
      return { productId: row.product_id, source: row.source, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at };
    });
  return { published, offersSeen };
}

/** Importa o estado exportado sem sobrescrever o que já existe. */
export function importState(db: Db, state: StateExport): void {
  const pub = db.prepare(
    `INSERT OR IGNORE INTO published (product_id, source, price, published_at, message_id) VALUES (?, ?, ?, ?, ?)`,
  );
  const seen = db.prepare(
    `INSERT OR IGNORE INTO offers_seen (product_id, source, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const p of state.published) pub.run(p.productId, p.source, p.price, p.publishedAt, p.messageId);
    for (const o of state.offersSeen) seen.run(o.productId, o.source, o.firstSeenAt, o.lastSeenAt);
  })();
}

export function closeDatabase(db: Db): void {
  db.close();
}
