import { changesOf, transaction } from "@/lib/db/rust";

/**
 * Account deletion (F12).
 *
 * `DELETE FROM users` on its own fails with `FOREIGN KEY constraint failed`
 * for any account that has actually been used: `reading_progress.user_id`
 * and `collections.user_id` both reference `users(id)` with
 * `ON DELETE NO ACTION`, and the SQLite bridge runs with
 * `PRAGMA foreign_keys=ON`.  Tests that only ever deleted freshly created,
 * unused accounts never saw it.
 *
 * The semantics are explicit rather than incidental:
 *
 *  - Reading progress is personal state and goes with the account.
 *  - Collections are owned by the account, so they and their membership
 *    rows go too.
 *  - Books are library content, shared across accounts, and are never
 *    touched by deleting a user.
 *
 * Every step runs in one transaction, so a failure part-way through leaves
 * the account and all of its state intact instead of half-deleted.
 */
export interface DeleteAccountResult {
  deleted: boolean;
  removedProgress: number;
  removedCollections: number;
  removedCollectionBooks: number;
}

export async function deleteAccount(id: string): Promise<DeleteAccountResult> {
  const results = await transaction([
    {
      sql: `
        DELETE FROM collection_books
        WHERE collection_id IN (SELECT id FROM collections WHERE user_id = ?1)
      `,
      params: [id],
    },
    { sql: "DELETE FROM collections WHERE user_id = ?1", params: [id] },
    { sql: "DELETE FROM reading_progress WHERE user_id = ?1", params: [id] },
    { sql: "DELETE FROM users WHERE id = ?1", params: [id] },
  ]);

  return {
    removedCollectionBooks: changesOf(results[0]),
    removedCollections: changesOf(results[1]),
    removedProgress: changesOf(results[2]),
    deleted: changesOf(results[3]) > 0,
  };
}
