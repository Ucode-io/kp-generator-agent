# Спецификация генерации интерактивного HTML-прототипа

## 1. Статус документа

- Статус: Draft
- Версия: 1.0
- Репозиторий: `kp-generator-agent`
- Связанный артефакт: коммерческое предложение в PDF
- Визуальный референс: `/Users/nurmuhammad/Downloads/prototype 2/index.html`
- План устранения выявленных расхождений: `docs/app-prototype-quality-remediation-spec.md`

## 2. Цель

При генерации коммерческого предложения система должна создавать два связанных артефакта:

1. PDF коммерческого предложения.
2. Интерактивный HTML-прототип клиентского приложения.

HTML-прототип должен визуально соответствовать подходу из референса `prototype 2`: боковая навигация, мобильное устройство, набор интерактивных экранов, переходы и демонстрационные состояния. При этом структура приложения и состав экранов должны определяться логикой конкретного проекта, а не копировать фиксированный BNPL-сценарий.

На каждой странице PDF в нижней части должна отображаться кликабельная ссылка с иконкой телефона для открытия опубликованного HTML-прототипа.

## 3. Основные принципы

### 3.1. Один источник данных

PDF и HTML-прототип должны формироваться из одной общей модели проекта. Повторный независимый анализ prompt для HTML не допускается.

Общим источником являются существующие артефакты pipeline:

- `proposalModel`;
- `semanticModel`;
- `proposalPackage`;
- `visualStyleProfile`;
- данные scope, процессов, ролей, состояний и интеграций.

### 3.2. Шаблон вместо произвольного HTML

Модель не должна генерировать полный произвольный HTML, CSS или JavaScript.

Генерация разделяется на два этапа:

1. Построение валидируемой структуры `appPrototypeSpec`.
2. Рендеринг структуры через фиксированный и версионируемый HTML-шаблон.

Это необходимо для стабильного дизайна, безопасности, повторяемости результата и автоматического QA.

### 3.3. Экраны зависят от логики проекта

HTML-экраны соответствуют интерфейсам будущего продукта, а не страницам PDF.

Система должна анализировать:

- тип продукта;
- пользовательские роли;
- функции и scope;
- основные пользовательские процессы;
- задачи внутри процессов;
- состояния объектов;
- решения и развилки;
- внешние интеграции;
- административные и операторские функции.

На основании этих данных создаётся план экранов.

## 4. Общая архитектура

```text
Prompt и visual references
          │
          ▼
Proposal Model + Semantic Model + Visual Style Profile
          │
          ▼
Proposal Package
          │
          ├───────────────┐
          ▼               ▼
PDF Renderer       App Prototype Planner
          │               │
          │               ▼
          │        appPrototypeSpec
          │               │
          │               ▼
          │        HTML Prototype Renderer
          │               │
          ▼               ▼
    proposal.pdf      index.html
          │               │
          └──── prototype URL
```

URL прототипа должен быть известен до рендеринга PDF, чтобы PDF renderer мог добавить его в footer всех страниц.

## 5. Этапы генерации

### 5.1. Создание публичного идентификатора

После создания `requestId` система создаёт криптографически случайный `publicId`.

Требования:

- не использовать имя клиента или название проекта в URL;
- идентификатор должен быть непредсказуемым;
- URL должен быть сформирован до запуска renderer’ов;
- один запрос имеет один постоянный URL прототипа.

Пример:

```text
https://kp.udevs.io/p/7QmJv8Kx2A/
```

### 5.2. Построение общей модели

Существующий pipeline формирует:

- проект и его категорию;
- участников и роли;
- функции;
- scope;
- процессы и задачи;
- состояния;
- решения;
- интеграции;
- дизайн-токены;
- язык результата.

Эти данные используются обоими renderer’ами.

### 5.3. Планирование HTML-прототипа

Компонент `App Prototype Planner` строит `appPrototypeSpec`.

Планировщик должен:

1. Определить семейство продукта.
2. Определить основные пользовательские роли.
3. Найти главный пользовательский процесс.
4. Выбрать обязательные и условные экраны.
5. Сгруппировать экраны в навигацию.
6. Определить действия и переходы.
7. Выбрать подходящий тип шаблона для каждого экрана.
8. Добавить демонстрационные данные без персональных и секретных значений.

