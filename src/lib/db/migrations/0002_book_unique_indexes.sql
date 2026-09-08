-- Deduplicate books and enforce the unique indexes that 0000 declares.
--
-- Databases created before the versioned migration runner may be missing
-- these indexes (they were previously repaired by ad-hoc startup code).
-- Both statements are idempotent, so this migration is a no-op on a
-- database created from 0000.
DELETE FROM books WHERE id IN (
  SELECT b.id FROM books b
  INNER JOIN (
    SELECT file_hash, MIN(added_at) AS min_added
    FROM books GROUP BY file_hash HAVING COUNT(*) > 1
  ) d ON b.file_hash = d.file_hash AND b.added_at > d.min_added
);
--> statement-breakpoint
DELETE FROM books WHERE id IN (
  SELECT b.id FROM books b
  INNER JOIN (
    SELECT file_path, MIN(added_at) AS min_added
    FROM books GROUP BY file_path HAVING COUNT(*) > 1
  ) d ON b.file_path = d.file_path AND b.added_at > d.min_added
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `books_file_path_unique` ON `books` (`file_path`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `books_file_hash_unique` ON `books` (`file_hash`);
