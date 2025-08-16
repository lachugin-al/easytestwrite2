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
 * Инкапсулирует инициализацию Android-драйвера (WDIO).
 */
export class AndroidDriver {
  constructor(private readonly autoLaunch: boolean) {
  }

  /**
   * Создание WDIO-сессии c ретраями.
   */
  async getAndroidDriver(retryCount: number): Promise<WebdriverIO.Browser> {
    try {
      console.info(`[AndroidDriver] Инициализация драйвера (осталось попыток: ${retryCount})`);
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
      console.error("[AndroidDriver] Ошибка создания сессии:", msg);

      if (retryCount > 0) {
        console.warn(`[AndroidDriver] Повторная попытка инициализации (осталось ${retryCount - 1})`);
        return this.getAndroidDriver(retryCount - 1);
      }
      throw new Error(
        `Не удалось инициализировать Android-драйвер. Проверьте, запущен ли эмулятор / доступен Appium. Оригинальная ошибка: ${msg}`
      );
    }
  }

  /**
   * Формирование возможностей для Android (W3C + appium: префиксы).
   */
  private getCapabilities(): WebdriverIO.Capabilities {
    const appPath = path.resolve(AppConfig.getAppName());
    if (!fs.existsSync(appPath)) {
      throw new Error(
        [
          `APK-файл приложения '${AppConfig.getAppName()}' не найден.`,
          `Ожидалось наличие файла по пути: ${appPath}.`,
          `Скомпилируйте Android-приложение и скопируйте APK в корень проекта.`,
        ].join("\n")
      );
    }

    console.info("[AndroidDriver] Формирование capabilities");
    const caps: WebdriverIO.Capabilities = {
      platformName: "Android",
      "appium:automationName": "UiAutomator2",
      "appium:app": appPath,
      "appium:platformVersion": AppConfig.getAndroidVersion(),
      "appium:deviceName": AppConfig.getAndroidDeviceName(),
      "appium:noReset": false,
      "appium:newCommandTimeout": 100,
      "appium:dontStopAppOnReset": false,
      "appium:unicodeKeyboard": true,
      "appium:adbExecTimeout": 40_000,
      "appium:autoGrantPermissions": true,
      "appium:autoLaunch": this.autoLaunch,
      "appium:appActivity": AppConfig.getAppActivity(),
      "appium:appPackage": AppConfig.getAppPackage(),
    };

    console.info("[AndroidDriver] Capabilities сформированы");
    return caps;
  }
}