### 5.4. Параллельный рендеринг

После создания `proposalPackage` и `appPrototypeSpec` выполняются две ветки:

```text
Promise.all
  ├─ renderPdf(proposalPackage, prototypeUrl)
  └─ renderPrototype(appPrototypeSpec)
```

Запрос может перейти в состояние `ready` только после успешного завершения обеих веток и обязательного QA.

### 5.5. Публикация

После QA HTML публикуется по заранее созданному URL. PDF публикуется только при условии, что URL прототипа сформирован корректно и HTML-артефакт готов к выдаче.

## 6. Контракт appPrototypeSpec

План прототипа должен храниться как отдельный JSON-контракт и проверяться JSON Schema.

Предварительная структура:

```json
{
  "schemaVersion": "1.0",
  "requestId": "KP-20260803-ABC123",
  "publicId": "7QmJv8Kx2A",
  "locale": "ru-RU",
  "project": {
    "name": "Marketplace",
    "type": "ecommerce",
    "description": "Клиентское приложение маркетплейса"
  },
  "theme": {
    "primary": "#1A54FE",
    "secondary": "#0A0A0F",
    "background": "#F6F7F8",
    "surface": "#FFFFFF"
  },
  "navigation": [
    {
      "id": "customer",
      "title": "Покупатель",
      "screenIds": ["home", "catalog", "product", "cart"]
    }
  ],
  "screens": [
    {
      "id": "catalog",
      "type": "product_grid",
      "title": "Каталог",
      "description": "Поиск и выбор товаров",
      "roleIds": ["buyer"],
      "sourceRefs": ["SCOPE-002"],
      "actions": [
        {
          "id": "open-product",
          "label": "Открыть товар",
          "targetScreenId": "product"
        }
      ],
      "content": {}
    }
  ]
}
```

### 6.1. Обязательные поля

- `schemaVersion`;
- `requestId`;
- `publicId`;
- `locale`;
- `project`;
- `theme`;
- `navigation`;
- `screens`.

### 6.2. Требования к экрану

Каждый экран должен иметь:

- уникальный `id`;
- поддерживаемый `type`;
- заголовок;
- краткое описание;
- связь с ролью или ролями;
- связь с исходными элементами semantic model через `sourceRefs`;
- список допустимых действий;
- валидные target screen для переходов.

## 7. Правила выбора экранов

### 7.1. Общие правила

- Главный экран создаётся всегда.
- Навигация должна включать каждый доступный экран ровно один раз.
- Основной пользовательский процесс должен быть кликабельным от начала до результата.
- Авторизация создаётся только при наличии пользователя, профиля, ролей или access control в scope.
- Платёжные экраны создаются только при наличии соответствующей функции, процесса или интеграции.
- Доставка создаётся только при наличии delivery flow или delivery integration.
- Кабинет продавца создаётся только при наличии seller role или seller scope.
- Операторский интерфейс создаётся только при наличии internal operator role.
- Административный интерфейс создаётся только при наличии admin/control scope.
- Технические функции `API`, `database`, `cache` и `infrastructure` не превращаются напрямую в клиентские экраны.
- Если тип продукта не распознан, используется универсальный business-app сценарий.

### 7.2. Рекомендуемый объём

- минимум: 6 экранов;
- целевой диапазон: 8–14 экранов;
- максимум первой версии: 16 экранов.

Количество не должно быть фиксированным. Планировщик выбирает объём на основании scope и количества значимых пользовательских процессов.

### 7.3. Пример: marketplace

Возможные экраны:

- onboarding;
- login;
- home;
- catalog;
- search;
- product details;
- cart;
- checkout;
- payment;
- order confirmation;
- order tracking;
- profile;
- seller workspace;
- admin workspace.

### 7.4. Пример: BNPL/fintech

Возможные экраны:

- onboarding;
- identification;
- limit request;
- verification;
- home;
- installment offers;
- payment schedule;
- payment;
- transaction history;
- notifications;
- profile.

