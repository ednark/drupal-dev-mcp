import { URL } from 'node:url';
import type { Page } from 'playwright';
import { dismissCookieConsent, preSetConsentCookies } from './cookie-handler.ts';
import type { BrowserSession } from './stealth-browser.ts';

const GOOGLE_QUERY_STOP_WORDS = new Set([
  'docs',
  'doc',
  'drupal',
  'www',
  'en',
  'html',
  'php',
]);

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(items: readonly T[]): T | null {
  if (items.length === 0) {
    return null;
  }

  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

async function findRandomInternalLink(page: Page): Promise<string | null> {
  const hrefs = await page.$$eval('a[href^="/"]', (anchors) => {
    return anchors
      .map((anchor) => anchor.getAttribute('href'))
      .filter((href): href is string => Boolean(href));
  });

  const selected = pickRandom(hrefs);
  return selected;
}

async function doGentleInteraction(page: Page): Promise<void> {
  await page.waitForTimeout(randomInt(1200, 2800));
  await page.mouse.move(randomInt(50, 300), randomInt(80, 380), { steps: randomInt(10, 24) });
  await page.waitForTimeout(randomInt(250, 800));
  await page.mouse.wheel(0, randomInt(280, 980));
  await page.waitForTimeout(randomInt(350, 1200));
}

export function buildGoogleSearchUrl(targetUrl: string): string {
  let tokens: string[] = [];

  try {
    const parsed = new URL(targetUrl);
    tokens = parsed.pathname
      .split(/[\/\-_.+]+/g)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .map((segment) => segment.trim().toLowerCase())
      .filter((segment) => segment.length > 1)
      .filter((segment) => !GOOGLE_QUERY_STOP_WORDS.has(segment))
      .slice(-6);
  } catch {
    tokens = targetUrl
      .split(/[\/\-_.+?&#=:]+/g)
      .map((segment) => segment.trim().toLowerCase())
      .filter((segment) => segment.length > 1)
      .filter((segment) => !GOOGLE_QUERY_STOP_WORDS.has(segment))
      .slice(-6);
  }

  const queryTerms = [...tokens, 'drupal'];
  const query = encodeURIComponent(queryTerms.join(' ')).replace(/%20/g, '+');
  return `https://www.google.com/search?q=${query}`;
}

export async function simulateGoogleReferral(session: BrowserSession, targetUrl: string): Promise<Page> {
  const googleSearchUrl = buildGoogleSearchUrl(targetUrl);
  const page = await session.openPage(googleSearchUrl, {
    waitUntil: 'domcontentloaded',
    timeoutMs: 45_000,
  });

  try {
    await page.waitForTimeout(randomInt(1500, 3500));
    await doGentleInteraction(page);
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
      referer: 'https://www.google.com/',
    });
    await dismissCookieConsent(page).catch(() => undefined);
    await session.persistStorageState().catch(() => undefined);
    return page;
  } catch (error) {
    await session.closePage(page).catch(() => undefined);
    throw error;
  }
}

// Warms up the browser by visiting related pages before target fetching
export async function warmUpBrowser(session: BrowserSession, targetDomain: string): Promise<void> {
  const normalizedDomain = targetDomain.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const homeUrl = `https://${normalizedDomain}/`;

  const warmupPage = await session.openPage(homeUrl, {
    waitUntil: 'domcontentloaded',
    timeoutMs: 45_000,
    beforeNavigate: async (tab) => {
      await preSetConsentCookies(tab, homeUrl);
    },
  });

  try {
    await dismissCookieConsent(warmupPage).catch(() => undefined);
    await doGentleInteraction(warmupPage);

    const internalHref = await findRandomInternalLink(warmupPage);
    if (internalHref) {
      const nextUrl = new URL(internalHref, homeUrl).toString();
      await warmupPage.goto(nextUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await dismissCookieConsent(warmupPage).catch(() => undefined);
      await doGentleInteraction(warmupPage);

      const secondInternalHref = await findRandomInternalLink(warmupPage);
      if (secondInternalHref) {
        const secondUrl = new URL(secondInternalHref, homeUrl).toString();
        await warmupPage.goto(secondUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        });
        await dismissCookieConsent(warmupPage).catch(() => undefined);
        await doGentleInteraction(warmupPage);
      }
    }

    await session.persistStorageState().catch(() => undefined);
  } finally {
    await session.closePage(warmupPage);
  }
}
