import { type Page, type Locator } from '@playwright/test';

export class PdfReaderPage {
  readonly page: Page;
  readonly backButton: Locator;
  readonly pageNumberDisplay: Locator;
  readonly previousPageButton: Locator;
  readonly nextPageButton: Locator;
  readonly pageInput: Locator;
  readonly zoomInButton: Locator;
  readonly zoomOutButton: Locator;
  readonly progressBar: Locator;

  constructor(page: Page) {
    this.page = page;
    this.backButton = page.getByRole('link', { name: 'Back' });
    this.previousPageButton = page.getByRole('button', { name: 'Previous page' });
    this.nextPageButton = page.getByRole('button', { name: 'Next page' });
    this.pageInput = page.locator('header input[type="number"]');
    // The page display is the center span containing the input, "/", and total pages
    this.pageNumberDisplay = page.locator('header').locator('.mx-auto');
    this.zoomInButton = page.getByRole('button', { name: 'Zoom in' });
    this.zoomOutButton = page.getByRole('button', { name: 'Zoom out' });
    // PDF reader has no progress bar UI; use the rendered document as a load indicator
    this.progressBar = page.locator('.react-pdf__Document').first();
  }

  async getCurrentPage(): Promise<number> {
    const value = await this.pageInput.inputValue();
    return parseInt(value, 10) || 1;
  }

  async getTotalPages(): Promise<number> {
    // Sibling spans after the input: "/" span, then total pages span (last sibling)
    const totalSpan = this.page.locator('header input[type="number"] ~ span').last();
    const text = await totalSpan.textContent();
    const num = parseInt(text?.trim() ?? '', 10);
    return isNaN(num) ? 0 : num;
  }

  async clickNextPage(): Promise<void> {
    await this.nextPageButton.click();
  }

  async clickPreviousPage(): Promise<void> {
    await this.previousPageButton.click();
  }

  async jumpToPage(pageNum: number): Promise<void> {
    await this.pageInput.fill(String(pageNum));
    await this.pageInput.press('Tab');
  }

  async getProgressPercent(): Promise<number> {
    const current = await this.getCurrentPage();
    const total = await this.getTotalPages();
    if (total === 0) return 0;
    return (current / total) * 100;
  }

  async zoomIn(): Promise<void> {
    await this.zoomInButton.click();
  }

  async zoomOut(): Promise<void> {
    await this.zoomOutButton.click();
  }

  async getZoomPercent(): Promise<number> {
    // The zoom display is a span matching "N%" between zoom buttons
    const zoomSpan = this.page.locator('header span').filter({ hasText: /^\d+%$/ });
    const text = await zoomSpan.textContent();
    const match = text?.match(/(\d+)%/);
    return match ? parseInt(match[1], 10) : 100;
  }

  async waitForLoad(): Promise<void> {
    // Wait for the page input to appear and become enabled
    await this.pageInput.waitFor({ state: 'visible', timeout: 30000 });
    await this.page.waitForFunction(
      () => {
        const input = document.querySelector('header input[type="number"]') as HTMLInputElement | null;
        return input !== null && !input.disabled;
      },
      { timeout: 30000 },
    );
  }
}
