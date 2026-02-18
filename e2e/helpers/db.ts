import { db } from '../../src/lib/db';
import { users, books, readingProgress, collections, collectionBooks, settings } from '../../src/lib/db/schema';
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
  await db.delete(collectionBooks);
  await db.delete(collections);
  await db.delete(readingProgress);
  await db.delete(books);
  await db.delete(users);
  await db.delete(settings);
}

/**
 * Seed database with test users and books
 */
export async function seedDatabase() {
  const now = Math.floor(Date.now() / 1000);

  // Create users
  const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const userPasswordHash = await bcrypt.hash(USER_PASSWORD, 10);

  await db.insert(users).values([
    {
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      passwordHash: adminPasswordHash,
      displayName: 'Admin',
      role: 'admin',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: USER_ID,
      email: USER_EMAIL,
      passwordHash: userPasswordHash,
      displayName: 'Test User',
      role: 'user',
      createdAt: now,
      updatedAt: now,
    },
  ]);

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

  await db.insert(books).values([
    {
      id: 'book-pdf-1',
      title: 'Sample PDF Book',
      author: 'Alice Author',
      description: 'A sample PDF for testing',
      fileType: 'pdf',
      filePath: pdfPath,
      fileSize: pdfInfo.fileSize,
      fileHash: pdfInfo.fileHash,
      coverPath: coverPdfPath,
      pageCount: 2,
      addedAt: now - 1000,
      updatedAt: now - 1000,
    },
    {
      id: 'book-epub-1',
      title: 'Sample EPUB Book',
      author: 'Bob Writer',
      description: 'A sample EPUB for testing',
      fileType: 'epub',
      filePath: epubPath,
      fileSize: epubInfo.fileSize,
      fileHash: epubInfo.fileHash,
      coverPath: coverEpubPath,
      pageCount: null,
      addedAt: now - 2000,
      updatedAt: now - 2000,
    },
    {
      id: 'book-pdf-2',
      title: 'Another PDF Book',
      author: 'Charlie Editor',
      description: 'Another PDF for testing',
      fileType: 'pdf',
      filePath: pdf2Path,
      fileSize: pdf2Info.fileSize,
      fileHash: pdf2Info.fileHash,
      coverPath: coverPdf2Path,
      pageCount: 1,
      addedAt: now - 3000,
      updatedAt: now - 3000,
    },
  ]);
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

  const booksToInsert = [];
  for (let i = 0; i < count; i++) {
    const isPdf = i % 2 === 0;
    const info = isPdf ? pdfInfo : epubInfo;
    const uniqueHash = crypto.createHash('sha256')
      .update(info.fileHash + i.toString())
      .digest('hex');

    booksToInsert.push({
      id: `book-${i}`,
      title: `Test Book ${i.toString().padStart(2, '0')}`,
      author: `Author ${String.fromCharCode(65 + (i % 26))}`,
      description: `Test book number ${i}`,
      fileType: isPdf ? 'pdf' : 'epub',
      filePath: `${isPdf ? pdfPath : epubPath}-${i}`,
      fileSize: info.fileSize,
      fileHash: uniqueHash,
      coverPath: isPdf ? coverPdfPath : coverEpubPath,
      pageCount: isPdf ? 2 : null,
      addedAt: now - (i * 100),
      updatedAt: now - (i * 100),
    });
  }

  await db.insert(books).values(booksToInsert);
}
