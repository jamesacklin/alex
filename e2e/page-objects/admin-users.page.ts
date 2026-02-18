import { type Locator, type Page } from '@playwright/test';

export class AdminUsersPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get addUserButton(): Locator {
    return this.page.getByRole('button', { name: /add user/i });
  }

  get userTable(): Locator {
    return this.page.getByRole('table');
  }

  userRowByEmail(email: string): Locator {
    return this.userTable.locator('tr', {
      has: this.page.getByRole('cell', { name: new RegExp(`^${escapeRegex(email)}$`) }),
    });
  }

  editUserButton(email: string): Locator {
    return this.userRowByEmail(email).getByRole('button', { name: /edit/i });
  }

  deleteUserButton(email: string): Locator {
    return this.userRowByEmail(email).getByRole('button', { name: /delete/i });
  }

  get createUserDialog(): Locator {
    return this.page.getByRole('dialog', { name: /add user|create user/i });
  }

  get emailInput(): Locator {
    return this.page.getByRole('textbox', { name: /email/i });
  }

  get displayNameInput(): Locator {
    return this.page.getByRole('textbox', { name: /display name/i });
  }

  get passwordInput(): Locator {
    return this.page.getByLabel(/password/i);
  }

  get roleSelect(): Locator {
    return this.createUserDialog.locator('button[role="combobox"]').first();
  }

  get saveUserButton(): Locator {
    return this.page.getByRole('button', { name: /create user|save user|save/i });
  }

  get deleteConfirmButton(): Locator {
    return this.page.getByRole('alertdialog').getByRole('button', { name: /^delete$/i });
  }

  async createUser(
    email: string,
    displayName: string,
    password: string,
    role: 'admin' | 'user',
  ): Promise<void> {
    await this.addUserButton.click();
    await this.createUserDialog.waitFor({ state: 'visible' });
    await this.emailInput.fill(email);
    await this.displayNameInput.fill(displayName);
    await this.passwordInput.fill(password);
    await this.roleSelect.click();
    await this.page.getByRole('option', { name: new RegExp(`^${role}$`, 'i') }).click();
    await this.saveUserButton.click();
  }

  async deleteUser(email: string): Promise<void> {
    await this.deleteUserButton(email).click();
    await this.deleteConfirmButton.click();
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
