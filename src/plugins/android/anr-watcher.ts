/**
 * Утилита для мониторинга и авто-обработки ANR (Application Not Responding) диалогов на Android.
 * Алгоритм:
 *  - периодически читает pageSource;
 *  - если видит «не отвечает», пытается нажать «Подождать» либо «Закрыть приложение/Закрыть».
 */
export class AnrWatcher {
  /** Синглтон для статических обёрток */
  private static _inst = new AnrWatcher();

  /** Статическая обёртка, совместимая с вызовом AnrWatcher.start(...) в MobileActions */
  static start(driver: WebdriverIO.Browser, intervalMillis: number = 2000): void {
    return this._inst.start(driver, intervalMillis);
  }

  /** Статическая обёртка для остановки */
  static stop(): Promise<void> {
    return this._inst.stop();
  }

  // ---------------- Экземплярная реализация ----------------

  private running = false;
  private loopPromise: Promise<void> | null = null;

  /**
   * Запуск фонового мониторинга.
   * @param driver WebdriverIO драйвер (Android)
   * @param intervalMillis интервал проверки (мс), по умолчанию 2000
   */
  start(driver: WebdriverIO.Browser, intervalMillis: number = 2000): void {
    if (this.running) {
      console.info("[ANR] Watcher уже запущен");
      return;
    }
    this.running = true;
    console.info(`[ANR] Запуск watcher с интервалом ${intervalMillis} мс`);

    this.loopPromise = (async () => {
      while (this.running) {
        try {
          const pageSource = (await driver.getPageSource())?.toLowerCase?.() ?? "";
          if (pageSource.includes("не отвечает")) {
            console.info("[ANR] Обнаружен диалог. Пытаемся нажать 'Подождать' или 'Закрыть'.");

            try {
              // Попытка: «Подождать»
              const waitBtn = await driver.$('android=new UiSelector().textContains("Подождать")');
              if (await waitBtn.isExisting()) {
                await waitBtn.click();
                console.info("[ANR] Нажата кнопка 'Подождать'");
              } else {
                // Попытка: «Закрыть приложение» или «Закрыть»
                const closeAppBtn = await driver.$('android=new UiSelector().textContains("Закрыть приложение")');
                const closeBtn = await driver.$('android=new UiSelector().textContains("Закрыть")');
                if ((await closeAppBtn.isExisting())) {
                  await closeAppBtn.click();
                  console.info("[ANR] Нажата кнопка 'Закрыть приложение'");
                } else if (await closeBtn.isExisting()) {
                  await closeBtn.click();
                  console.info("[ANR] Нажата кнопка 'Закрыть'");
                } else {
                  console.warn("[ANR] Не удалось найти кнопки 'Подождать' или 'Закрыть'");
                }
              }
            } catch (inner) {
              console.warn(`[ANR] Ошибка клика по элементам диалога: ${(inner as Error)?.message || inner}`);
            }
          }

          await new Promise((r) => setTimeout(r, intervalMillis));
        } catch (e) {
          // Ошибки чтения источника не должны валить цикл
          console.error(`[ANR] Ошибка цикла: ${(e as Error)?.message || e}`);
          await new Promise((r) => setTimeout(r, intervalMillis));
        }
      }
    })();
  }

  /**
   * Остановка мониторинга.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    try {
      await this.loopPromise;
    } catch {
      // ignore
    } finally {
      this.loopPromise = null;
      console.info("[ANR] Watcher остановлен");
    }
  }
}