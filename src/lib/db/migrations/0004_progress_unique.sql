-- One reading_progress row per (user, book) (F12).
--
-- Existing duplicates are collapsed with a documented tie-breaker:
-- keep the most recently read row; if `last_read_at` ties, keep the one
-- that is furthest through the book (percent_complete, then current_page);
-- if everything ties, keep the lowest id so the result is deterministic
-- and identical across replicas of the same database.
DELETE FROM reading_progress
WHERE id NOT IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, book_id
        ORDER BY
          COALESCE(last_read_at, 0) DESC,
          percent_complete DESC,
          current_page DESC,
          id ASC
      ) AS row_rank
    FROM reading_progress
  ) ranked
  WHERE row_rank = 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `reading_progress_user_book_unique`
  ON `reading_progress` (`user_id`, `book_id`);
