import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

// EXAMPLE: Standard SQLite table optimized for Turso
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // DO NOT use uuid() or serial()
  email: text('email').notNull().unique(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true), // SQLite boolean workaround
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  authorId: text('author_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
});

// EXAMPLE: Explicit relations definition
export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id],
  }),
}));