### 7.5. Пример: CRM

Возможные экраны:

- login;
- dashboard;
- lead list;
- lead details;
- pipeline;
- tasks;
- clients;
- reports;
- team;
- settings.

## 8. Библиотека типов экранов

Первая версия renderer должна поддерживать ограниченную библиотеку безопасных компонентов.

Типы экранов:

- `onboarding`;
- `login`;
- `dashboard`;
- `list`;
- `product_grid`;
- `details`;
- `form`;
- `stepper`;
- `checkout`;
- `payment`;
- `tracking`;
- `history`;
- `profile`;
- `analytics`;
- `settings`;
- `success`;
- `empty_state`;
- `error_state`.

Базовые UI-компоненты:

- app bar;
- bottom navigation;
- cards;
- metric cards;
- list rows;
- buttons;
- fields;
- tabs;
- filters;
- status badges;
- progress indicators;
- bottom sheets;
- dialogs;
- empty states;
- success/error alerts.

Пользовательский контент и конфигурация могут меняться, но JavaScript-поведение компонентов остаётся внутри renderer’а.

## 9. Визуальный шаблон

Визуальная система основывается на `prototype 2`.

Постоянные элементы:

- боковая навигация по группам экранов;
- центральная сцена;
- рамка мобильного устройства;
- status bar;
- Dynamic Island;
- прокручиваемый viewport;
- анимация переходов;
- отображение названия и описания выбранного экрана;
- адаптация для невысоких экранов.

Динамические элементы:

- название продукта;
- logo mark или буквенный fallback;
- цвета;
- навигационные группы;
- состав экранов;
- тексты;
- данные карточек и списков;
- действия;
- состояния;
- демонстрационный пользовательский flow.

## 10. Темизация

Приоритет источников цвета:

1. Подтверждённый `visualStyleProfile`.
2. Безопасно извлечённая палитра сайта или visual reference.
3. Статическая палитра Udevs.

Renderer обязан обеспечить:

- достаточный контраст текста;
- единое назначение primary/secondary/success/warning/error;
- отсутствие динамически созданных небезопасных CSS-значений;
- одинаковую визуальную идентичность PDF и HTML-прототипа.

## 11. Локализация

Поддерживаемые локали первой версии:

- `uz-Latn`;
- `ru-RU`;
- `en`.

Системные элементы renderer’а должны использовать словарь локализации. Контент semantic model отображается в языке проекта.

Не допускается смешивание языков в системной навигации и стандартных действиях.

## 12. Интерактивность

Прототип должен поддерживать:

- переходы через sidebar;
- переходы по кнопкам внутри мобильного интерфейса;
- возврат на предыдущий экран;
- bottom navigation;
- tabs;
- bottom sheets;
- dialogs;
- изменение демонстрационных состояний;
- прямую ссылку на экран через URL hash.

Пример:

```text
https://kp.udevs.io/p/7QmJv8Kx2A/#checkout
```

Все переходы должны ссылаться только на экраны, существующие в `appPrototypeSpec`.

## 13. Демонстрационные данные

Renderer может создавать демонстрационные значения для визуализации интерфейса.

Требования:

- не использовать реальные персональные данные;
- не выводить API keys, access tokens, внутренние пути или служебные идентификаторы;
- не представлять предположения как подтверждённые требования;
- не показывать неподтверждённую цену проекта как продуктовую величину;
- денежные значения интерфейса должны быть явно демонстрационными;
- данные должны соответствовать типу проекта и выбранной локали.

## 14. Интеграция ссылки в PDF

Каждая страница PDF должна содержать footer с:

- названием проекта или краткой меткой;
- кликабельной ссылкой на HTML-прототип;
- иконкой телефона;
- номером страницы.

Пример текста:

```text
Открыть интерактивный прототип ↗
```

Техническая форма:

```html
<a
  href="https://kp.udevs.io/p/7QmJv8Kx2A/"
  target="_blank"
  rel="noopener noreferrer"
>
  Открыть интерактивный прототип
</a>
```

Примечание: Chromium сохраняет HTTPS-ссылку как PDF URI annotation. Открытие именно в новой вкладке зависит от используемого PDF viewer.

