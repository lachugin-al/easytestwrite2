/**
 * Обёртка для системных алертов (native/web) в WebdriverIO/Appium.
 *
 * - isAlertPresent()
 * - accept()
 * - dismiss()
 * - getText()
 */
export class AlertHandler {
  constructor(
    private readonly driver: WebdriverIO.Browser,
    private readonly timeoutExpectation: number,
    private readonly pollingInterval: number
  ) {
  }

  private timeoutMs() {
    return Math.max(0, this.timeoutExpectation * 1000);
  }

  /** Ожидаем появление алерта (true/false). */
  async isAlertPresent(): Promise<boolean> {
    try {
      await this.driver.waitUntil(
        async () => {
          try {
            // WebdriverIO v9: isAlertOpen() есть не всегда в типах — используем getAlertText() как пробник
            // @ts-ignore
            if (typeof this.driver.isAlertOpen === "function") {
              // @ts-ignore
              return !!(await this.driver.isAlertOpen());
            }
            await this.driver.getAlertText();
            return true;
          } catch {
            return false;
          }
        },
        { timeout: this.timeoutMs(), interval: this.pollingInterval }
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Accept текущего алерта. */
  async accept(): Promise<void> {
    await this.driver.waitUntil(
      async () => {
        try {
          await this.driver.acceptAlert();
          return true;
        } catch {
          return false;
        }
      },
      { timeout: this.timeoutMs(), interval: this.pollingInterval }
    );
  }

  /** Dismiss текущего алерта. */
  async dismiss(): Promise<void> {
    await this.driver.waitUntil(
      async () => {
        try {
          await this.driver.dismissAlert();
          return true;
        } catch {
          return false;
        }
      },
      { timeout: this.timeoutMs(), interval: this.pollingInterval }
    );
  }

  /** Текст алерта. */
  async getText(): Promise<string> {
    await this.driver.waitUntil(
      async () => {
        try {
          await this.driver.getAlertText();
          return true;
        } catch {
          return false;
        }
      },
      { timeout: this.timeoutMs(), interval: this.pollingInterval }
    );
    return this.driver.getAlertText();
  }
}