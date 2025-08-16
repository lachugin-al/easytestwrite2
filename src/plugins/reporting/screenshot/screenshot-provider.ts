/**
 * Интерфейс и провайдер скриншотов для WebdriverIO/Appium.
 * Возвращает «сырые» байты скриншота (PNG Base64 из драйвера → Buffer).
 */

export interface ScreenshotProvider {
  getRawScreenshot(): Promise<Buffer>;
}

/** Провайдер для WebdriverIO/Appium браузера. */
export class AppiumScreenshotProvider implements ScreenshotProvider {
  constructor(private readonly driver: WebdriverIO.Browser) {
  }

  async getRawScreenshot(): Promise<Buffer> {
    // WebDriver протокол возвращает base64 строки
    const base64 = await this.driver.takeScreenshot();
    return Buffer.from(base64, "base64");
  }
}