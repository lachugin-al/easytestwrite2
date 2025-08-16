import { AppConfig } from "../../config/app-config";
import { Platform } from "../platform";

/**
 * Универсальный дескриптор элемента страницы.
 * Для WDIO локатор — это либо строка (XPath/селектор), либо объект { using, value }.
 */
export type Locator = string | { using: string; value: string };

export class PageElement {
  private android?: Locator | null;
  private ios?: Locator | null;
  private androidList?: Locator[] | null;
  private iosList?: Locator[] | null;

  constructor(opts?: {
    android?: Locator | null;
    ios?: Locator | null;
    androidList?: Locator[] | null;
    iosList?: Locator[] | null;
  }) {
    this.android = opts?.android ?? null;
    this.ios = opts?.ios ?? null;
    this.androidList = opts?.androidList ?? null;
    this.iosList = opts?.iosList ?? null;
  }

  /**
   * Получить локатор для текущей платформы.
   */
  get(): Locator | null {
    const platform = AppConfig.getPlatform();
    if (platform === Platform.ANDROID) {
      return this.android ?? this.androidList?.[0] ?? null;
    }
    if (platform === Platform.IOS) {
      return this.ios ?? this.iosList?.[0] ?? null;
    }
    return null;
  }

  /**
   * Получить список локаторов для текущей платформы.
   */
  getAll(): Locator[] | null {
    const platform = AppConfig.getPlatform();
    if (platform === Platform.ANDROID) {
      return this.androidList ?? (this.android ? [this.android] : null);
    }
    if (platform === Platform.IOS) {
      return this.iosList ?? (this.ios ? [this.ios] : null);
    }
    return null;
  }

  // ====== companion-фабрики из Kotlin ======

  /** Полный id ресурса Android с префиксом пакета. */
  private static fullPackageId(value: string) {
    return `${AppConfig.getAppPackage()}:id/${value}`;
  }

  /** PageElement с accessibility id для обеих платформ. */
  static byAccessibilityId(accessibilityId: string): PageElement {
    const loc = PageElement.AccessibilityId(accessibilityId);
    return new PageElement({ android: loc, ios: loc });
  }

  /** PageElement с accessibility id только для Android. */
  static byAndroidAccessibilityId(accessibilityId: string): PageElement {
    return new PageElement({ android: PageElement.AccessibilityId(accessibilityId) });
  }

  /** PageElement с accessibility id только для iOS. */
  static byIOSAccessibilityId(accessibilityId: string): PageElement {
    return new PageElement({ ios: PageElement.AccessibilityId(accessibilityId) });
  }

  /** PageElement с Android UIAutomator. */
  static byAndroidUIAutomator(expr: string): PageElement {
    return new PageElement({ android: PageElement.AndroidUIAutomator(expr) });
  }

  /** PageElement с iOS Class Chain. */
  static byIOSClassChain(expr: string): PageElement {
    return new PageElement({ ios: PageElement.IOSClassChain(expr) });
  }

  /** PageElement с iOS Predicate String. */
  static byIOSPredicateString(expr: string): PageElement {
    return new PageElement({ ios: PageElement.IOSPredicateString(expr) });
  }

  /** PageElement со списком локаторов для Android. */
  static byAndroidLocators(locators: Locator[]): PageElement {
    return new PageElement({ androidList: locators });
  }

  /** PageElement со списком локаторов для iOS. */
  static byIOSLocators(locators: Locator[]): PageElement {
    return new PageElement({ iosList: locators });
  }

  /** PageElement со списком локаторов для обеих платформ. */
  static byLocators(opts: { androidLocators?: Locator[] | null; iosLocators?: Locator[] | null }): PageElement {
    return new PageElement({ androidList: opts.androidLocators ?? null, iosList: opts.iosLocators ?? null });
  }

  // ====== «вложенные» конструкторы локаторов как в Kotlin ======
  // Реализованы как static-методы, возвращающие Appium/WDIO локаторы.

