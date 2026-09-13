import { launchPage, type Viewport } from "./page/cdp";
import type { Page } from "./page/page";

export const VIEWPORTS = {
  mobile: { width: 390, height: 844, mobile: true, dpr: 3 },
  desktop: { width: 1440, height: 900, mobile: false, dpr: 2 },
} satisfies Record<string, Viewport>;

export async function withSession<T>(
  opts: { url: string; viewport: Viewport },
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const session = await launchPage({ ...opts, headless: process.env.UXA_HEADLESS === "1" });
  try {
    return await fn(session.page);
  } finally {
    await session.close();
  }
}
