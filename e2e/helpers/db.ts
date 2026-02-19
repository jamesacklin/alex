import { execute } from '../../src/lib/db/rust';
import * as bcrypt from 'bcryptjs';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

const ADMIN_EMAIL = 'admin@localhost';
const ADMIN_PASSWORD = 'admin123';
const USER_EMAIL = 'user@localhost';
const USER_PASSWORD = 'user123';

const ADMIN_ID = '1';
const USER_ID = '2';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

/**
 * Reset database by truncating all tables
 */
export async function resetDatabase() {
  // Delete in order to respect foreign key constraints
  await execute('DELETE FROM collection_books');
  await execute('DELETE FROM collections');
  await execute('DELETE FROM reading_progress');
  await execute('DELETE FROM books');
  await execute('DELETE FROM users');
  await execute('DELETE FROM settings');
}

/**
 * Seed database with test users and books
 */
export async function seedDatabase() {
  const now = Math.floor(Date.now() / 1000);

  // Create users
  const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const userPasswordHash = await bcrypt.hash(USER_PASSWORD, 10);

  await execute(
    `
      INSERT INTO users (
        id, email, password_hash, display_name, role, created_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `,
    [ADMIN_ID, ADMIN_EMAIL, adminPasswordHash, 'Admin', 'admin', now, now],
  );

  await execute(
    `
      INSERT INTO users (
        id, email, password_hash, display_name, role, created_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `,
    [USER_ID, USER_EMAIL, userPasswordHash, 'Test User', 'user', now, now],
  );

  // Create test books
  const pdfPath = path.join(FIXTURES_DIR, 'sample.pdf');
  const epubPath = path.join(FIXTURES_DIR, 'sample-chapters.epub');
  const pdf2Path = path.join(FIXTURES_DIR, 'sample2.pdf');
  const coverPdfPath = path.join(FIXTURES_DIR, 'cover-pdf.png');
  const coverEpubPath = path.join(FIXTURES_DIR, 'cover-epub.png');
  const coverPdf2Path = path.join(FIXTURES_DIR, 'cover-pdf2.png');

  // Helper to get file size and hash
  function getFileInfo(filePath: string) {
    const content = fs.readFileSync(filePath);
    const fileSize = content.length;
    const fileHash = crypto.createHash('sha256').update(content).digest('hex');
    return { fileSize, fileHash };
  }

  const pdfInfo = getFileInfo(pdfPath);
  const epubInfo = getFileInfo(epubPath);
  const pdf2Info = getFileInfo(pdf2Path);

  await execute(
    `
      INSERT INTO books (
        id, title, author, description, file_type, file_path, file_size, file_hash,
        cover_path, page_count, added_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    `,
    [
      'book-pdf-1',
      'Sample PDF Book',
      'Alice Author',
      'A sample PDF for testing',
      'pdf',
      pdfPath,
      pdfInfo.fileSize,
      pdfInfo.fileHash,
      coverPdfPath,
      2,
      now - 1000,
      now - 1000,
    ],
  );

  await execute(
    `
      INSERT INTO books (
        id, title, author, description, file_type, file_path, file_size, file_hash,
        cover_path, page_count, added_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    `,
    [
      'book-epub-1',
      'Sample EPUB Book',
      'Bob Writer',
      'A sample EPUB for testing',
      'epub',
      epubPath,
      epubInfo.fileSize,
      epubInfo.fileHash,
      coverEpubPath,
      null,
      now - 2000,
      now - 2000,
    ],
  );

  await execute(
    `
      INSERT INTO books (
        id, title, author, description, file_type, file_path, file_size, file_hash,
        cover_path, page_count, added_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    `,
    [
      'book-pdf-2',
      'Another PDF Book',
      'Charlie Editor',
      'Another PDF for testing',
      'pdf',
      pdf2Path,
      pdf2Info.fileSize,
      pdf2Info.fileHash,
      coverPdf2Path,
      1,
      now - 3000,
      now - 3000,
    ],
  );
}

/**
 * Seed many books for pagination testing
 */
export async function seedManyBooks(count: number = 30) {
  const now = Math.floor(Date.now() / 1000);
  const pdfPath = path.join(FIXTURES_DIR, 'sample.pdf');
  const epubPath = path.join(FIXTURES_DIR, 'sample.epub');
  const coverPdfPath = path.join(FIXTURES_DIR, 'cover-pdf.png');
  const coverEpubPath = path.join(FIXTURES_DIR, 'cover-epub.png');

  function getFileInfo(filePath: string) {
    const content = fs.readFileSync(filePath);
    const fileSize = content.length;
    const fileHash = crypto.createHash('sha256').update(content).digest('hex');
    return { fileSize, fileHash };
  }

  const pdfInfo = getFileInfo(pdfPath);
  const epubInfo = getFileInfo(epubPath);

  for (let i = 0; i < count; i++) {
    const isPdf = i % 2 === 0;
    const info = isPdf ? pdfInfo : epubInfo;
    const uniqueHash = crypto.createHash('sha256')
      .update(info.fileHash + i.toString())
      .digest('hex');

    await execute(
      `
        INSERT INTO books (
          id, title, author, description, file_type, file_path, file_size, file_hash,
          cover_path, page_count, added_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
      `,
      [
        `book-${i}`,
        `Test Book ${i.toString().padStart(2, '0')}`,
        `Author ${String.fromCharCode(65 + (i % 26))}`,
        `Test book number ${i}`,
        isPdf ? 'pdf' : 'epub',
        `${isPdf ? pdfPath : epubPath}-${i}`,
        info.fileSize,
        uniqueHash,
        isPdf ? coverPdfPath : coverEpubPath,
        isPdf ? 2 : null,
        now - (i * 100),
        now - (i * 100),
      ],
    );
  }
}
