import { pgTable, integer, jsonb, timestamp, serial, uniqueIndex } from 'drizzle-orm/pg-core';
import { users, personas } from './schema';
export const chatContextStates = pgTable('chat_context_states', {
  id: serial('id').primaryKey(),
  userId: integer('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  personaId: integer('personaId').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  startAfterMessageId: integer('startAfterMessageId').default(0).notNull(),
  overrides: jsonb('overrides').$type<Record<string, boolean>>().default({}).notNull(),
  revision: integer('revision').default(0).notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
}, table => ({ owner: uniqueIndex('chat_context_states_owner_idx').on(table.userId, table.personaId) }));
export const chatDeletionBackups = pgTable('chat_deletion_backups', {
  id: serial('id').primaryKey(),
  userId: integer('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  personaId: integer('personaId').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').notNull(), createdAt: timestamp('createdAt').defaultNow().notNull(),
});
