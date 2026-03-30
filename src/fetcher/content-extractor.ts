import type { Page } from 'playwright';

// Drupal-specific selectors should be tried first to avoid capturing
// global navigation/menu boilerplate. These are ordered from most
// specific Drupal node wrappers to more generic fallbacks.
const MAIN_CONTENT_SELECTORS = [
  '[data-history-node-id]', // Drupal node content wrapper
  'article.node', // Drupal article node
  '.node--view-mode-full',
  '.layout-main-wrapper',
  'main article',
  'main .region-content',
  // existing generic fallbacks
  'article',
  'main',
  '.content',
  '#content',
  '.region-content',
  '#block-system-main',
];

export async function extractMainContentHtml(page: Page): Promise<string> {
  // Prefer the matched selector whose element contains the most text; this
  // avoids selecting small navigation blocks that share common class names.
  const extracted = await page.evaluate((selectors) => {
    let best: HTMLElement | null = null;
    let bestLen = 0;

    for (const selector of selectors) {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) continue;
      const text = (el.textContent ?? '').trim();
      const len = text.length;
      if (len > bestLen) {
        bestLen = len;
        best = el;
      }
    }

    if (best) return best.outerHTML;

    const body = document.querySelector('body');
    return body ? body.outerHTML : '';
  }, MAIN_CONTENT_SELECTORS);

  return extracted;
}

export async function extractTextFromHtml(page: Page): Promise<string> {
  const text = await page.evaluate((selectors) => {
    let bestText = '';
    for (const selector of selectors) {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) continue;
      const t = (el.textContent ?? '').trim();
      if (t.length > bestText.length) bestText = t;
    }

    if (bestText) return bestText;
    return (document.body?.textContent ?? '').trim();
  }, MAIN_CONTENT_SELECTORS);

  return text;
}
