// -------------------------------------------------------------
// Методы и явная регистрация vitest-хуков.
// Использование:
//   import { mobileTest, registerMobileHooks } from "@/controller/mobile/MobileActions";
//   registerMobileHooks(); // вверху каждого e2e-сьюта
//   затем в тестах: await mobileTest.click(...), checkVisible(...), openDeeplink(...)
// -------------------------------------------------------------

import { beforeAll, afterAll, beforeEach, afterEach, expect } from "vitest";

import { App } from "./app";
import { AppiumServerManager } from "../adapters/appium/service-manager";
import { AppConfig } from "../config/app-config";
import { Platform } from "../core/platform";
import { PageElement } from "../core/locators/page-element";
import { ScrollDirection } from "../core/gestures/scroll-direction";
import { AlertHandler } from "../core/interaction/alert-handler";
import { EventStorage } from "../domain/events/storage";
import type { EventData } from "../domain/events/model";
import { DriverRegistry } from "../adapters/appium/drivers/driver-registry";

import * as fs from "node:fs";
import * as path from "node:path";
import { Terminal } from "../adapters/system/terminal";
import { VideoRecorder } from "../plugins/reporting/video-recorder";
import { LogCapture } from "../plugins/reporting/log-capture";
import { AnrWatcher } from "../plugins/android/anr-watcher";
import { EmulatorManager } from "../adapters/devices/emulator-manager";

import {
  DEFAULT_POLLING_INTERVAL,
  DEFAULT_SCROLL_CAPACITY,
  DEFAULT_SCROLL_COEFFICIENT,
  DEFAULT_SCROLL_COUNT,
  DEFAULT_SCROLL_DIRECTION,
  DEFAULT_SWIPE_COEFFICIENT,
  DEFAULT_TIMEOUT_BEFORE_EXPECTATION,
  DEFAULT_TIMEOUT_EXPECTATION,
  DEFAULT_TIMEOUT_EVENT_CHECK_EXPECTATION,
} from "../core/constants";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getDrv(): WebdriverIO.Browser {
  return DriverRegistry.get();
}

async function waitForUIStable(timeoutSec: number, pollMs = DEFAULT_POLLING_INTERVAL) {
  if (timeoutSec <= 0) return;
  const timeoutMs = timeoutSec * 1000;
  const d = getDrv();
  let prev = await d.getPageSource();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(pollMs);
    const cur = await d.getPageSource();
    if (cur === prev) return;
    prev = cur;
  }
}

