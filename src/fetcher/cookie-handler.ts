import type { Page } from 'playwright';

export const DEFAULT_COOKIE_SELECTORS: readonly string[] = [
  '#onetrust-accept-btn-handler',
  '.cookie-consent-accept',
  '[data-testid="accept-cookies"]',
  '#CybotCookiebotDialogBodyButtonAccept',
  '.eu-cookie-compliance-accept-button',
  '#cookie-consent-accept',
  'button:has-text("Accept")',
  'button:has-text("Accept All")',
  'button:has-text("I Accept")',
  'button:has-text("Allow")',
  'button:has-text("Allow All")',
  'button[aria-label*="accept" i]',
  'button[title*="accept" i]',
];

export async function dismissCookieConsent(
  page: Page,
  selectors: readonly string[] = DEFAULT_COOKIE_SELECTORS,
  timeoutMs = 1200,
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const button = page.locator(selector).first();
      const visible = await button.isVisible({ timeout: timeoutMs });
      if (!visible) {
        continue;
      }

      await button.click({ timeout: timeoutMs });
      await page.waitForTimeout(250);
      return true;
    } catch {
      // No-op: this is intentionally best-effort.
    }
  }

  return false;
}

export async function preSetConsentCookies(page: Page, url: string): Promise<void> {
  try {
    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname;
    const secure = parsedUrl.protocol === 'https:';
    const now = Math.floor(Date.now() / 1000);
    const oneYear = 60 * 60 * 24 * 365;

    await page.context().addCookies([
      {
        name: 'cookies_accepted',
        value: 'true',
        domain,
        path: '/',
        httpOnly: false,
        secure,
        sameSite: 'Lax',
        expires: now + oneYear,
      },
      {
        name: 'cookie_consent',
        value: 'accepted',
        domain,
        path: '/',
        httpOnly: false,
        secure,
        sameSite: 'Lax',
        expires: now + oneYear,
      },
      {
        name: 'drupalorg_cookie_consent',
        value: '1',
        domain,
        path: '/',
        httpOnly: false,
        secure,
        sameSite: 'Lax',
        expires: now + oneYear,
      },
      {
        name: 'eu_cookie_compliance',
        value: 'true',
        domain,
        path: '/',
        httpOnly: false,
        secure,
        sameSite: 'Lax',
        expires: now + oneYear,
      },
    ]);
  } catch {
    // Best-effort only; some domains reject preset cookie shapes.
  }
}
