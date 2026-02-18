import { type Page, type Locator } from '@playwright/test';

export class EpubReaderPage {
  readonly page: Page;
  readonly backButton: Locator;
  readonly tocButton: Locator;
  readonly settingsButton: Locator;
  readonly previousChapterButton: Locator;
  readonly nextChapterButton: Locator;
  readonly progressBar: Locator;
  readonly readerContent: Locator;
  readonly tocSidebar: Locator;

  constructor(page: Page) {
    this.page = page;
    // The back button is the first link in the header (ArrowLeft icon, no aria-label)
    this.backButton = page.locator('header').first().getByRole('link').first();
    this.tocButton = page.getByRole('button', { name: 'Table of contents' });
    this.settingsButton = page.getByRole('button', { name: 'Reading settings' });
    this.previousChapterButton = page.getByRole('button', { name: 'Previous chapter' });
    this.nextChapterButton = page.getByRole('button', { name: 'Next chapter' });
    // The progress bar fill div has an inline width style
    this.progressBar = page.locator('header [style*="width"]').first();
    // The EPUB content container (wraps the iframe in scrolled-continuous mode)
    this.readerContent = page.locator('.epub-container').first();
    // The TOC sidebar panel
    this.tocSidebar = page.locator('h2').filter({ hasText: 'Table of Contents' }).locator('../..');
  }

  async scrollDown(): Promise<void> {
    await this.page.evaluate(() => {
      const container = document.querySelector('.epub-container') as HTMLElement | null;
      if (container) {
        container.scrollTop += 500;
      } else {
        window.scrollBy(0, 500);
      }
    });
  }

  async clickNextChapter(): Promise<void> {
    await this.nextChapterButton.click();
  }

  async clickPreviousChapter(): Promise<void> {
    await this.previousChapterButton.click();
  }

  async openToc(): Promise<void> {
    await this.tocButton.click();
    // Wait for the TOC sidebar to appear
    await this.page.locator('h2').filter({ hasText: 'Table of Contents' }).waitFor({
      state: 'visible',
      timeout: 5000,
    });
  }

  async clickTocItem(label: string): Promise<void> {
    await this.page.getByRole('button', { name: label }).click();
  }

  async openSettings(): Promise<void> {
    await this.settingsButton.click();
    // Wait for the settings panel to appear
    await this.page.locator('h3').filter({ hasText: 'Reading Settings' }).waitFor({
      state: 'visible',
      timeout: 5000,
    });
  }

  async setFontSize(size: 'small' | 'medium' | 'large' | 'xl'): Promise<void> {
    const labels = { small: 'S', medium: 'M', large: 'L', xl: 'XL' };
    // Font size buttons are inside the settings panel (div with shadow-xl)
    const settingsPanel = this.page.locator('[class*="shadow-xl"]');
    await settingsPanel.getByRole('button', { name: labels[size], exact: true }).click();
  }

  async getProgressPercent(): Promise<number> {
    // ReadingProgressMeter renders a span with "X.XX%" in the header
    try {
      const header = this.page.locator('header').first();
      const spans = header.locator('span').filter({ hasText: /\d+\.\d+%/ });
      const count = await spans.count();
      if (count === 0) return 0;
      const text = await spans.last().textContent();
      const match = text?.match(/(\d+(?:\.\d+)?)%/);
      return match ? parseFloat(match[1]) : 0;
    } catch {
      return 0;
    }
  }

  async waitForLoad(): Promise<void> {
    // Wait for the "Loading ePub…" spinner to disappear
    const loadingText = this.page.getByText('Loading ePub…');
    try {
      await loadingText.waitFor({ state: 'visible', timeout: 5000 });
      await loadingText.waitFor({ state: 'hidden', timeout: 30000 });
    } catch {
      // Loading may have already completed before we checked
    }
    // Wait for the epub container to be visible
    await this.page.locator('.epub-container, iframe').first().waitFor({
      state: 'visible',
      timeout: 30000,
    });
    // Give epubjs time to render initial content
    await this.page.waitForTimeout(1000);
  }
}
