/**
 * Модель события, зафиксированного в процессе тестирования.
 *
 * Используется для сериализации и хранения данных о сетевых запросах,
 * отправленных приложением во время выполнения тестов.
 *
 * Все события записываются в формате `Event` и могут быть использованы
 * для валидации отправляемых данных и воспроизведения сетевого поведения.
 *
 * @property event_time Метка времени события (например, new Date().toISOString()).
 * @property event_num  Уникальный номер события в рамках одной сессии тестирования.
 * @property name       Название события (например, HTTP-метод или логическое имя запроса).
 * @property data       Детали события, включая тело запроса и метаинформацию `EventData`.
 */
export interface Event {
  event_time: string;
  event_num: number;
  name: string;
  data?: EventData | null;
}

/**
 * Детальная информация о сетевом запросе, связанная с событием `Event`.
 *
 * Модель предназначена для хранения всей полезной нагрузки запроса,
 * включая URI запроса, IP-адрес отправителя, заголовки, параметры запроса и тело.
 *
 * @property uri           Полный путь запроса (например, "/m/batch").
 * @property remoteAddress Адрес клиента, отправившего запрос (например, "192.168.1.2:53427").
 * @property headers       Коллекция заголовков HTTP-запроса (каждый заголовок — массив значений).
 * @property query         Строка query-параметров, если есть (без ведущего '?').
 * @property body          Тело запроса в формате JSON (строка).
 */
export interface EventData {
  uri: string;
  remoteAddress: string | null;
  headers: Record<string, string[]>;
  query?: string | null;
  body: string;
}

/**
 * Утилита для нормализации заголовков Node.js к виду Record<string, string[]>,
 * чтобы соответствовать типу из Kotlin (Map<String, List<String>>).
 */
export function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(headers)) {
    const k = key.toLowerCase();
    if (Array.isArray(val)) out[k] = val.map(String);
    else if (typeof val === "string") out[k] = [val];
    else out[k] = [];
  }
  return out;
}