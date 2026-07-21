// DotChart read-only database scan: given a Postgres connection string,
// introspect the schema, suggest table→event mappings, and import events.
//
// Read-only guarantees:
//   - the session runs with default_transaction_read_only = on, so any write
//     the code (or a bug) attempted would be rejected by Postgres itself
//   - only tables/columns discovered via introspection can be queried —
//     identifiers from the client are validated against that list, never
//     interpolated freely
//   - statement_timeout caps runaway queries

import pg from 'pg'

// snake_case and camelCase variants (Rails/Django vs Prisma/Sequelize schemas)
const USER_COLS = [
  'user_id', 'userId', 'account_id', 'accountId', 'customer_id', 'customerId', 'member_id', 'memberId',
  'owner_id', 'ownerId', 'created_by', 'createdBy', 'profile_id', 'profileId', 'uid', 'author_id', 'authorId',
]
const TS_COLS = [
  'created_at', 'createdAt', 'inserted_at', 'insertedAt', 'occurred_at', 'occurredAt', 'completed_at', 'completedAt',
  'started_at', 'startedAt', 'startTime', 'start_time', 'event_time', 'eventTime', 'timestamp', 'created',
  'added_at', 'addedAt', 'sent_at', 'sentAt', 'logged_at', 'loggedAt',
]
const SKIP_TABLES = /^(schema_migrations|migrations|ar_internal_metadata|knex_|_prisma|pg_|sql_)/i

async function connect(connString) {
  const client = new pg.Client({
    connectionString: connString,
    connectionTimeoutMillis: 8000,
    // never hold the app hostage
    statement_timeout: 30000,
    application_name: 'dotchart-readonly-scan',
  })
  await client.connect()
  await client.query('SET default_transaction_read_only = on')
  return client
}

function toSnake(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

function singular(name) {
  if (/ies$/i.test(name)) return name.replace(/ies$/i, 'y')
  if (/ses$/i.test(name)) return name.replace(/es$/i, '')
  if (/s$/i.test(name)) return name.replace(/s$/i, '')
  return name
}

/** Introspect and suggest event mappings. Never reads row data. */
export async function scanDatabase(connString) {
  const client = await connect(connString)
  try {
    const { rows: cols } = await client.query(`
      SELECT c.table_name, c.column_name, c.data_type
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position`)
    const { rows: sizes } = await client.query(`
      SELECT relname AS table_name, GREATEST(reltuples, 0)::bigint AS approx_rows
      FROM pg_class JOIN pg_namespace n ON n.oid = relnamespace
      WHERE n.nspname = 'public' AND relkind = 'r'`)
    const sizeByTable = new Map(sizes.map((r) => [r.table_name, Number(r.approx_rows)]))

    const byTable = new Map()
    for (const r of cols) {
      if (!byTable.has(r.table_name)) byTable.set(r.table_name, [])
      byTable.get(r.table_name).push({ name: r.column_name, type: r.data_type })
    }

    const tables = []
    for (const [table, columns] of byTable) {
      if (SKIP_TABLES.test(table)) continue
      const names = columns.map((c) => c.name)
      const userColumn = USER_COLS.find((c) => names.includes(c)) ?? null
      const tsCandidates = columns.filter(
        (c) => TS_COLS.includes(c.name) && /timestamp|date/.test(c.type),
      )
      const timestampColumn = TS_COLS.map((n) => tsCandidates.find((c) => c.name === n)).find(Boolean)?.name ?? null
      tables.push({
        table,
        columns: names,
        user_column: userColumn,
        timestamp_column: timestampColumn,
        approx_rows: sizeByTable.get(table) ?? 0,
        eligible: Boolean(userColumn && timestampColumn),
        suggested_event: `created_${singular(toSnake(table))}`,
        suggested_label: `Created ${singular(toSnake(table)).replace(/_/g, ' ')}`,
      })
    }
    tables.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.approx_rows - a.approx_rows)
    return { tables }
  } finally {
    await client.end()
  }
}

/**
 * Import events for the selected mappings. Identifiers are validated against
 * a fresh introspection before any query is built.
 */
export async function importFromDatabase(connString, mappings, { days = 90, maxRowsPerTable = 50000 } = {}) {
  const { tables } = await scanDatabase(connString)
  const known = new Map(tables.map((t) => [t.table, new Set(t.columns)]))

  const client = await connect(connString)
  try {
    const events = []
    const summary = []
    for (const m of mappings) {
      const colSet = known.get(m.table)
      if (!colSet || !colSet.has(m.user_column) || !colSet.has(m.timestamp_column)) {
        summary.push({ table: m.table, event: m.event, rows: 0, error: 'unknown table or column' })
        continue
      }
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(m.event)) {
        summary.push({ table: m.table, event: m.event, rows: 0, error: 'event key must be snake_case' })
        continue
      }
      const q = (id) => client.escapeIdentifier(id)
      const sql = `
        SELECT ${q(m.user_column)}::text AS user_id, ${q(m.timestamp_column)} AS ts
        FROM ${q(m.table)}
        WHERE ${q(m.user_column)} IS NOT NULL
          AND ${q(m.timestamp_column)} > now() - ($1 || ' days')::interval
        ORDER BY ${q(m.timestamp_column)} DESC
        LIMIT $2`
      try {
        const { rows } = await client.query(sql, [String(days), maxRowsPerTable])
        for (const r of rows) {
          const ts = new Date(r.ts).getTime()
          if (!Number.isNaN(ts)) events.push({ userId: r.user_id, event: m.event, ts })
        }
        summary.push({ table: m.table, event: m.event, rows: rows.length })
      } catch (err) {
        summary.push({ table: m.table, event: m.event, rows: 0, error: err.message })
      }
    }
    events.sort((a, b) => a.ts - b.ts)
    return { events, summary }
  } finally {
    await client.end()
  }
}
