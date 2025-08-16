import type { Event } from "./model";

/**
 * Хранилище событий, зафиксированных в процессе тестирования.
 *
 * Служит для централизованного сохранения всех полученных `Event`,
 * а также для управления их состоянием (обработано/не обработано).
 *
 * Используется для поиска событий по различным критериям в рамках тестовых проверок.
 */
class EventStorageImpl {
  /** Список всех зафиксированных событий. */
  private readonly events: Event[] = [];

  /** Набор номеров событий, которые уже были обработаны в проверках. */
  private readonly matchedEvents = new Set<number>();

  /**
   * Добавляет список новых событий в хранилище.
   *
   * Перед добавлением выполняется проверка на уникальность номера события (`event_num`).
   * Повторяющиеся события игнорируются.
   *
   * @param newEvents Список новых событий для добавления.
   */
  addEvents(newEvents: Event[]): void {
    for (const event of newEvents) {
      if (!this.eventExists(event.event_num)) {
        this.events.push(event);
        // Аналог логгера: выводим краткую информацию о добавленном событии.
        console.log(
          `[EventStorage] Сохранено событие: ${event.name}, Номер: ${event.event_num}, Время: ${event.event_time}${
            event.data ? `, Данные: ${JSON.stringify(event.data)}` : ""
          }`
        );
      }
    }
  }

  /**
   * Проверяет наличие события в хранилище по его номеру.
   *
   * @param eventNumber Номер события.
   * @return `true`, если событие уже существует, иначе `false`.
   */
  private eventExists(eventNumber: number): boolean {
    // Используем обратный проход — последнее чаще новее и быстрее найдётся.
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].event_num === eventNumber) return true;
    }
    return false;
  }

  /**
   * Отмечает событие как обработанное (matched) по его номеру.
   *
   * @param eventNum Номер события для пометки.
   */
  markEventAsMatched(eventNum: number): void {
    this.matchedEvents.add(eventNum);
  }

  /**
   * Проверяет, было ли событие уже обработано.
   *
   * @param eventNum Номер события.
   * @return `true`, если событие уже отмечено как обработанное, иначе `false`.
   */
  isEventAlreadyMatched(eventNum: number): boolean {
    return this.matchedEvents.has(eventNum);
  }

  /**
   * Получает список событий, начиная с указанного индекса.
   *
   * Исключаются уже обработанные события.
   *
   * @param index Индекс, начиная с которого нужно получить события.
   * @return Список новых событий или пустой список, если индекс за пределами текущего размера хранилища.
   */
  getIndexEvents(index: number): Event[] {
    if (index < 0 || index >= this.events.length) return [];
    const slice = this.events.slice(index);
    return slice.filter((ev) => !this.isEventAlreadyMatched(ev.event_num));
  }

  /**
   * Возвращает все зафиксированные события.
   *
   * @return Копия списка всех событий.
   */
  getEvents(): Event[] {
    return this.events.slice();
  }

  /**
   * Возвращает последнее добавленное событие.
   *
   * @return Последнее событие или `undefined`, если хранилище пусто.
   */
  getLastEvent(): Event | undefined {
    return this.events[this.events.length - 1];
  }

  /**
   * Очищает хранилище событий и сбрасывает список обработанных событий.
   */
  clear(): void {
    this.events.length = 0;
    this.matchedEvents.clear();
  }
}

/** Синглтон, аналог Kotlin `object EventStorage`. */
export const EventStorage = new EventStorageImpl();
export type { Event } from "./model";