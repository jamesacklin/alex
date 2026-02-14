import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { books } from '@/lib/db/schema';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Only allow requests from localhost (Electron)
  const host = request.headers.get('host');
  if (!host?.includes('localhost') && !host?.includes('127.0.0.1')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Get count before deletion
    const allBooks = await db.select().from(books);
    const bookCount = allBooks.length;

    console.log(`[API] Found ${bookCount} books to delete`);

    if (bookCount === 0) {
      return NextResponse.json({ success: true, deleted: 0, message: 'No books to clear' });
    }

    // Delete all books (cascading deletes will handle reading_progress and collection_books)
    await db.delete(books);
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
      message: `Deleted ${bookCount} books and ${deletedCovers} cover images`,
    });
  } catch (error) {
    console.error('[API] Failed to clear books:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
