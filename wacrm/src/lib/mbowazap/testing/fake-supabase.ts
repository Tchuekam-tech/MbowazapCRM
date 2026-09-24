// ============================================================
// In-memory stand-in for the Supabase client, for the MboWazap
// ingestion tests. Supports just the query surface those code paths
// use — select / insert / upsert / update / delete, eq / neq / in / is
// / like filters, order, limit, single / maybeSingle, exact counts,
// rpc and storage uploads — with unique constraints, so idempotency is
// exercised for real. Embedded-relation filters ("table.column") match
// nothing: no joins here.
// ============================================================

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;
type DbError = { message: string; code?: string };
type Result = { data: unknown; error: DbError | null; count?: number | null };
type RpcHandler = (args: Row, db: FakeDb) => DbError | null;

/** A foreign key `table.column → references.id` and what deleting the parent does. */
export interface ForeignKey {
  table: string;
  column: string;
  references: string;
  onDelete: 'cascade' | 'set null' | 'restrict';
}

export interface FakeDbOptions {
  /** Column sets that must be unique together, per table. NULL/'' never collide. */
  unique?: Record<string, string[][]>;
  /** Enforced on delete, so a cascade that would lose rows is visible in tests. */
  foreignKeys?: ForeignKey[];
  rpc?: Record<string, RpcHandler>;
  /** The database's NOW(), in ms. */
  now?: () => number;
}

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`);
}

export class FakeDb {
  readonly tables = new Map<string, Row[]>();
  readonly uploads: { bucket: string; path: string; contentType?: string; size: number }[] = [];
  readonly rpcCalls: { name: string; args: Row }[] = [];
  /** Next operation on this table fails with this error (then clears). */
  failNext: { table: string; op?: string; error: DbError } | null = null;
  /** Next storage upload fails with this error (then clears). */
  failNextUpload: DbError | null = null;

  constructor(readonly options: FakeDbOptions = {}) {}

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  seed(table: string, rows: Row[]): void {
    for (const row of rows) this.rows(table).push({ id: randomUUID(), ...row });
  }

  takeFailure(table: string, op: string): DbError | null {
    const f = this.failNext;
    if (f && f.table === table && (!f.op || f.op === op)) {
      this.failNext = null;
      return f.error;
    }
    return null;
  }

  /**
   * Delete `ids` from `table` with the foreign keys' ON DELETE actions,
   * like Postgres: all or nothing, refusing if a RESTRICT child exists
   * anywhere in the cascade.
   */
  deleteRows(table: string, ids: Set<unknown>): DbError | null {
    const doomed = new Map<string, Set<unknown>>();
    const nulls: { row: Row; column: string }[] = [];
    const visit = (t: string, rowIds: Set<unknown>): DbError | null => {
      const already = doomed.get(t) ?? new Set();
      const fresh = [...rowIds].filter((id) => !already.has(id));
      if (fresh.length === 0) return null;
      for (const id of fresh) already.add(id);
      doomed.set(t, already);
      for (const fk of this.options.foreignKeys ?? []) {
        if (fk.references !== t) continue;
        const children = this.rows(fk.table).filter((r) => fresh.includes(r[fk.column]));
        if (children.length === 0) continue;
        if (fk.onDelete === 'restrict') {
          return {
            code: '23503',
            message: `update or delete on "${t}" violates foreign key on "${fk.table}.${fk.column}"`,
          };
        }
        if (fk.onDelete === 'set null') {
          for (const row of children) nulls.push({ row, column: fk.column });
        } else {
          const error = visit(fk.table, new Set(children.map((r) => r.id)));
          if (error) return error;
        }
      }
      return null;
    };
    const error = visit(table, ids);
    if (error) return error;
    for (const { row, column } of nulls) row[column] = null;
    for (const [t, rowIds] of doomed) {
      this.tables.set(t, this.rows(t).filter((r) => !rowIds.has(r.id)));
    }
    return null;
  }

  /** The unique-constraint violation `row` would cause, if any. */
  violation(table: string, row: Row, ignore?: Row): DbError | null {
    for (const cols of this.options.unique?.[table] ?? []) {
      if (cols.some((c) => row[c] === null || row[c] === undefined || row[c] === '')) continue;
      const clash = this.rows(table).find(
        (other) => other !== ignore && cols.every((c) => other[c] === row[c])
      );
      if (clash) {
        return { code: '23505', message: `duplicate key value violates unique constraint (${cols.join(', ')})` };
      }
    }
    return null;
  }

  client(): SupabaseClient {
    // Arrow functions throughout: `this` stays the FakeDb.
    return {
      from: (table: string) => new FakeQuery(this, table),
      rpc: async (name: string, args: Row) => {
        this.rpcCalls.push({ name, args });
        const handler = this.options.rpc?.[name];
        const error = handler ? handler(args, this) : null;
        return { data: null, error };
      },
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string, body: Uint8Array, opts?: { contentType?: string }) => {
            const error = this.failNextUpload;
            this.failNextUpload = null;
            if (error) return { data: null, error };
            this.uploads.push({ bucket, path, contentType: opts?.contentType, size: body.length });
            return { data: { path }, error: null };
          },
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://storage.test/${bucket}/${path}` },
          }),
        }),
      },
    } as unknown as SupabaseClient;
  }
}

