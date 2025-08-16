import { ScrollDirection } from "./gestures/scroll-direction";

/**
 * Константы для настройки таймаутов, скроллинга и поиска элементов в тестах.
 */

/** Количество секунд ожидания перед началом поиска элемента. */
export const DEFAULT_TIMEOUT_BEFORE_EXPECTATION: number = 0;

/** Максимум секунд поиска элемента. */
export const DEFAULT_TIMEOUT_EXPECTATION: number = 10;

/** Максимум секунд ожидания события (проверки EventStorage). */
export const DEFAULT_TIMEOUT_EVENT_CHECK_EXPECTATION: number = 15;

/** Коэффициент отступов от края экрана при скролле. */
export const DEFAULT_SCROLL_COEFFICIENT: number = 0.75;

/** Коэффициент отступов от размеров элемента при свайпе. */
export const DEFAULT_SWIPE_COEFFICIENT: number = 0.95;

/** Допустимое число скроллов при поиске элемента. 0 — без скролла. */
export const DEFAULT_SCROLL_COUNT: number = 0;

/** Доля экрана, проходимая за один скролл. 1.0 — одна «страница». */
export const DEFAULT_SCROLL_CAPACITY: number = 1.0;

/** Частота опроса элемента (мс). */
export const DEFAULT_POLLING_INTERVAL: number = 1000;

/** Направление скролла по умолчанию. */
export const DEFAULT_SCROLL_DIRECTION: ScrollDirection = ScrollDirection.Down;