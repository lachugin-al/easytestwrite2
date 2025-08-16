import { remote } from "webdriverio";
import * as fs from "node:fs";
import * as path from "node:path";
import { AppConfig } from "../../../config/app-config";

function urlToWdio(appiumUrl: URL) {
  return {
    protocol: appiumUrl.protocol.replace(":", "") as "http" | "https",
    hostname: appiumUrl.hostname,
    port: appiumUrl.port
      ? Number(appiumUrl.port)
      : appiumUrl.protocol === "https:"
        ? 443
        : 80,
    path: appiumUrl.pathname || "/",
  };
}

/**
 * Обёртка для инициализации iOS-драйвера (WDIO).
 */
export class IosDriver {
  constructor(private readonly autoLaunch: boolean) {
  }

  /**
   * Создание WDIO-сессии c ретраями.
   */
  async getIOSDriver(retryCount: number): Promise<WebdriverIO.Browser> {
    try {
      console.info(`[IosDriver] Инициализация iOS-драйвера (попыток осталось: ${retryCount})`);
      const caps = this.getCapabilities();
      const appiumUrl = AppConfig.getAppiumUrl();

      const driver = await remote({
        ...urlToWdio(appiumUrl),
        capabilities: caps,
        connectionRetryCount: 0,
      });

      return driver;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error("[IosDriver] Ошибка создания сессии:", msg);

      if (retryCount > 0) {
        console.warn(`[IosDriver] Повторная попытка инициализации (осталось ${retryCount - 1})`);
        return this.getIOSDriver(retryCount - 1);
      }

      throw new Error(
        [
          "Не удалось инициализировать iOS-драйвер.",
          "Проверьте правильность версии платформы и имени устройства.",
          "Для списка симуляторов: 'xcrun simctl list devices available'",
          `Оригинальная ошибка: ${msg}`,
        ].join("\n")
      );
    }
  }

  /**
   * Формирование возможностей для iOS (W3C + appium: префиксы).
   */
  private getCapabilities(): WebdriverIO.Capabilities {
    const appPath = path.resolve(AppConfig.getAppName());
    if (!fs.existsSync(appPath)) {
      throw new Error(
        [
          `Не найден файл приложения: ${AppConfig.getAppName()}.`,
          `Ожидалось наличие файла по пути: ${appPath}.`,
          `Скомпилируйте iOS-приложение и скопируйте .app файл в корень проекта.`,
        ].join("\n")
      );
    }

    console.info("[IosDriver] Формирование capabilities");
    const caps: WebdriverIO.Capabilities = {
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      "appium:app": appPath,
      "appium:platformVersion": AppConfig.getIosVersion(),
      "appium:deviceName": AppConfig.getIosDeviceName(),
      "appium:connectHardwareKeyboard": false,
      "appium:autoAcceptAlerts": AppConfig.getIosAutoAcceptAlerts(),
      "appium:autoDismissAlerts": AppConfig.getIosAutoDismissAlerts(),
      "appium:showIOSLog": false,
      "appium:autoLaunch": this.autoLaunch,
      // XCUITest processArguments формат: { args: string[], env: Record<string,string> }
      "appium:processArguments": { args: [], env: {} },
      // Настройка через settings (можно применить после старта, но многие окружения читают так):
      // "appium:settings[customSnapshotTimeout]": 3  // не все серверы понимают, потому настройка опциональна
    };

    console.info("[IosDriver] Capabilities сформированы");
    return caps;
  }
}