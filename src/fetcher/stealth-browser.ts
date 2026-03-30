import { chromium as playwrightChromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { addExtra } from 'playwright-extra';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface StealthBrowserOptions {
  headless?: boolean;
  timezoneId?: string;
  locale?: string;
  channel?: 'chrome' | 'chromium' | 'msedge';
  storageStatePath?: string;
  useStealthPlugin?: boolean;  // default: false
}

export interface StealthBrowserSession {
  browser: Browser;
  context: BrowserContext;
  userAgent: string;
  viewport: { width: number; height: number };
  storageStatePath?: string;
}

export interface OpenPageOptions {
  beforeNavigate?: (page: Page) => Promise<void>;
  timeoutMs?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  referer?: string;
}

export class BrowserSession {
  public readonly browser: Browser;
  public readonly context: BrowserContext;
  public readonly userAgent: string;
  public readonly viewport: { width: number; height: number };
  public readonly storageStatePath?: string;

  private readonly pages = new Set<Page>();

  public constructor(session: StealthBrowserSession) {
    this.browser = session.browser;
    this.context = session.context;
    this.userAgent = session.userAgent;
    this.viewport = session.viewport;
    this.storageStatePath = session.storageStatePath;
  }

  public async persistStorageState(): Promise<void> {
    if (!this.storageStatePath) {
      return;
    }

    await fs.mkdir(path.dirname(this.storageStatePath), { recursive: true });
    await this.context.storageState({ path: this.storageStatePath });
  }

  public async openPage(url: string, options: OpenPageOptions = {}): Promise<Page> {
    const page = await this.context.newPage();
    this.pages.add(page);

    try {
      if (options.beforeNavigate) {
        await options.beforeNavigate(page);
      }

      await page.goto(url, {
        timeout: options.timeoutMs,
        // Prefer waiting for network idle to allow challenge/anti-bot flows to settle
        waitUntil: options.waitUntil ?? 'networkidle',
        referer: options.referer,
      });

      return page;
    } catch (error) {
      this.pages.delete(page);
      await page.close().catch(() => undefined);
      throw error;
    }
  }

  public async closePage(page: Page): Promise<void> {
    if (this.pages.has(page)) {
      this.pages.delete(page);
    }

    if (!page.isClosed()) {
      await page.close();
    }
  }

  public async close(): Promise<void> {
    const openPages = [...this.pages];
    this.pages.clear();

    await Promise.allSettled(openPages.map(async (page) => {
      if (!page.isClosed()) {
        await page.close();
      }
    }));

    await this.persistStorageState().catch(() => undefined);
    await this.context.close();
    await this.browser.close();
  }
}

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

type ChromiumLike = {
  use: (plugin: unknown) => void;
  launch: (options: Record<string, unknown>) => Promise<unknown>;
};

const extraChromium = addExtra(playwrightChromium) as unknown as ChromiumLike;
let stealthRegistered = false;

function pickRandom<T>(items: readonly T[]): T {
  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

function resolveHeadless(explicitHeadless?: boolean): boolean {
  if (typeof explicitHeadless === 'boolean') {
    return explicitHeadless;
  }

  if ((process.env.PLAYWRIGHT_HEADLESS ?? '').toLowerCase() === 'true') {
    return true;
  }

  return false;
}

export async function createStealthBrowserSession(options: StealthBrowserOptions = {}): Promise<StealthBrowserSession> {
  const userAgent = pickRandom(USER_AGENTS);
  const viewport = pickRandom(VIEWPORTS);

  const launchOptions = {
    headless: resolveHeadless(options.headless),
    channel: options.channel ?? 'chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  };

  let browser: Browser;
  if (options.useStealthPlugin === true) {
    if (!stealthRegistered) {
      const stealthModule = (await import('puppeteer-extra-plugin-stealth')) as unknown as {
        default?: () => unknown;
      };
      const StealthPlugin = (stealthModule.default ?? stealthModule) as () => unknown;
      extraChromium.use(StealthPlugin());
      stealthRegistered = true;
    }
    browser = (await extraChromium.launch(launchOptions)) as Browser;
  } else {
    browser = await playwrightChromium.launch(launchOptions);
  }

  let storageStatePath: string | undefined;
  if (options.storageStatePath) {
    try {
      await fs.access(options.storageStatePath);
      storageStatePath = options.storageStatePath;
    } catch {
      storageStatePath = undefined;
    }
  }

  const context = await browser.newContext({
    userAgent,
    viewport,
    locale: options.locale ?? 'en-US',
    timezoneId: options.timezoneId ?? 'America/New_York',
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
      DNT: '1',
    },
    storageState: storageStatePath,
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });

    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' },
      ],
      configurable: true,
    });

    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
      configurable: true,
    });

    Object.defineProperty(window.history, 'length', {
      get: () => Math.floor(Math.random() * 5) + 4,
      configurable: true,
    });

    try {
      localStorage.setItem('visited', 'true');
      localStorage.setItem('drupal_session_count', String(Math.floor(Math.random() * 20) + 5));
    } catch {
      // Ignore storage write issues for restricted contexts.
    }
  });

  return {
    browser,
    context,
    userAgent,
    viewport,
    storageStatePath: options.storageStatePath,
  };
}

export async function createBrowserSession(options: StealthBrowserOptions = {}): Promise<BrowserSession> {
  const session = await createStealthBrowserSession(options);
  return new BrowserSession(session);
}