type Op = 'select' | 'insert' | 'upsert' | 'update' | 'delete';

class FakeQuery implements PromiseLike<Result> {
  private op: Op = 'select';
  private payload: Row[] = [];
  private patch: Row = {};
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private filters: ((row: Row) => boolean)[] = [];
  private orderBy: { col: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private returning = false;
  private countMode = false;
  private headOnly = false;
  private singleMode: 'single' | 'maybe' | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string
  ) {}

  /** Column lists are ignored: every column comes back. */
  select(...args: [string?, { count?: string; head?: boolean }?]): this {
    const opts = args[1];
    if (this.op !== 'select') this.returning = true;
    if (opts?.count === 'exact') this.countMode = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(values: Row | Row[]): this {
    this.op = 'insert';
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }
  upsert(values: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.op = 'upsert';
    this.payload = Array.isArray(values) ? values : [values];
    this.upsertOpts = opts;
    return this;
  }
  update(patch: Row): this {
    this.op = 'update';
    this.patch = patch;
    return this;
  }
  delete(): this {
    this.op = 'delete';
    return this;
  }
  private where(col: string, test: (value: unknown) => boolean): this {
    this.filters.push(col.includes('.') ? () => false : (row) => test(row[col]));
    return this;
  }
  eq(col: string, value: unknown): this {
    return this.where(col, (v) => v === value);
  }
  neq(col: string, value: unknown): this {
    return this.where(col, (v) => v !== value);
  }
  in(col: string, values: unknown[]): this {
    return this.where(col, (v) => values.includes(v));
  }
  is(col: string, value: unknown): this {
    return this.where(col, (v) => (value === null ? v === null || v === undefined : v === value));
  }
  lt(col: string, value: string | number): this {
    return this.where(col, (v) => v !== null && v !== undefined && (v as string | number) < value);
  }
  gt(col: string, value: string | number): this {
    return this.where(col, (v) => v !== null && v !== undefined && (v as string | number) > value);
  }
  like(col: string, pattern: string): this {
    const re = likeToRegExp(pattern);
    return this.where(col, (v) => typeof v === 'string' && re.test(v));
  }
  order(col: string, opts: { ascending?: boolean } = {}): this {
    this.orderBy = { col, ascending: opts.ascending !== false };
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  single(): Promise<Result> {
    this.singleMode = 'single';
    return this.execute();
  }
  maybeSingle(): Promise<Result> {
    this.singleMode = 'maybe';
    return this.execute();
  }
  then<A = Result, B = never>(
    onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return this.execute().then(onFulfilled, onRejected);
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((row) => this.filters.every((f) => f(row)));
  }

  private shape(rows: Row[]): Result {
    let out = [...rows];
    if (this.orderBy) {
      const { col, ascending } = this.orderBy;
      out.sort((a, b) => {
        const x = String(a[col] ?? '');
        const y = String(b[col] ?? '');
        return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
      });
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    const count = this.countMode ? out.length : null;
    if (this.headOnly) return { data: null, error: null, count };
    if (this.singleMode) {
      if (out.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
      if (out.length === 0) {
        return this.singleMode === 'single'
          ? { data: null, error: { code: 'PGRST116', message: 'no rows' } }
          : { data: null, error: null };
      }
      return { data: { ...out[0] }, error: null };
    }
    return { data: out.map((r) => ({ ...r })), error: null, count };
  }

  private async execute(): Promise<Result> {
    const failure = this.db.takeFailure(this.table, this.op);
    if (failure) return { data: null, error: failure };
    const rows = this.db.rows(this.table);

    switch (this.op) {
      case 'select':
        return this.shape(this.matching());

      case 'insert': {
        const created: Row[] = [];
        for (const value of this.payload) {
          const row = { id: randomUUID(), created_at: new Date().toISOString(), ...value };
          const clash = this.db.violation(this.table, row);
          if (clash) return { data: null, error: clash };
          rows.push(row);
          created.push(row);
        }
        return this.returning ? this.shape(created) : { data: null, error: null };
      }

      case 'upsert': {
        const conflict = (this.upsertOpts.onConflict ?? 'id').split(',').map((c) => c.trim());
        const affected: Row[] = [];
        for (const value of this.payload) {
          const existing = rows.find((r) => conflict.every((c) => r[c] === value[c]));
          if (existing) {
            if (this.upsertOpts.ignoreDuplicates) continue;
            Object.assign(existing, value);
            affected.push(existing);
          } else {
            const row = { id: randomUUID(), created_at: new Date().toISOString(), ...value };
            const clash = this.db.violation(this.table, row);
            if (clash) return { data: null, error: clash };
            rows.push(row);
            affected.push(row);
          }
        }
        return this.returning ? this.shape(affected) : { data: null, error: null };
      }

      case 'update': {
        const targets = this.matching();
        for (const row of targets) {
          const clash = this.db.violation(this.table, { ...row, ...this.patch }, row);
          if (clash) return { data: null, error: clash };
        }
        for (const row of targets) Object.assign(row, this.patch);
        return this.returning ? this.shape(targets) : { data: null, error: null };
      }

      case 'delete': {
        const error = this.db.deleteRows(
          this.table,
          new Set(this.matching().map((r) => r.id))
        );
        return { data: null, error };
      }
    }
  }
}

/** The unique constraints and RPCs of the tables MboWazap ingestion touches. */
export function wacrmFakeDb(now: () => number = Date.now): FakeDb {
  return new FakeDb({
    now,
    unique: {
      whatsapp_config: [['account_id'], ['mbowazap_session']],
      contacts: [['account_id', 'wa_lid'], ['account_id', 'phone']],
      conversations: [['account_id', 'contact_id']],
      messages: [['conversation_id', 'message_id']],
      contact_tags: [['contact_id', 'tag_id']],
      contact_custom_values: [['contact_id', 'custom_field_id']],
      message_reactions: [['message_id', 'actor_type', 'actor_id']],
      mbowazap_events: [['event_id']],
    },
    // As in the migrations (001, 004, 006, 009, 010, 027, 033).
    foreignKeys: [
      { table: 'contact_tags', column: 'contact_id', references: 'contacts', onDelete: 'cascade' },
      { table: 'contact_custom_values', column: 'contact_id', references: 'contacts', onDelete: 'cascade' },
      { table: 'contact_notes', column: 'contact_id', references: 'contacts', onDelete: 'cascade' },
      { table: 'conversations', column: 'contact_id', references: 'contacts', onDelete: 'cascade' },
      { table: 'deals', column: 'contact_id', references: 'contacts', onDelete: 'set null' },
      { table: 'broadcast_recipients', column: 'contact_id', references: 'contacts', onDelete: 'set null' },
      { table: 'automation_logs', column: 'contact_id', references: 'contacts', onDelete: 'set null' },
      { table: 'automation_pending_executions', column: 'contact_id', references: 'contacts', onDelete: 'set null' },
      { table: 'flow_runs', column: 'contact_id', references: 'contacts', onDelete: 'set null' },
      { table: 'notifications', column: 'contact_id', references: 'contacts', onDelete: 'set null' },
      { table: 'messages', column: 'conversation_id', references: 'conversations', onDelete: 'cascade' },
      { table: 'deals', column: 'conversation_id', references: 'conversations', onDelete: 'restrict' },
      { table: 'message_reactions', column: 'conversation_id', references: 'conversations', onDelete: 'cascade' },
      { table: 'flow_runs', column: 'conversation_id', references: 'conversations', onDelete: 'set null' },
      { table: 'notifications', column: 'conversation_id', references: 'conversations', onDelete: 'cascade' },
      { table: 'ai_usage_log', column: 'conversation_id', references: 'conversations', onDelete: 'set null' },
      { table: 'message_reactions', column: 'message_id', references: 'messages', onDelete: 'cascade' },
      { table: 'contact_tags', column: 'tag_id', references: 'tags', onDelete: 'cascade' },
      { table: 'contact_custom_values', column: 'custom_field_id', references: 'custom_fields', onDelete: 'cascade' },
    ],
    rpc: {
      // Migration 037: bump unread and refresh the preview in one statement.
      bump_conversation_on_inbound: (args, db) => {
        const conv = db.rows('conversations').find((c) => c.id === args.p_conversation_id);
        if (!conv) return { message: 'conversation not found' };
        conv.unread_count = Number(conv.unread_count ?? 0) + 1;
        conv.last_message_text = args.p_last_message_text;
        conv.last_message_at = new Date(db.options.now?.() ?? Date.now()).toISOString();
        return null;
      },
    },
  });
}
