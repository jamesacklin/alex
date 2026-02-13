import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("user"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const books = sqliteTable("books", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  author: text("author"),
  description: text("description"),
  fileType: text("file_type").notNull(),
  filePath: text("file_path").notNull().unique(),
  fileSize: integer("file_size").notNull(),
  fileHash: text("file_hash").notNull().unique(),
  coverPath: text("cover_path"),
  pageCount: integer("page_count"),
  addedAt: integer("added_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const readingProgress = sqliteTable("reading_progress", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  currentPage: integer("current_page").notNull().default(0),
  totalPages: integer("total_pages"),
  epubLocation: text("epub_location"),
  percentComplete: real("percent_complete").notNull().default(0),
  status: text("status").notNull().default("not_started"),
  lastReadAt: integer("last_read_at"),
});

export const collections = sqliteTable("collections", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  shareToken: text("share_token").unique(),
  sharedAt: integer("shared_at"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const collectionBooks = sqliteTable(
  "collection_books",
  {
    collectionId: text("collection_id").notNull().references(() => collections.id),
    bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    addedAt: integer("added_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.collectionId, table.bookId] }),
  }),
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

// Relations

export const usersRelations = relations(users, ({ many }) => ({
  readingProgress: many(readingProgress),
  collections: many(collections),
}));

export const booksRelations = relations(books, ({ many }) => ({
  readingProgress: many(readingProgress),
  collectionBooks: many(collectionBooks),
}));

export const readingProgressRelations = relations(readingProgress, ({ one }) => ({
  user: one(users, { fields: [readingProgress.userId], references: [users.id] }),
  book: one(books, { fields: [readingProgress.bookId], references: [books.id] }),
}));

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  user: one(users, { fields: [collections.userId], references: [users.id] }),
  books: many(collectionBooks),
}));

export const collectionBooksRelations = relations(collectionBooks, ({ one }) => ({
  collection: one(collections, { fields: [collectionBooks.collectionId], references: [collections.id] }),
  book: one(books, { fields: [collectionBooks.bookId], references: [books.id] }),
}));
