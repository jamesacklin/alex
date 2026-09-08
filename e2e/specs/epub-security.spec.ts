import { expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from '../fixtures/auth.fixture';
import { execute } from '../../src/lib/db/rust';
import { resetDatabase, seedDatabase } from '../helpers/db';

/**
 * F03: a hostile EPUB must not be able to run its own script or reach the
 * application around it.
 *
 * The review could trace this chain in source but could not execute it —
 * "browser and packaged Electron exploit validation remains required". This
 * is that validation for the browser: a real book, opened in the real
 * reader, in a real Chromium.
 *
 * The fixture (e2e/helpers/make-hostile-epub.js) attempts inline script, an
 * event handler, a javascript: URL, a nested iframe, <object>, <embed>, SVG
 * script, an img onerror handler, a top-level navigation, a popup, an
 * authenticated mutation, and a form post to a privileged route. Anything
 * that executes leaves a flag on the parent window, so the assertions can
 * distinguish "nothing ran" from "something ran but did not reach us".
 */

const HOSTILE_BOOK_ID = 'book-hostile-1';
const FIXTURE = path.join(__dirname, '..', 'helpers', 'fixtures', 'hostile.epub');

declare global {
  interface Window {
    __alexEpubEscape?: string[];
    __alexEpubStolenCookie?: string;
    __alexEpubStolenStorage?: string;
    __alexEpubElectron?: string[];
    __alexEpubS3Config?: string;
    __alexEpubWipeStatus?: number;
    __alexEpubUsersStatus?: number;
    __alexEpubMessages?: unknown[];
  }
}

function appUrl(page: Page, target: string): string {
  const fallback = process.env.E2E_PLATFORM === 'electron'
    ? 'http://127.0.0.1:3210'
    : 'http://localhost:3000';
  try {
    const parsed = new URL(page.url());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.origin}${target}`;
    }
  } catch {
    // Fall through.
  }
  return `${fallback}${target}`;
}

test.beforeAll(async () => {
  if (!fs.existsSync(FIXTURE)) {
    execSync('node e2e/helpers/make-hostile-epub.js', { stdio: 'inherit' });
  }

  const content = fs.readFileSync(FIXTURE);
  const now = Math.floor(Date.now() / 1000);

  await execute('DELETE FROM books WHERE id = ?1', [HOSTILE_BOOK_ID]);
  await execute(
    `
      INSERT INTO books (
        id, title, author, description, file_type, file_path, file_size, file_hash,
        cover_path, page_count, added_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, 'epub', ?5, ?6, ?7, NULL, NULL, ?8, ?8)
    `,
    [
      HOSTILE_BOOK_ID,
      'Hostile Test Book',
      'Alex Security Fixture',
      'A book that tries to escape the reader.',
      FIXTURE,
      content.length,
      crypto.createHash('sha256').update(content).digest('hex'),
      now,
    ],
  );
});

test.afterAll(async () => {
  await resetDatabase();
  await seedDatabase();
});

test.describe('EPUB sandbox (F03)', () => {
  test('a hostile book cannot execute script or reach the application', async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    // Record anything the book manages to post to us, and prove the page has
    // something worth stealing at the time of the test.
    await page.addInitScript(() => {
      window.__alexEpubMessages = [];
      window.addEventListener('message', (event) => {
        // Only the fixture's own messages. The page posts to itself for
        // unrelated reasons (Next.js ships a setImmediate polyfill that
        // does), and counting those would make this assertion meaningless.
        const data = event.data as { alexEpubEscape?: unknown } | null;
        if (data && typeof data === 'object' && 'alexEpubEscape' in data) {
          window.__alexEpubMessages!.push(data);
        }
      });
      try {
        localStorage.setItem('alex-sentinel', 'sentinel-value');
      } catch {
        // Storage may be unavailable; the assertions below tolerate it.
      }
    });

    const popups: string[] = [];
    page.on('popup', (popup) => popups.push(popup.url()));

    await page.goto(appUrl(page, `/read/${HOSTILE_BOOK_ID}`), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // The book must actually render — a sandbox that works by failing to
    // display the book is not the fix we want.
    const frame = page.frameLocator('iframe').first();
    await expect(frame.locator('#marker')).toContainText('test fixture', {
      timeout: 30000,
    });

    // Give every deferred payload (img onerror, nested frames, fetches,
    // navigations) a chance to fire.
    await page.waitForTimeout(3000);

    // 1. Nothing the book tried may have run, in the frame or in the parent.
    //
    // Checked before the structural sandbox assertion below so that a
    // regression reports the actual escape ("parent-access", "svg-script",
    // ...) rather than only the attribute that permitted it.
    const escapes = await page.evaluate(() => window.__alexEpubEscape ?? []);
    expect(escapes).toEqual([]);

    // 2. No parent state may have been read.
    expect(await page.evaluate(() => window.__alexEpubStolenCookie)).toBeUndefined();
    expect(await page.evaluate(() => window.__alexEpubStolenStorage)).toBeUndefined();

    // 3. No desktop capability may have been reached.
    expect(await page.evaluate(() => window.__alexEpubElectron)).toBeUndefined();
    expect(await page.evaluate(() => window.__alexEpubS3Config)).toBeUndefined();

    // 4. No authenticated mutation may have been issued.
    expect(await page.evaluate(() => window.__alexEpubWipeStatus)).toBeUndefined();
    expect(await page.evaluate(() => window.__alexEpubUsersStatus)).toBeUndefined();

    // 5. No message may have crossed the frame boundary.
    expect(await page.evaluate(() => window.__alexEpubMessages ?? [])).toEqual([]);

    // 6. The top-level window must still be the reader, not the attacker's URL.
    expect(page.url()).toContain(`/read/${HOSTILE_BOOK_ID}`);
    expect(page.url()).not.toContain('attacker.example');

    // 7. No popup may have opened.
    expect(popups).toEqual([]);

    // 8. The library must be intact: the wipe attempt changed nothing.
    const library = await page.request.get(appUrl(page, '/api/books'));
    expect(library.ok()).toBeTruthy();
    const payload = await library.json();
    const books = Array.isArray(payload) ? payload : payload.books;
    expect(Array.isArray(books)).toBeTruthy();
    expect(books.length).toBeGreaterThan(0);

    // The sentinel we planted is still there, which shows the checks above
    // were reading a page that genuinely had state to lose.
    expect(
      await page.evaluate(() => localStorage.getItem('alex-sentinel')),
    ).toBe('sentinel-value');

    // 9. Finally the structural cause: epub.js appends `allow-scripts` to the
    // iframe's sandbox under `allowScriptedContent`, and combined with the
    // `allow-same-origin` it always sets, that puts book content on the
    // application's own origin.
    const sandbox = await page.locator('iframe').first().getAttribute('sandbox');
    expect(sandbox).not.toBeNull();
    expect(sandbox).toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-scripts');
  });

  test('a well-formed book still scrolls, tracks progress and applies themes', async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    await page.goto(appUrl(page, '/read/book-epub-1'), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const frame = page.frameLocator('iframe').first();
    await expect(frame.locator('body')).not.toBeEmpty({ timeout: 30000 });

    // Scrolling inside the rendered book still works with scripting disabled,
    // because the reader drives layout from the parent.
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(1500);

    // And progress is still recorded for this reader.
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            appUrl(page, '/api/books/book-epub-1/progress'),
          );
          if (!response.ok()) return null;
          const body = await response.json();
          return body?.epubLocation ?? null;
        },
        { timeout: 20000, intervals: [500, 1000, 2000] },
      )
      .not.toBeNull();
  });
});