## 15. Хранение артефактов

В workspace запроса должны сохраняться:

```text
contracts/app-prototype-spec.json
candidate/prototype/index.html
qa/app-prototype-qa.json
final/prototype/index.html
model/app-prototype-record.json
```

`app-prototype-record.json` должен содержать:

- `requestId`;
- `publicId`;
- `publicUrl`;
- версию renderer’а;
- относительный путь к HTML;
- SHA-256;
- размер файла;
- количество экранов;
- QA status;
- дату обновления.

## 16. HTTP API

Ответ `POST /v1/proposals` расширяется полями:

```json
{
  "ok": true,
  "requestId": "KP-20260803-ABC123",
  "documentPath": "/.../proposal.pdf",
  "prototype": {
    "url": "https://kp.udevs.io/p/7QmJv8Kx2A/",
    "path": "/.../final/prototype/index.html",
    "qaStatus": "PASS",
    "screenCount": 11,
    "rendererVersion": "app-prototype-v1"
  }
}
```

Публичный endpoint:

```text
GET /p/:publicId/
```

Endpoint не требует API bearer token, поскольку ссылка предназначена для клиента. Доступ ограничивается непредсказуемым `publicId`.

## 17. Безопасность

HTML renderer должен соблюдать следующие требования:

- запрещён произвольный JavaScript от модели;
- запрещены внешние scripts;
- запрещены inline event handlers, сформированные из пользовательского ввода;
- весь пользовательский и модельный текст экранируется;
- динамические URL проходят allowlist и protocol validation;
- используется Content Security Policy;
- устанавливается `X-Content-Type-Options: nosniff`;
- устанавливается `Referrer-Policy: no-referrer`;
- устанавливается `X-Robots-Tag: noindex, nofollow, noarchive`;
- не используются client name и project name в публичном URL;
- path traversal блокируется;
- HTML не должен содержать локальные filesystem paths;
- HTML не должен содержать секреты окружения.

Если в будущем будет разрешена генерация произвольного JavaScript, такой код должен выполняться только в отдельном sandbox. В первой версии это запрещено.

## 18. Retention

Срок хранения HTML должен быть не меньше срока доступности PDF.

Требования:

- PDF не должен вести на уже удалённый HTML;
- `final/prototype/index.html` включается в retention record;
- при удалении предложения удаляются PDF, HTML и публичное отображение `publicId`;
- рекомендуемый срок хранения равен сроку действия коммерческого предложения или задаётся явно бизнес-правилом;
- текущий 14-дневный retention требует пересмотра перед production-запуском.

## 19. QA

### 19.1. Контрактный QA

- `appPrototypeSpec` проходит JSON Schema validation;
- все screen IDs уникальны;
- все navigation references существуют;
- все action targets существуют;
- каждый экран связан хотя бы с одним source reference или прозрачным derivation rule;
- количество экранов находится в допустимом диапазоне.

### 19.2. DOM QA

Playwright должен проверить:

- HTML успешно загружается;
- отсутствуют JavaScript errors;
- количество отрендеренных экранов совпадает со spec;
- sidebar содержит все navigation items;
- стартовый экран активен;
- переходы по навигации работают;
- внутренние кнопки открывают существующие экраны;
- отсутствует нежелательное горизонтальное переполнение;
- мобильный viewport не выходит за рамку телефона;
- заголовок выбранного экрана обновляется.

### 19.3. Визуальный QA

- телефон отображается полностью;
- текст не обрезается критическим образом;
- primary actions визуально различимы;
- состояния success/warning/error используют правильные цвета;
- контраст основных текстов соответствует минимальному порогу;
- layout остаётся рабочим на desktop и при небольшой высоте окна.

### 19.4. PDF link QA

- ссылка присутствует на каждой странице;
- URL одинаков на всех страницах;
- URL соответствует опубликованному `publicId`;
- PDF содержит URI annotation;
- опубликованный endpoint возвращает HTTP 200 после завершения генерации.

## 20. Обработка ошибок

Запрос не может получить состояние `ready`, если:

