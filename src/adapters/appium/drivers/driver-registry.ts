export class DriverRegistry {
  private static _driver: WebdriverIO.Browser | undefined;

  static set(driver: WebdriverIO.Browser) {
    this._driver = driver;
  }

  static get(): WebdriverIO.Browser {
    if (!this._driver) throw new Error("Driver is not initialized");
    return this._driver;
  }

  /** Не бросает ошибку — для ожиданий */
  static peek(): WebdriverIO.Browser | undefined {
    return this._driver;
  }

  static clear() {
    this._driver = undefined;
  }
}