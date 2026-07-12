import type { Page } from '@playwright/test';

/** Replace the CodeMirror document through the keyboard — the same path a
 *  user's edit takes (CM update listener → store.setSource → 300 ms debounce
 *  → worker parse). insertText is a single input event: fast, and it never
 *  triggers auto-close-brackets the way per-character typing would. */
export async function setEditorText(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}

/** The starter diagram every fresh browser context boots into. */
export const STARTER_TABLE_COUNT = 3;