- не сформирован `appPrototypeSpec`;
- spec не прошёл validation;
- HTML renderer завершился с ошибкой;
- Playwright QA не прошёл;
- не удалось сохранить или опубликовать HTML;
- PDF footer содержит неправильный URL;
- PDF QA не прошёл.

Рекомендуемые коды ошибок:

- `APP_PROTOTYPE_SPEC_INVALID`;
- `APP_PROTOTYPE_SCREEN_PLAN_EMPTY`;
- `APP_PROTOTYPE_NAVIGATION_INVALID`;
- `APP_PROTOTYPE_RENDER_FAILED`;
- `APP_PROTOTYPE_DOM_QA_FAILED`;
- `APP_PROTOTYPE_PUBLISH_FAILED`;
- `APP_PROTOTYPE_PUBLIC_URL_INVALID`;
- `PDF_PROTOTYPE_LINK_MISSING`;
- `PDF_PROTOTYPE_LINK_MISMATCH`.

## 21. Планируемые файлы реализации

```text
schemas/kp/app-prototype-spec-v1.schema.json
schemas/kp/app-prototype-record-v1.schema.json
scripts/kp_app_prototype_planner.mjs
scripts/kp_app_prototype_renderer.mjs
scripts/kp_app_prototype_qa.mjs
scripts/kp_app_prototype_publisher.mjs
assets/app-prototype/
```

Точки интеграции:

- `src/agent.mjs` — создание `publicId`, возврат результата;
- `src/server.mjs` — публичная выдача HTML;
- `scripts/kpi_pdf_client.mjs` — orchestration двух renderer’ов и promotion;
- `scripts/kp_pdf_reference_renderer.mjs` — footer со ссылкой;
- `scripts/kp_artifact_retention.mjs` — общий lifecycle PDF и HTML;
- `test/unit.mjs` — unit и contract tests;
- `test/smoke.mjs` — end-to-end generation test.

## 22. Этапы реализации

### Этап 1. Контракты

- добавить JSON Schema;
- добавить planner;
- реализовать детерминированные правила выбора экранов;
- покрыть правила unit-тестами.

### Этап 2. Renderer

- перенести визуальную систему `prototype 2` в reusable template;
- реализовать библиотеку screen components;
- добавить интерактивную навигацию;
- добавить локализацию и theme tokens.

### Этап 3. Pipeline

- создавать `publicId` и URL;
- подключить HTML renderer к общей модели;
- сохранить candidate и final artifacts;
- расширить API response.

### Этап 4. PDF

- добавить footer на все страницы;
- добавить телефонную иконку и ссылку;
- добавить проверку URI annotations.

### Этап 5. Публикация и безопасность

- добавить публичный read-only endpoint;
- проверить `publicId` и path traversal;
- добавить security headers;
- согласовать production storage и retention.

### Этап 6. QA

- contract QA;
- DOM QA;
- navigation QA;
- PDF link QA;
- smoke test полного pipeline.

## 23. Критерии готовности

Функциональность считается готовой, когда:

1. Один API-запрос создаёт PDF и HTML-прототип.
2. Оба артефакта используют одну proposal/semantic model.
3. Состав экранов зависит от типа, ролей, scope и процессов проекта.
4. HTML визуально использует систему `prototype 2`.
5. HTML содержит рабочую навигацию и основной пользовательский flow.
6. PDF содержит одну и ту же кликабельную ссылку на каждой странице.
7. Публичный URL открывает нужный HTML после завершения запроса.
8. HTML и PDF проходят обязательный QA.
9. API возвращает сведения об обоих артефактах.
10. Retention не создаёт битых ссылок из PDF.

## 24. Решения первой версии

- Генератор PDF и HTML остаётся в одном репозитории.
- Используется фиксированный безопасный HTML renderer.
- Модель создаёт только структурированный `appPrototypeSpec`.
- Экраны выбираются динамически по логике проекта.
- Первая версия поддерживает до 16 экранов.
- Публичный URL создаётся до PDF render.
- Готовность запроса требует успешного PDF и HTML QA.
- Произвольный генерируемый JavaScript запрещён.
