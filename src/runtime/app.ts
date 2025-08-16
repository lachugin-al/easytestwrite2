import { AppConfig } from "../config/app-config";
import { AndroidDriver } from "../adapters/appium/drivers/android-driver";
import { IosDriver } from "../adapters/appium/drivers/ios-driver";
import { Platform } from "../core/platform";
import WebServer from "../proxy/web-server";
import { DriverRegistry } from "../adapters/appium/drivers/driver-registry";

export class App {
  static current: App;

  constructor() {
    App.current = this;
  }

  /** Экземпляр WDIO браузера (Appium-сессия). */
  public driver: WebdriverIO.Browser | null = null;

  /** Локальный web-сервер для утилит. */
  public readonly webServer = new WebServer();

  /**
   * Полный запуск окружения:
   * - создаёт новый драйвер для выбранной платформы
   * - запускает локальный WebServer
   */
  async launch(): Promise<this> {
    if (this.driver) {
      await this.close();
    }

    await this.createDriver(); // дожидаемся полноценного старта драйвера
    // старт веб-сервера (если метод синхронный — Promise.resolve не помешает)
    await Promise.resolve(this.webServer.start());

    return this;
  }

  private async createDriver(): Promise<void> {
    const platform = AppConfig.getPlatform();

    if (platform === Platform.ANDROID) {
      console.info("[App] Инициализация Android-драйвера");
      this.driver = await new AndroidDriver(true).getAndroidDriver(3);
    } else if (platform === Platform.IOS) {
      console.info("[App] Инициализация iOS-драйвера");
      this.driver = await new IosDriver(true).getIOSDriver(3);
    } else {
      throw new Error(`[App] Неподдерживаемая платформа: ${platform}`);
    }

    // Сделать драйвер доступным глобально и через реестр
    (globalThis as any).driver = this.driver;
    DriverRegistry.set(this.driver);
  }

  /**
   * Корректное завершение всех активных компонентов:
   * - завершает приложение
   * - закрывает Appium-сессию
   * - останавливает локальный WebServer
   */
  async close(): Promise<void> {
    const drv = this.driver;

    const stopServer = async () => {
      try {
        await Promise.resolve(this.webServer.close?.());
      } catch (e: any) {
        console.error(`[App] Ошибка при закрытии WebServer: ${e?.message}`);
      }
    };

    if (!drv) {
      await stopServer();
      return;
    }

    try {
      const platform = AppConfig.getPlatform();

      // Пытаемся корректно завершить приложение
      try {
        if (platform === Platform.ANDROID) {
          const appId = AppConfig.getAppPackage();
          if (typeof (drv as any).terminateApp === "function") {
            await (drv as any).terminateApp(appId);
          } else {
            await drv.execute("mobile: terminateApp", { appId });
          }
        } else if (platform === Platform.IOS) {
          const bundleId = AppConfig.getBundleId();
          if (typeof (drv as any).terminateApp === "function") {
            await (drv as any).terminateApp(bundleId);
          } else {
            await drv.execute("mobile: terminateApp", { bundleId });
          }
        }
      } catch (e: any) {
        console.error(`[App] Ошибка при завершении приложения: ${e?.message}`);
      }

      // Закрываем сессию
      try {
        await drv.deleteSession();
      } catch (e: any) {
        console.error(`[App] Ошибка при закрытии сессии Appium: ${e?.message}`);
      }
    } finally {
      // Чистим ссылки в любом случае
      this.driver = null;
      (globalThis as any).driver = null;
      DriverRegistry.clear();
      await stopServer();
    }
  }
}