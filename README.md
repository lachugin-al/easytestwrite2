# easytestwrite2

Черновик README.

## Скрипты

- `npm run dev` — запуск в dev-режиме (ts-node/esm)
- `npm run build` — сборка TypeScript в `dist`
- `npm start` — запуск собранной версии
- `npm run lint` — проверка ESLint
- `npm run lint:fix` — исправление с `--fix`
- `npm run format` — форматирование Prettier
- `npm run format:check` — проверка форматирования Prettier
- `npm run typecheck` — проверка типов без вывода
- `npm test` — запуск тестов vitest

## Качество кода

- ESLint + @typescript-eslint
- Prettier
- EditorConfig

## Pre-commit

Husky + lint-staged: линт и форматирование изменённых файлов, затем запуск тестов.

## CI

GitHub Actions: install → lint → test → build.
