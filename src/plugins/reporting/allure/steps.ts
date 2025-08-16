import * as allure from "allure-js-commons";
import { ContentType } from "allure-js-commons";

/** Безопасное имя шага из template literal */
function interpolate(strings: TemplateStringsArray, exprs: any[]) {
  return strings.reduce((acc, s, i) => acc + s + (i < exprs.length ? String(exprs[i]) : ""), "");
}

/** Артефакты при падении шага: скрин и page source (если доступен глобальный драйвер) */
async function attachArtifactsOnError(err: unknown) {
  const drv: any = (globalThis as any).driver;
  try {
    if (drv?.takeScreenshot) {
      const pngB64 = await drv.takeScreenshot();
      await allure.attachment("screenshot.png", Buffer.from(pngB64, "base64"), ContentType.PNG);
    }
  } catch { /* ignore */
  }

  try {
    if (drv?.getPageSource) {
      const xml = await drv.getPageSource();
      await allure.attachment("pageSource.xml", xml, ContentType.XML);
    }
  } catch { /* ignore */
  }

  // полезно ещё сохранить текст ошибки
  try {
    await allure.attachment("error.txt", String((err as any)?.stack || err), ContentType.TEXT);
  } catch { /* ignore */
  }
}

/** Базовый helper: шаг с артефактами при падении */
export async function step<T>(title: string, body: () => Promise<T> | T): Promise<T> {
  try {
    return await allure.step(title, async () => await body());
  } catch (err) {
    await attachArtifactsOnError(err);
    throw err;
  }
}

/** Теговый синтаксис: await s`Описание`(() => действие()) */
export const s = (strings: TemplateStringsArray, ...exprs: any[]) => {
  const title = interpolate(strings, exprs);
  return async <T>(fn: () => Promise<T> | T) => step(title, fn);
};

/** Оборачивает РОВНО следующий вызов метода объекта в шаг (описание → действие). */
export function withStep<T extends object>(title: string, target: T): T {
  let used = false;
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const orig: any = Reflect.get(obj, prop, receiver);
      if (typeof orig !== "function") return orig;
      return async (...args: any[]) => {
        if (used) {
          // если кто-то сохранит ссылку на метод и вызовет повторно — не дублируем
          return await orig.apply(obj, args);
        }
        used = true;
        return await step(title, () => orig.apply(obj, args));
      };
    },
  });
}

/** Фабрика: оборачивает ВСЕ методы объекта в автошаги (дефолтные названия). */
export function createAlluredProxy<T extends object>(target: T, titleFn?: (method: string, args: any[]) => string): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const orig: any = Reflect.get(obj, prop, receiver);
      if (typeof orig !== "function") return orig;
      return async (...args: any[]) => {
        const title = titleFn
          ? titleFn(String(prop), args)
          : `${String(prop)}(${args.map(a => JSON.stringify(a)).join(", ")})`;
        return await step(title, () => orig.apply(obj, args));
      };
    },
  });
}