  /** Поиск по id (XPath c contains + поддержка full package id). */
  static Id(id: string): Locator {
    const v = PageElement.escapeXPath(id);
    const full = PageElement.fullPackageId(id);
    const fullEsc = PageElement.escapeXPath(full);
    return { using: "xpath", value: `.//*[contains(@id,${v}) or contains(@id,${fullEsc})]` };
  }

  /** Поиск по android resource-id. */
  static ResourceId(resourceId: string): Locator {
    const v = PageElement.escapeXPath(resourceId);
    const full = PageElement.fullPackageId(resourceId);
    const fullEsc = PageElement.escapeXPath(full);
    return { using: "xpath", value: `.//*[contains(@resource-id,${v}) or contains(@resource-id,${fullEsc})]` };
  }

  /** Поиск по точному тексту. */
  static Text(text: string): Locator {
    const v = PageElement.escapeXPath(text);
    return { using: "xpath", value: `.//*[@text = ${v}]` };
  }

  /** Поиск по частичному совпадению текста/атрибутов. */
  static Contains(text: string): Locator {
    const v = PageElement.escapeXPath(text);
    return {
      using: "xpath",
      value:
        `.//*[contains(@text,${v}) or contains(@id,${v}) or contains(@resource-id,${v}) or ` +
        `contains(@content-desc,${v}) or contains(@name,${v}) or contains(@label,${v}) or contains(@value,${v})]`,
    };
  }

  /** Поиск по точному совпадению среди множества атрибутов. */
  static ExactMatch(text: string): Locator {
    const v = PageElement.escapeXPath(text);
    return {
      using: "xpath",
      value:
        `.//*[(@text=${v} or @id=${v} or @resource-id=${v} or @content-desc=${v} or ` +
        `@name=${v} or @label=${v} or @value=${v})]`,
    };
  }

  /** Поиск по content-desc (Android). */
  static ContentDesc(contentDesc: string): Locator {
    const v = PageElement.escapeXPath(contentDesc);
    return { using: "xpath", value: `.//*[contains(@content-desc,${v})]` };
  }

  /** Произвольный XPath. */
  static XPath(xpathExpression: string): Locator {
    return { using: "xpath", value: xpathExpression };
  }

  /** Поиск по @value (iOS). */
  static Value(value: string): Locator {
    const v = PageElement.escapeXPath(value);
    return { using: "xpath", value: `.//*[contains(@value,${v})]` };
  }

  /** Поиск по @name (iOS). */
  static Name(name: string): Locator {
    const v = PageElement.escapeXPath(name);
    return { using: "xpath", value: `.//*[contains(@name,${v})]` };
  }

  /** Поиск по @label (iOS). */
  static Label(label: string): Locator {
    const v = PageElement.escapeXPath(label);
    return { using: "xpath", value: `.//*[contains(@label,${v})]` };
  }

  /** Accessibility ID (Android/iOS). */
  static AccessibilityId(accessibilityId: string): Locator {
    return { using: "accessibility id", value: accessibilityId };
  }

  /** Android UIAutomator. */
  static AndroidUIAutomator(expr: string): Locator {
    return { using: "-android uiautomator", value: expr };
  }

  /** iOS Class Chain. */
  static IOSClassChain(expr: string): Locator {
    return { using: "-ios class chain", value: expr };
  }

  /** iOS Predicate String. */
  static IOSPredicateString(expr: string): Locator {
    return { using: "-ios predicate string", value: expr };
  }

  // Утилита: безопасная вставка строки в XPath (wrap в одинарные/двойные кавычки)
  private static escapeXPath(s: string): string {
    if (!s.includes("'")) return `'${s}'`;
    if (!s.includes('"')) return `"${s}"`;
    // concat('ab', "'", 'cd')
    const parts = s.split("'");
    return "concat(" + parts.map((p, i) => (i ? `"'","${p}"` : `"${p}"`)).join(",") + ")";
  }
}