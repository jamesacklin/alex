import { NextResponse } from 'next/server';
import { authSession } from '@/lib/auth/config';
import { execute, queryOne } from '@/lib/db/rust';
import * as fs from 'fs';
import * as path from 'path';

export async function POST() {
  const session = await authSession();

  // Require admin role
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Get count before deletion
    const countRow = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM books');
    const bookCount = Number(countRow?.total ?? 0);

    console.log(`[API] Admin clearing library: Found ${bookCount} books to delete`);

    if (bookCount === 0) {
      return NextResponse.json({ success: true, deleted: 0, message: 'No books to clear' });
    }

    // Delete all books (cascading deletes will handle reading_progress and collection_books)
    await execute('DELETE FROM books');
    console.log(`[API] Deleted ${bookCount} books from database`);

    // Clear cover images
    const coversPath = process.env.COVERS_PATH || path.join(process.cwd(), 'data', 'covers');
    let deletedCovers = 0;

    if (fs.existsSync(coversPath)) {
      const coverFiles = fs.readdirSync(coversPath);
      for (const file of coverFiles) {
        try {
          fs.unlinkSync(path.join(coversPath, file));
          deletedCovers++;
        } catch (err) {
          console.warn(`[API] Failed to delete cover file ${file}:`, err);
        }
      }
      console.log(`[API] Deleted ${deletedCovers} cover images`);
    }

    return NextResponse.json({
      success: true,
      deleted: bookCount,
      deletedCovers,
      message: `Deleted ${bookCount} books and ${deletedCovers} cover images. The watcher will re-index files.`,
    });
  } catch (error) {
    console.error('[API] Failed to clear library:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
