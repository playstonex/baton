import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const hosts = sqliteTable('hosts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  hostname: text('hostname'),
  os: text('os'),
  status: text('status', { enum: ['online', 'offline', 'error'] }).notNull().default('offline'),
  publicKey: text('public_key'),
  lastSeen: text('last_seen'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  hostId: text('host_id').notNull().references(() => hosts.id),
  agentType: text('agent_type').notNull(),
  projectPath: text('project_path').notNull(),
  status: text('status', { enum: ['starting', 'running', 'idle', 'error', 'stopped'] }).notNull().default('starting'),
  startedAt: text('started_at').notNull().$defaultFn(() => new Date().toISOString()),
  stoppedAt: text('stopped_at'),
});

export const sessionLogs = sqliteTable('session_logs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  type: text('type').notNull(),
  content: text('content', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const fileChanges = sqliteTable('file_changes', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  filePath: text('file_path').notNull(),
  changeType: text('change_type', { enum: ['create', 'modify', 'delete'] }).notNull(),
  diff: text('diff'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  name: text('name').notNull(),
  token: text('token').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});
