import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schemaExports from '../drizzle/schema';

const ROOT = path.resolve(__dirname, "..");
const schema = readFileSync(path.join(ROOT, "drizzle", "schema.ts"), "utf-8");
const db = readFileSync(path.join(ROOT, "server", "db.ts"), "utf-8");

interface TableInfo {
  /** The Drizzle variable name, e.g. `channelBindings`. */
  varName: string;
  /** The table name, e.g. `channel_bindings`. */
  tableName: string;
  columns: Set<string>;
}

/**
 * The tables the schema declares, with the columns each one carries.
 *
 * The brace counting is what makes the callback form
 * (`pgTable("t", {...}, (table) => ({...}))`) parse.
 */
function declaredTables(src: string): TableInfo[] {
  const out: TableInfo[] = [];
  const pattern = /export const (\w+) = pgTable\(\s*"([a-z_]+)",\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(src)) !== null) {
    let i = match.index + match[0].length - 1;
    let depth = 0;
    while (i < src.length) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    const body = src.slice(match.index + match[0].length, i);
    out.push({
      varName: match[1],
      tableName: match[2],
      columns: new Set(Array.from(body.matchAll(/^\s{2}(\w+):\s/gm)).map((m) => m[1])),
    });
  }
  return out;
}

/** The tables a delete function removes, by their Drizzle variable name. */
function tablesDeletedIn(fnName: string): Set<string> {
  const match = new RegExp(
    `export async function ${fnName}\\([\\s\\S]*?\\n\\}\\n`,
  ).exec(db);
  if (!match) return new Set();
  return new Set(Array.from(match[0].matchAll(/tx\.delete\((\w+)\)/g)).map((m) => m[1]));
}

const tables = Object.entries(schemaExports).filter(([,value])=>is(value,PgTable)).map(([varName,value])=>{
  const config=getTableConfig(value as PgTable);
  return {varName,tableName:config.name,columns:new Set(config.columns.map(column=>column.name)),foreignKeys:config.foreignKeys};
});
function clearsOwner(table:typeof tables[number],column:string) {
  return table.foreignKeys.some(fk=>['cascade','set null'].includes(fk.onDelete??'')&&fk.reference().columns.some(item=>item.name===column));
}

describe("deleting a user cleans up after them", () => {
  const deleted = tablesDeletedIn("deleteUserAccount");

  it("deletes from every user-scoped table", () => {
    // Legacy tables use explicit deletes; newer tables declare owner cleanup through foreign keys.
    const missing = tables
      .filter((t) => t.columns.has("userId"))
      .filter((t) => !deleted.has(t.varName) && !clearsOwner(t,'userId'))
      .map((t) => t.tableName)
      .sort();

    expect(missing, "these tables are not cleaned up on account deletion").toEqual([]);
  });

  it("deletes the user row itself", () => {
    expect(deleted.has("users")).toBe(true);
  });

  it("runs in a transaction", () => {
    const match = /export async function deleteUserAccount\([\s\S]*?\}\n/.exec(db);
    expect(match?.[0]).toContain("withTransaction");
  });
});

describe("deleting a persona cleans up after it", () => {
  const deleted = tablesDeletedIn("deletePersona");

  it("deletes from every persona-scoped table", () => {
    const missing = tables
      .filter((t) => t.columns.has("personaId"))
      .filter((t) => !deleted.has(t.varName) && !clearsOwner(t,'personaId'))
      .map((t) => t.tableName)
      .sort();

    expect(missing, "these tables are not cleaned up on persona deletion").toEqual([]);
  });

  it("leaves the user's own settings alone", () => {
    // An LLM configuration or a template belongs to the user, not to one
    // persona — deleting a persona must not take them with it.
    expect(deleted.has("llmConfigs")).toBe(false);
    expect(deleted.has("personaTemplates")).toBe(false);
    expect(deleted.has("collectionSources")).toBe(false);
  });

  it("runs in a transaction", () => {
    const match = /export async function deletePersona\([\s\S]*?\}\n/.exec(db);
    expect(match?.[0]).toContain("withTransaction");
  });
});