// Универсальный поиск по локатору
async function findAllByLocator(
  loc: any,
  timeoutSec: number,
  pollMs: number
): Promise<WebdriverIO.ElementArray> {
  const timeoutMs = timeoutSec * 1000;
  const d = getDrv();
  const start = Date.now();
  let lastErr: any;

  while (Date.now() - start < timeoutMs) {
    try {
      if (typeof loc === "string") {
        // через any, чтобы обойти тип ChainablePromiseArray
        const els = (await (d as any).$$(loc)) as any[];
        if (els && els.length > 0) return els as unknown as WebdriverIO.ElementArray;
      } else if (loc && typeof loc.using === "string" && typeof loc.value === "string") {
        // findElements возвращает «сырые» референсы — оборачиваем в элементы
        const refs: any[] = await (d as any).findElements(loc.using, loc.value);
        if (refs && refs.length) {
          const wrap = await Promise.all(
            refs.map((ref: any) =>
              (d as any).$({
                ELEMENT: ref.ELEMENT,
                "element-6066-11e4-a52e-4f735466cecf": ref["element-6066-11e4-a52e-4f735466cecf"],
              })
            )
          );
          return wrap as unknown as WebdriverIO.ElementArray;
        }
      } else if (loc && typeof loc.selector === "string") {
        const els = (await (d as any).$$(loc.selector)) as any[];
        if (els && els.length > 0) return els as unknown as WebdriverIO.ElementArray;
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(pollMs);
  }

  if (lastErr) throw lastErr;
  // Явно приводим пустой массив к типу ElementArray
  return [] as unknown as WebdriverIO.ElementArray;
}

function tryParseJSON(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function isPrimitive(v: any) {
  return v === null || typeof v !== "object";
}

export function containsJsonData(eventJson: string, searchJson: string): boolean {
  const evDataObj = tryParseJSON(eventJson);
  if (!evDataObj || typeof evDataObj !== "object") return false;

  const bodyStr = evDataObj["body"];
  if (typeof bodyStr !== "string") return false;

  const bodyObj = tryParseJSON(bodyStr);
  if (!bodyObj || typeof bodyObj !== "object") return false;

  const ev = bodyObj["event"];
  if (!ev || typeof ev !== "object") return false;

  const dataElement = ev["data"];
  if (dataElement === undefined) return false;

  const searchObj = tryParseJSON(searchJson);
  if (!searchObj || typeof searchObj !== "object") return false;

  return Object.entries(searchObj).every(([key, val]) => findKeyValueInTree(dataElement, key, val));
}

function findKeyValueInTree(element: any, key: string, searchValue: any): boolean {
  if (Array.isArray(element)) return element.some((it) => findKeyValueInTree(it, key, searchValue));
  if (element && typeof element === "object") {
    for (const [k, v] of Object.entries(element)) {
      if ((k === key && matchJsonElement(v, searchValue)) || findKeyValueInTree(v, key, searchValue)) {
        return true;
      }
    }
  }
  return false;
}

function matchJsonElement(eventElement: any, searchElement: any): boolean {
  if (isPrimitive(eventElement) && isPrimitive(searchElement)) {
    const ev = String(eventElement);
    const sv = String(searchElement);
    if (sv === "*") return true;
    if (sv === "") return ev === "";
    if (sv.startsWith("~")) return ev.includes(sv.slice(1));
    return ev === sv;
  }

  if (isPrimitive(eventElement) && typeof eventElement === "string") {
    const parsed = tryParseJSON(eventElement);
    if (parsed !== null) return matchJsonElement(parsed, searchElement);
  }

  if (
    eventElement &&
    typeof eventElement === "object" &&
    !Array.isArray(eventElement) &&
    searchElement &&
    typeof searchElement === "object" &&
    !Array.isArray(searchElement)
  ) {
    return Object.entries(searchElement).every(
      ([k, sv]) => k in eventElement && matchJsonElement((eventElement as any)[k], sv)
    );
  }

  if (Array.isArray(eventElement) && Array.isArray(searchElement)) {
    return (searchElement as any[]).every((se) => (eventElement as any[]).some((ee) => matchJsonElement(ee, se)));
  }

  return false;
}

// -------------------------------------------------------------
// Класс MobileActions (без DSL)
// -------------------------------------------------------------
export class MobileActions {
  protected app!: App;

  protected get drv(): WebdriverIO.Browser {
    return DriverRegistry.get();
  }

  private eventsFileStorage = EventStorage;
  private jobs: Array<Promise<void>> = [];
  private static emulatorStarted = false;

  // -------- Suite lifecycle (вызывается из registerMobileHooks) --------
  static async setUpAll() {
    // --- Appium ---
    if (AppConfig.isAppiumAutoStartEnabled()) {
      console.info("[MobileActions] Автостарт Appium включён");
      // Менеджер внутри читает таймаут из AppConfig.getAppiumStartTimeoutMs()
      await AppiumServerManager.startIfNeeded();
    } else {
      console.info("[MobileActions] Автостарт Appium отключён (APPIUM_AUTOSTART=0). " +
        "Ожидается, что сервер уже запущен извне.");
    }

    // --- Emulator/Simulator ---
    if (AppConfig.isEmulatorAutoStartEnabled()) {
      console.info("[MobileActions] Запуск эмулятора перед всеми тестами");
      this.emulatorStarted = await EmulatorManager.startEmulator();
      if (!this.emulatorStarted) {
        console.error("[MobileActions] Не удалось запустить эмулятор");
      }
    } else {
      console.info("[MobileActions] Автозапуск эмулятора отключен");
    }
  }

  static async tearDownAll() {
    // --- Appium ---
    if (AppConfig.isAppiumAutoShutdownEnabled()) {
      console.info("[MobileActions] Автоостанов Appium включён");
      // Менеджер использует AppConfig.getAppiumKillGraceMs() для «grace» перед SIGKILL
      await AppiumServerManager.stopIfStarted();
    } else {
      console.info("[MobileActions] Автоостанов Appium отключён (APPIUM_AUTOSHUTDOWN=0) — оставляем процесс работать.");
    }

    // --- Emulator/Simulator ---
    if (AppConfig.isEmulatorAutoShutdownEnabled()) {
      console.info("[MobileActions] Остановка эмулятора после всех тестов");
      await EmulatorManager.stopEmulator();
    } else {
      console.info("[MobileActions] Автовыключение эмулятора отключено");
    }
  }

  // -------- Test lifecycle (вызывается из registerMobileHooks) --------
  async setUp(testName: string) {
    LogCapture.clearLogs();
    LogCapture.initialize();
    this.eventsFileStorage.clear();

    if (AppConfig.getPlatform() === Platform.ANDROID && AppConfig.isEmulatorAutoStartEnabled() && !MobileActions.emulatorStarted) {
      console.warn("[MobileActions] Эмулятор не был успешно запущен в setUpAll(), пробуем снова");
      MobileActions.emulatorStarted = await EmulatorManager.startEmulator();
      if (!MobileActions.emulatorStarted) {
        console.error("[MobileActions] Не удалось запустить эмулятор перед тестом");
        throw new Error("Не удалось инициализировать Android-драйвер. Проверьте, запущен ли эмулятор.");
      }
    }

    this.app = await new App().launch();

    await VideoRecorder.startRecording(this.drv as any, testName);

    if (AppConfig.getPlatform() === Platform.ANDROID) {
      await AnrWatcher.start(this.drv as any);
    }
  }

  async tearDown(testName: string) {
    await this.awaitAllEventChecks();
    await VideoRecorder.stopRecording(this.drv as any, testName);

    if (AppConfig.getPlatform() === Platform.ANDROID) {
      await AnrWatcher.stop();
    }

    await LogCapture.attachLogsToAllureReport();

    await this.app.close();
    DriverRegistry.clear();
  }

  // -------------------------------------------------------------
  // click(...) — перегрузки без DSL
  // -------------------------------------------------------------

  // 1) click(element, ...)
  click(
    element: PageElement | null | undefined,
    elementNumber?: number | null,
    timeoutBeforeExpectation?: number,
    timeoutExpectation?: number,
    pollingInterval?: number,
    scrollCount?: number,
    scrollCapacity?: number,
    scrollDirection?: ScrollDirection
  ): Promise<void>;

  // 2) click(eventName, eventData, ...)
  click(
    eventName: string,
    eventData: string,
    timeoutBeforeExpectation?: number,
    timeoutExpectation?: number,
    timeoutEventExpectation?: number,
    pollingInterval?: number,
    scrollCount?: number,
    scrollCapacity?: number,
    scrollDirection?: ScrollDirection,
    eventPosition?: "first" | "last"
  ): Promise<void>;

  // 3) click({text|containsText}, ...)
  click(
    opts: { text?: string; containsText?: string },
    elementNumber?: number | null,
    timeoutBeforeExpectation?: number,
    timeoutExpectation?: number,
    pollingInterval?: number,
    scrollCount?: number,
    scrollCapacity?: number,
    scrollDirection?: ScrollDirection
  ): Promise<void>;

  async click(a: any, b?: any, ...rest: any[]): Promise<void> {
    // Вариант 2: eventName:string
    if (typeof a === "string") {
      const [
        timeoutBeforeExpectation = DEFAULT_TIMEOUT_BEFORE_EXPECTATION,
        timeoutExpectation = DEFAULT_TIMEOUT_EXPECTATION,
        timeoutEventExpectation = DEFAULT_TIMEOUT_EVENT_CHECK_EXPECTATION,
        _pollingInterval = DEFAULT_POLLING_INTERVAL,
        scrollCount = 1,
        scrollCapacity = 0.7,
        scrollDirection = DEFAULT_SCROLL_DIRECTION,
        eventPosition = "first",
      ] = rest as [
          number | undefined,
          number | undefined,
          number | undefined,
          number | undefined,
          number | undefined,
          number | undefined,
          ScrollDirection | undefined,
          "first" | "last" | undefined
      ];
      await this._clickFromEvent(
        a as string,
        b as string,
        timeoutBeforeExpectation,
        timeoutExpectation,
        timeoutEventExpectation,
        scrollCount,
        scrollCapacity,
        scrollDirection,
        eventPosition
      );
      return;
    }

    // Вариант 1: PageElement
    if (a == null || typeof a === "object") {
      const element = a as PageElement | null | undefined;
      if (element && !("get" in element || "getAll" in element || "android" in element || "ios" in element)) {
        // это не PageElement — пойдём в вариант 3
      } else {
        const elementNumber = (b as number | null | undefined) ?? null;
        const [
          timeoutBeforeExpectation = DEFAULT_TIMEOUT_BEFORE_EXPECTATION,
          timeoutExpectation = DEFAULT_TIMEOUT_EXPECTATION,
          pollingInterval = DEFAULT_POLLING_INTERVAL,
          scrollCount = DEFAULT_SCROLL_COUNT,
          scrollCapacity = DEFAULT_SCROLL_CAPACITY,
          scrollDirection = DEFAULT_SCROLL_DIRECTION,
        ] = rest as [number?, number?, number?, number?, number?, ScrollDirection?];

        const el = await this.waitForElements(
          element,
          elementNumber,
          timeoutBeforeExpectation,
          timeoutExpectation,
          pollingInterval,
          scrollCount,
          scrollCapacity,
          scrollDirection
        );
        await el.click();
        return;
      }
    }

    // Вариант 3: по тексту
    if (typeof a === "object" && ("text" in a || "containsText" in a)) {
      const opts = a as { text?: string; containsText?: string };
      const elementNumber = (b as number | null | undefined) ?? null;
      const [
        timeoutBeforeExpectation = DEFAULT_TIMEOUT_BEFORE_EXPECTATION,
        timeoutExpectation = DEFAULT_TIMEOUT_EXPECTATION,
        pollingInterval = DEFAULT_POLLING_INTERVAL,
        scrollCount = DEFAULT_SCROLL_COUNT,
        scrollCapacity = DEFAULT_SCROLL_CAPACITY,
        scrollDirection = DEFAULT_SCROLL_DIRECTION,
      ] = rest as [number?, number?, number?, number?, number?, ScrollDirection?];

      if (!opts.text && !opts.containsText) throw new Error("Нужно указать 'text' или 'containsText'");
      if (opts.text && opts.containsText) throw new Error("Нельзя одновременно 'text' и 'containsText'");

      const element = new PageElement(
        opts.text
          ? { android: PageElement.ExactMatch(opts.text), ios: PageElement.ExactMatch(opts.text) }
          : { android: PageElement.Contains(opts.containsText!), ios: PageElement.Contains(opts.containsText!) }
      );

      const found = await this.waitForElements(
        element,
        elementNumber,
        timeoutBeforeExpectation,
        timeoutExpectation,
        pollingInterval,
        scrollCount,
        scrollCapacity,
        scrollDirection
      );
      await found.click();
      return;
    }

    throw new Error("Неверная перегрузка click(...)");
  }

  private async _clickFromEvent(
    eventName: string,
    eventData: string,
    timeoutBeforeExpectation = DEFAULT_TIMEOUT_BEFORE_EXPECTATION,
    timeoutExpectation = DEFAULT_TIMEOUT_EXPECTATION,
    timeoutEventExpectation = DEFAULT_TIMEOUT_EVENT_CHECK_EXPECTATION,
    scrollCount = 1,
    scrollCapacity = 0.7,
    scrollDirection: ScrollDirection = DEFAULT_SCROLL_DIRECTION,
    eventPosition: "first" | "last" = "first"
  ) {
    await this.checkHasEvent(eventName, eventData, timeoutEventExpectation);

    const matchedEvents = this.eventsFileStorage.getEvents().filter((ev) => {
      if (ev.name !== eventName) return false;
      if (!ev.data) return false;
      const json = JSON.stringify(ev.data as EventData);
      return containsJsonData(json, eventData);
    });

    const picked = eventPosition === "last" ? matchedEvents[matchedEvents.length - 1] : matchedEvents[0];
    if (!picked) {
      throw new Error(`Событие '${eventName}' с фильтром '${eventData}' не найдено (position=${eventPosition})`);
    }

    const body = JSON.parse((picked.data as EventData).body);
    const itemsArr = body?.event?.data?.items;
    if (!Array.isArray(itemsArr)) throw new Error("В событии нет массива event.data.items");

    const searchObj = JSON.parse(eventData);
    const matched = itemsArr.find((item: any) =>
      Object.entries(searchObj).every(([k, sv]) => findKeyValueInTree(item, k, sv))
    );

    if (!matched) throw new Error(`В событии '${eventName}' ни один item не соответствует ${eventData}`);

    const itemName = matched?.name;
    if (!itemName || typeof itemName !== "string") throw new Error("У найденного item отсутствует строковое поле 'name'");

    const locator = new PageElement({
      android: PageElement.Text(itemName),
      ios: PageElement.Label(itemName),
    });

    const el = await this.waitForElements(
      locator,
      null,
      timeoutBeforeExpectation,
      timeoutExpectation,
      DEFAULT_POLLING_INTERVAL,
      scrollCount,
      scrollCapacity,
      scrollDirection
    );
    await el.click();
  }

  // -------------------------------------------------------------
  // tap / type / attribute
  // -------------------------------------------------------------
  async tapArea(
    x: number,
    y: number,
    timeoutBeforeExpectation = DEFAULT_TIMEOUT_BEFORE_EXPECTATION,
    waitCondition?: () => Promise<boolean> | boolean
  ) {
    if (waitCondition) {
      const timeoutMs = timeoutBeforeExpectation * 1000;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const ok = await Promise.resolve(waitCondition());
        if (ok) break;
        await sleep(DEFAULT_POLLING_INTERVAL);
      }
    } else if (timeoutBeforeExpectation > 0) {
      await waitForUIStable(timeoutBeforeExpectation);
    }

    await this.drv.performActions([
      {
        type: "pointer",
        id: "finger1",
        parameters: { pointerType: "touch" },
        actions: [
          { type: "pointerMove", duration: 0, x, y },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ]);
    await this.drv.releaseActions();
  }

  async tapElementArea(
    element: PageElement | null | undefined,
    x: number,
    y: number,
    timeoutBeforeExpectation = DEFAULT_TIMEOUT_BEFORE_EXPECTATION,
    timeoutExpectation = DEFAULT_TIMEOUT_EXPECTATION,
    pollingInterval = DEFAULT_POLLING_INTERVAL,
    scrollCount = DEFAULT_SCROLL_COUNT,
    scrollCapacity = DEFAULT_SCROLL_CAPACITY,
    scrollDirection: ScrollDirection = DEFAULT_SCROLL_DIRECTION
  ) {
    const found = await this.waitForElements(
      element,
      null,
      timeoutBeforeExpectation,
      timeoutExpectation,
      pollingInterval,
      scrollCount,
      scrollCapacity,
      scrollDirection
    );
    const loc = await found.getLocation();
    await this.tapArea(Math.round(loc.x) + x, Math.round(loc.y) + y, 0);
  }

  async typeText(
    element: PageElement | null | undefined,
    text: string,
    elementNumber: number | null = null,
    timeoutBeforeExpectation = DEFAULT_TIMEOUT_BEFORE_EXPECTATION,
    timeoutExpectation = DEFAULT_TIMEOUT_EXPECTATION,
    pollingInterval = DEFAULT_POLLING_INTERVAL,
    scrollCount = DEFAULT_SCROLL_COUNT,
    scrollCapacity = DEFAULT_SCROLL_CAPACITY,
    scrollDirection: ScrollDirection = DEFAULT_SCROLL_DIRECTION
  ) {
    const el = await this.waitForElements(
      element,
      elementNumber,
      timeoutBeforeExpectation,
      timeoutExpectation,
      pollingInterval,
      scrollCount,
      scrollCapacity,
      scrollDirection
    );
    await el.setValue(text);
  }

  // -------------------------------------------------------------
  // checkVisible(...) — перегрузки
  // -------------------------------------------------------------
  checkVisible(
    element: PageElement | null | undefined,
    elementNumber?: number | null,
    timeoutBeforeExpectation?: number,
    timeoutExpectation?: number,
    pollingInterval?: number,
    scrollCount?: number,
    scrollCapacity?: number,
    scrollDirection?: ScrollDirection
  ): Promise<void>;
  checkVisible(
    opts: { text?: string; containsText?: string },
    elementNumber?: number | null,
    timeoutBeforeExpectation?: number,
    timeoutExpectation?: number,
    pollingInterval?: number,
    scrollCount?: number,
    scrollCapacity?: number,
    scrollDirection?: ScrollDirection
  ): Promise<void>;

  async checkVisible(a: any, b?: any, ...rest: any[]): Promise<void> {
    if (a == null || (typeof a === "object" && ("get" in a || "getAll" in a || "android" in a || "ios" in a))) {
      const element = a as PageElement | null | undefined;
      const elementNumber = (b as number | null | undefined) ?? null;
      const [
        timeoutBeforeExpectation = DEFAULT_TIMEOUT_BEFORE_EXPECTATION,
        timeoutExpectation = DEFAULT_TIMEOUT_EXPECTATION,
        pollingInterval = DEFAULT_POLLING_INTERVAL,
        scrollCount = DEFAULT_SCROLL_COUNT,
        scrollCapacity = DEFAULT_SCROLL_CAPACITY,
        scrollDirection = DEFAULT_SCROLL_DIRECTION,
      ] = rest as [number?, number?, number?, number?, number?, ScrollDirection?];

      const el = await this.waitForElements(
        element,
        elementNumber,
        timeoutBeforeExpectation,
        timeoutExpectation,
        pollingInterval,
        scrollCount,
        scrollCapacity,
        scrollDirection
      );
      if (!(await el.isDisplayed())) throw new Error("Элемент найден, но не отображается");
      return;
    }

    if (typeof a === "object" && ("text" in a || "containsText" in a)) {
      // Реюз ожидания из клика по тексту (без клика)
      await this.click(a, b, ...rest);
      return;
    }

    throw new Error("Неверная перегрузка checkVisible(...)");
  }

  // -------------------------------------------------------------
  // Проверки событий — перегрузки (string | filePath)
  // -------------------------------------------------------------
  checkHasEvent(eventName: string, eventData?: string | null, timeoutEventExpectation?: number): Promise<void>;
  checkHasEvent(eventName: string, eventDataFilePath?: string | null, timeoutEventExpectation?: number): Promise<void>;

  async checkHasEvent(
    eventName: string,
    eventDataOrFile?: string | null,
    timeoutEventExpectation: number = DEFAULT_TIMEOUT_EVENT_CHECK_EXPECTATION
  ): Promise<void> {
    let data: string | null = null;
    if (typeof eventDataOrFile === "string") {
      const maybePath = path.resolve(eventDataOrFile);
      if (fs.existsSync(maybePath) && fs.statSync(maybePath).isFile()) {
        data = fs.readFileSync(maybePath, "utf8");
      } else {
        data = eventDataOrFile; // это JSON-строка
      }
    }

    const pollingInterval = 500;
    const timeoutMs = timeoutEventExpectation * 1000;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const allEvents = this.eventsFileStorage.getEvents();

      for (const ev of allEvents) {
        if (this.eventsFileStorage.isEventAlreadyMatched(ev.event_num)) continue;
        if (ev.name !== eventName) continue;

        if (!data) {
          this.eventsFileStorage.markEventAsMatched(ev.event_num);
          console.log(`Ожидаемое событие '${eventName}' найдено.`);
          return;
        }

        const evDataJson = ev.data ? JSON.stringify(ev.data) : null;
        if (evDataJson && containsJsonData(evDataJson, data)) {
          this.eventsFileStorage.markEventAsMatched(ev.event_num);
          console.log(`Ожидаемое событие '${eventName}' найдено (по данным).`);
          return;
        }
      }
      await sleep(pollingInterval);
    }

    if (data) {
      throw new Error(
        `Ожидаемое событие '${eventName}' с данными '${data}' не обнаружено за ${timeoutEventExpectation} секунд.`
      );
    } else {
      throw new Error(`Ожидаемое событие '${eventName}' не обнаружено за ${timeoutEventExpectation} секунд.`);
    }
  }

  checkHasEventAsync(eventName: string, eventData?: string | null, timeoutEventExpectation?: number): void;
  checkHasEventAsync(eventName: string, eventDataFilePath?: string | null, timeoutEventExpectation?: number): void;

  checkHasEventAsync(
    eventName: string,
    eventDataOrFile?: string | null,
    timeoutEventExpectation: number = DEFAULT_TIMEOUT_EVENT_CHECK_EXPECTATION
  ): void {
    let data: string | null = null;
    if (typeof eventDataOrFile === "string") {
      const maybePath = path.resolve(eventDataOrFile);
      if (fs.existsSync(maybePath) && fs.statSync(maybePath).isFile()) {
        data = fs.readFileSync(maybePath, "utf8");
      } else {
        data = eventDataOrFile;
      }
    }

    const pollingInterval = 500;
    const timeoutMs = timeoutEventExpectation * 1000;

    const job = (async () => {
      const initialCount = this.eventsFileStorage.getEvents().length;
      const started = Date.now();

      while (Date.now() - started < timeoutMs) {
        const newEvents = this.eventsFileStorage.getEvents().slice(initialCount);

        for (const ev of newEvents) {
          if (this.eventsFileStorage.isEventAlreadyMatched(ev.event_num)) continue;
          if (ev.name !== eventName) continue;

          if (!data) {
            this.eventsFileStorage.markEventAsMatched(ev.event_num);
            console.log(`Ожидаемое событие '${eventName}' найдено (async).`);
            return;
          }

          const evDataJson = ev.data ? JSON.stringify(ev.data) : null;
          if (evDataJson && containsJsonData(evDataJson, data)) {
            this.eventsFileStorage.markEventAsMatched(ev.event_num);
            console.log(`Ожидаемое событие '${eventName}' найдено (async, по данным).`);
            return;
          }
        }
        await sleep(pollingInterval);
      }

      if (data) {
        throw new Error(
          `Событие '${eventName}' с данными '${data}' не было обнаружено за ${timeoutEventExpectation} секунд (async).`
        );
      } else {
        throw new Error(`Событие '${eventName}' не было обнаружено за ${timeoutEventExpectation} секунд (async).`);
      }
    })();

    this.jobs.push(job);
  }

  async awaitAllEventChecks() {
    const toWait = [...this.jobs];
    this.jobs.length = 0;
    for (const j of toWait) await j;
  }

  // -------------------------------------------------------------
  // Геттеры
  // -------------------------------------------------------------
  async getText(
    element: PageElement | null | undefined,
    elementNumber: number | null = null,
    timeoutBeforeExpectation = DEFAULT_TIMEOUT_BEFORE_EXPECTATION,
    timeoutExpectation = DEFAULT_TIMEOUT_EXPECTATION,
    pollingInterval = DEFAULT_POLLING_INTERVAL,
    scrollCount = DEFAULT_SCROLL_COUNT,
    scrollCapacity = DEFAULT_SCROLL_CAPACITY,
    scrollDirection: ScrollDirection = DEFAULT_SCROLL_DIRECTION
  ): Promise<string> {
    const el = await this.waitForElements(
      element,
      elementNumber,
      timeoutBeforeExpectation,
      timeoutExpectation,
      pollingInterval,
      scrollCount,
      scrollCapacity,
      scrollDirection
    );
    return String(await el.getText());
  }

  async getPrice(
    element: PageElement | null | undefined,
    elementNumber: number | null = null,
    timeoutBeforeExpectation = DEFAULT_TIMEOUT_BEFORE_EXPECTATION,
    timeoutExpectation = DEFAULT_TIMEOUT_EXPECTATION,
    pollingInterval = DEFAULT_POLLING_INTERVAL,
    scrollCount = DEFAULT_SCROLL_COUNT,
    scrollCapacity = DEFAULT_SCROLL_CAPACITY,
    scrollDirection: ScrollDirection = DEFAULT_SCROLL_DIRECTION
  ): Promise<number | null> {
    const text = await this.getText(
      element,
      elementNumber,
      timeoutBeforeExpectation,
      timeoutExpectation,
      pollingInterval,
      scrollCount,
      scrollCapacity,
      scrollDirection
    );
    const digits = text.replace(/\D+/g, "");
    return digits ? parseInt(digits, 10) : null;
  }

  async getAttributeValue(
    element: PageElement | null | undefined,
    attribute: string,
    elementNumber: number | null = null,
    timeoutBeforeExpectation = DEFAULT_TIMEOUT_BEFORE_EXPECTATION,
    timeoutExpectation = DEFAULT_TIMEOUT_EXPECTATION,
    pollingInterval = DEFAULT_POLLING_INTERVAL,
    scrollCount = DEFAULT_SCROLL_COUNT,
    scrollCapacity = DEFAULT_SCROLL_CAPACITY,
    scrollDirection: ScrollDirection = DEFAULT_SCROLL_DIRECTION
  ): Promise<string> {
    const el = await this.waitForElements(
      element,
      elementNumber,
      timeoutBeforeExpectation,
      timeoutExpectation,
      pollingInterval,
      scrollCount,
      scrollCapacity,
      scrollDirection
    );
    const val = await el.getAttribute(attribute);
    return String(val ?? "");
  }

  // -------------------------------------------------------------
  // Скролл/свайпы
  // -------------------------------------------------------------
  async scrollDown(scrollCount = DEFAULT_SCROLL_COUNT, scrollCapacity = DEFAULT_SCROLL_CAPACITY) {
    await this.performScroll(null, scrollCount, scrollCapacity, ScrollDirection.Down);
  }

  async scrollUp(scrollCount = DEFAULT_SCROLL_COUNT, scrollCapacity = DEFAULT_SCROLL_CAPACITY) {
    await this.performScroll(null, scrollCount, scrollCapacity, ScrollDirection.Up);
  }

  async scrollRight(scrollCount = DEFAULT_SCROLL_COUNT, scrollCapacity = DEFAULT_SCROLL_CAPACITY) {
    await this.performScroll(null, scrollCount, scrollCapacity, ScrollDirection.Right);
  }

  async scrollLeft(scrollCount = DEFAULT_SCROLL_COUNT, scrollCapacity = DEFAULT_SCROLL_CAPACITY) {
    await this.performScroll(null, scrollCount, scrollCapacity, ScrollDirection.Left);
  }

  async swipeDown(element: PageElement | null | undefined, scrollCount = DEFAULT_SCROLL_COUNT, scrollCapacity = DEFAULT_SCROLL_CAPACITY) {
    await this.performScroll(element, scrollCount, scrollCapacity, ScrollDirection.Down);
  }

  async swipeUp(element: PageElement | null | undefined, scrollCount = DEFAULT_SCROLL_COUNT, scrollCapacity = DEFAULT_SCROLL_CAPACITY) {
    await this.performScroll(element, scrollCount, scrollCapacity, ScrollDirection.Up);
  }

  async swipeRight(element: PageElement | null | undefined, scrollCount = DEFAULT_SCROLL_COUNT, scrollCapacity = DEFAULT_SCROLL_CAPACITY) {
    await this.performScroll(element, scrollCount, scrollCapacity, ScrollDirection.Right);
  }

  async swipeLeft(element: PageElement | null | undefined, scrollCount = DEFAULT_SCROLL_COUNT, scrollCapacity = DEFAULT_SCROLL_CAPACITY) {
    await this.performScroll(element, scrollCount, scrollCapacity, ScrollDirection.Left);
  }

  // -------------------------------------------------------------
  // Базовые функции поиска элементов
  // -------------------------------------------------------------
  async waitForElements(
    element: PageElement | null | undefined,
    elementNumber: number | null = null,
    timeoutBeforeExpectation = DEFAULT_TIMEOUT_BEFORE_EXPECTATION,
    timeoutExpectation = DEFAULT_TIMEOUT_EXPECTATION,
    pollingInterval = DEFAULT_POLLING_INTERVAL,
    scrollCount = DEFAULT_SCROLL_COUNT,
    scrollCapacity = DEFAULT_SCROLL_CAPACITY,
    scrollDirection: ScrollDirection = DEFAULT_SCROLL_DIRECTION
  ): Promise<WebdriverIO.Element> {
    await waitForUIStable(timeoutBeforeExpectation, pollingInterval);

    let currentScroll = 0;
    const attempted: any[] = [];
    const failed: any[] = [];
    let lastErr: any;

    while (true) {
      const locators =
        (element?.getAll && (await element.getAll())) ?? [element?.get ? await element.get() : null];

      for (const loc of (locators || []).filter(Boolean)) {
        try {
          attempted.push(loc);
          const els = await findAllByLocator(loc, timeoutExpectation, pollingInterval);
          if (!els.length) throw new Error("elements not found");
          const safeIndex = elementNumber ?? 1;
          if (safeIndex < 1 || safeIndex > els.length) {
            throw new Error(`Элемент ${elementNumber} вне диапазона (всего найдено: ${els.length})`);
          }

          if (failed.length) {
            console.info(
              `[waitForElements] Не найдены локаторы: ${failed.map(String).join(", ")}. Успешный локатор: ${String(
                loc
              )}`
            );
          }
          const el = els[safeIndex - 1];
          const displayed = await el.isDisplayed();
          if (displayed) return el;
          throw new Error("Элемент найден, но не видим");
        } catch (e) {
          lastErr = e;
          failed.push(loc);
        }
      }

      if (scrollCount > 0 && currentScroll < scrollCount) {
        await this.performScroll(null, 1, scrollCapacity, scrollDirection);
        currentScroll++;
      } else {
        const locatorsInfo =
          failed.length > 0
            ? `Локаторы не найдены: ${failed.map(String).join(", ")} из списка ${attempted.map(String).join(", ")}`
            : attempted.length > 0
              ? `Пробовали локаторы: ${attempted.map(String).join(", ")}`
              : "Локаторов нет";

        const msg = lastErr
          ? `Элементы не найдены за '${timeoutExpectation}' секунд после '${currentScroll}' скроллов. ${locatorsInfo}. Причина: ${
            (lastErr as any)?.message
          }`
          : `Элементы не найдены за '${timeoutExpectation}' секунд после '${currentScroll}' скроллов. ${locatorsInfo}`;

        throw new Error(msg);
      }
    }
  }

  private async performScroll(
    element: PageElement | null | undefined,
    scrollCount: number,
    scrollCapacity: number,
    scrollDirection: ScrollDirection
  ) {
    if (!(scrollCapacity > 0 && scrollCapacity <= 1.0)) {
      throw new Error(`scrollCapacity=${scrollCapacity}, допустимый диапазон (0.0; 1.0]`);
    }

    if (element) {
      const el = await this.waitForElements(element);
      const [loc, size] = await Promise.all([el.getLocation(), el.getSize()]);
      const rect = { x: loc.x, y: loc.y, width: size.width, height: size.height };

      for (let i = 0; i < scrollCount; i++) {
        if (scrollDirection === ScrollDirection.Right || scrollDirection === ScrollDirection.Left) {
          const isRight = scrollDirection === ScrollDirection.Right;
          const width = rect.width * scrollCapacity;
          const centerY = Math.round(rect.y + rect.height / 2);
          const startX = Math.round(
            rect.x + (isRight ? width * DEFAULT_SWIPE_COEFFICIENT : width * (1 - DEFAULT_SWIPE_COEFFICIENT))
          );
          const endX = Math.round(
            rect.x + (isRight ? width * (1 - DEFAULT_SWIPE_COEFFICIENT) : width * DEFAULT_SWIPE_COEFFICIENT)
          );
          await this.touchAndMoveHorizontal(centerY, startX, endX);
        } else {
          const isDown = scrollDirection === ScrollDirection.Down;
          const height = rect.height * scrollCapacity;
          const centerX = Math.round(rect.x + rect.width / 2);
          const startY = Math.round(
            rect.y + (isDown ? height * DEFAULT_SWIPE_COEFFICIENT : height * (1 - DEFAULT_SWIPE_COEFFICIENT))
          );
          const endY = Math.round(
            rect.y + (isDown ? height * (1 - DEFAULT_SWIPE_COEFFICIENT) : height * DEFAULT_SWIPE_COEFFICIENT)
          );
          await this.touchAndMoveVertical(centerX, startY, endY);
        }
      }
    } else {
      const size = await this.drv.getWindowSize();
      for (let i = 0; i < scrollCount; i++) {
        if (scrollDirection === ScrollDirection.Right || scrollDirection === ScrollDirection.Left) {
          const isRight = scrollDirection === ScrollDirection.Right;
          const width = size.width * scrollCapacity;
          const centerY = Math.round(size.height / 2);
          const startX = Math.round(isRight ? width * DEFAULT_SCROLL_COEFFICIENT : width * (1 - DEFAULT_SCROLL_COEFFICIENT));
          const endX = Math.round(isRight ? 0 : width);
          await this.touchAndMoveHorizontal(centerY, startX, endX);
        } else {
          const isDown = scrollDirection === ScrollDirection.Down;
          const height = size.height * scrollCapacity;
          const centerX = Math.round(size.width / 2);
          const startY = Math.round(isDown ? height * DEFAULT_SCROLL_COEFFICIENT : height * (1 - DEFAULT_SCROLL_COEFFICIENT));
          const endY = Math.round(isDown ? 0 : height);
          await this.touchAndMoveVertical(centerX, startY, endY);
        }
      }
    }
  }

  private async touchAndMoveVertical(centerX: number, startY: number, endY: number) {
    await this.drv.performActions([
      {
        type: "pointer",
        id: "finger1",
        parameters: { pointerType: "touch" },
        actions: [
          { type: "pointerMove", duration: 0, x: centerX, y: startY },
          { type: "pointerDown", button: 0 },
          { type: "pause", duration: 500 },
          { type: "pointerMove", duration: 500, x: centerX, y: endY },
          { type: "pointerUp", button: 0 },
        ],
      },
    ]);
    await this.drv.releaseActions();
  }

  private async touchAndMoveHorizontal(centerY: number, startX: number, endX: number) {
    await this.drv.performActions([
      {
        type: "pointer",
        id: "finger1",
        parameters: { pointerType: "touch" },
        actions: [
          { type: "pointerMove", duration: 0, x: startX, y: centerY },
          { type: "pointerDown", button: 0 },
          { type: "pause", duration: 500 },
          { type: "pointerMove", duration: 500, x: endX, y: centerY },
          { type: "pointerUp", button: 0 },
        ],
      },
    ]);
    await this.drv.releaseActions();
  }

  // -------------------------------------------------------------
  // Deeplink (Android/iOS через mobile: deepLink + fallback)
  // -------------------------------------------------------------
  async openDeeplink(deeplink: string) {
    const platform = AppConfig.getPlatform();

    if (platform === Platform.ANDROID) {
      await this.drv.execute("mobile: deepLink", {
        url: deeplink,
        package: AppConfig.getAppPackage(),
      });
      return;
    }

    if (platform === Platform.IOS) {
      try {
        const bundleId =
          (AppConfig as any).getBundleId?.() ||
          (AppConfig as any).getIosBundleId?.() ||
          (AppConfig as any).getAppBundleId?.();

        if (!bundleId) throw new Error("Не найден bundleId в AppConfig.");

        await this.drv.execute("mobile: deepLink", {
          url: deeplink,
          bundleId,
        });
        return;
      } catch (e) {
        console.warn(`[openDeeplink][iOS] mobile: deepLink не сработал, fallback: ${String((e as Error).message)}`);
        const encoded = encodeURIComponent(deeplink);
        const simId = await Terminal.getSimulatorId(AppConfig.getIosDeviceName());
        const launchUrl = `${this.app.webServer.getHostingUrl()}src/adapters/web/assets/deeplink.html?url=${encoded}`;

        await Terminal.runCommand(["xcrun", "simctl", "openurl", String(simId), launchUrl], "Нет возможность открыть deeplink");

        const locator = new PageElement({
          android: null,
          ios: { using: "css selector", value: "#deeplink" },
        });

        const btn = await this.waitForElements(locator, null, 0, 15, DEFAULT_POLLING_INTERVAL, 0, 1, DEFAULT_SCROLL_DIRECTION);
        await btn.click();
        return;
      }
    }

    throw new Error("Неподдерживаемая платформа");
  }

  // -------------------------------------------------------------
  // Алерты и нативные действия
  // -------------------------------------------------------------
  alert(timeoutExpectation = DEFAULT_TIMEOUT_EXPECTATION, pollingInterval = DEFAULT_POLLING_INTERVAL): AlertHandler {
    return new AlertHandler(this.drv as any, timeoutExpectation, pollingInterval);
  }

  async performNativeAction(opts: { androidKey?: number | string; iosKey?: string }) {
    const platform = AppConfig.getPlatform();
    if (platform === Platform.ANDROID) {
      const key = opts.androidKey;
      if (key === undefined || key === null) throw new Error("Нужно передать androidKey для Android-платформы");
      // @ts-ignore
      if (typeof (this.drv as any).pressKeyCode === "function" && typeof key === "number") {
        // @ts-ignore
        await (this.drv as any).pressKeyCode(key);
      } else {
        // @ts-ignore
        await (this.drv as any).execute("mobile: pressKey", { key: String(key) });
      }
      return;
    }

    if (platform === Platform.IOS) {
      const key = opts.iosKey;
      if (!key) throw new Error("Нужно передать iosKey для iOS-платформы");
      await this.drv.keys(key);
      return;
    }
  }

  async tapEnter() {
    await this.performNativeAction({
      androidKey: "enter",
      iosKey: "\n",
    });
  }
}

// Экземпляр
export const mobileActions = new MobileActions();

/** Флаг, чтобы не регистрировать хуки повторно */
let _hooksRegistered = false;

/** Явная регистрация vitest-хуков (один раз) */
export function registerMobileHooks() {
  if (_hooksRegistered) return;
  _hooksRegistered = true;

  beforeAll(async () => {
    await MobileActions.setUpAll();
  });
  beforeEach(async () => {
    const name =
      (typeof (expect as any).getState === "function" && (expect as any).getState().currentTestName) || "Test";
    await mobileActions.setUp(name);
  });
  afterEach(async () => {
    const name =
      (typeof (expect as any).getState === "function" && (expect as any).getState().currentTestName) || "Test";
    await mobileActions.tearDown(name);
  });
  afterAll(async () => {
    await MobileActions.tearDownAll();
  });
}

/** Авто-регистрация при импорте (можно отключить переменной окружения) */
if (process.env.DISABLE_MOBILE_AUTO_HOOKS !== "1") {
  const g = globalThis as any;
  if (!g.__MOBILE_HOOKS_REGISTERED__) {
    registerMobileHooks();
    g.__MOBILE_HOOKS_REGISTERED__ = true;
  }
}