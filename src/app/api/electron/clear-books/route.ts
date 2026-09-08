import { NextRequest, NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db/rust';
import { isDesktopMode, isDesktopRequestAuthorized } from '@/lib/auth/desktop-auth';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

/**
 * Desktop-only library wipe (F04).
 *
 * This endpoint used to check the desktop capability only *when desktop
 * mode was enabled*; in ordinary web mode it fell back to matching a
 * substring of the request's own `Host` header. Because the path is not
 * under `/api/admin`, middleware admitted any authenticated account, so an
 * ordinary reader on the documented localhost deployment could delete every
 * book — and with the cascades, everyone's reading progress and collection
 * membership. A forwarded `Host` containing `localhost` was accepted too.
 *
 * The route is now unconditionally unavailable outside desktop mode, and
 * inside desktop mode it requires the desktop capability token on every
 * request. `Host` is caller-controlled and is not an authorization signal.
 * Administrators use the separately authorized POST /api/admin/library/clear.
 */
export async function POST(request: NextRequest) {
  if (!isDesktopMode()) {
    // Not "forbidden for you" — this operation does not exist here.
    return NextResponse.json(
      {
        success: false,
        error: 'Not found',
        details: 'This endpoint is only available in the desktop app.',
      },
      { status: 404 }
    );
  }

  if (!isDesktopRequestAuthorized(request.headers)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get count before deletion
    const countRow = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM books');
    const bookCount = Number(countRow?.total ?? 0);

    console.log(`[API] Found ${bookCount} books to delete`);

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
      message: `Deleted ${bookCount} books and ${deletedCovers} cover images`,
    });
  } catch (error) {
    console.error('[API] Failed to clear books:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
