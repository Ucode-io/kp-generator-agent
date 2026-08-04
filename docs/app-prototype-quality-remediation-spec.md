# План-спецификация повышения качества интерактивного HTML-прототипа

## 1. Статус документа

- Статус: Proposed
- Версия: 1.0
- Репозиторий: `kp-generator-agent`
- Базовая спецификация: `docs/app-prototype-generation-spec.md`
- Визуальный и поведенческий референс: `/Users/nurmuhammad/Downloads/prototype 2/index.html`
- Аудируемый результат: `/Users/nurmuhammad/Downloads/prototype 2/Заказной программный проект · Интерактивный прототип.html`
- Назначение: зафиксировать разрыв между текущей реализацией и целевым качеством, а также определить план исправления

## 2. Краткое решение

Текущий генератор создаёт визуально консистентный каталог экранов, но не полноценный интерактивный прототип продукта. Для исправления необходимо изменить четыре уровня системы:

1. `App Prototype Planner` должен строить экраны из ролей, функций, процессов, состояний и интеграций конкретного проекта, а не из фиксированного каталога.
2. `appPrototypeSpec` должен описывать не только переходы, но и типизированные взаимодействия, локальные состояния, формы, варианты и результаты действий.
3. `HTML Prototype Renderer` должен исполнять эти взаимодействия: изменять данные табов, открывать dialog/sheet, валидировать формы, переключать состояния и поддерживать ветвящиеся сценарии.
4. QA должен проверять предметную обоснованность, структурную вариативность и фактический эффект каждого интерактивного элемента, а не только наличие разных текстов и валидных target ID.

Изменение CSS без пересмотра planner, контракта, renderer и QA не решит проблему.

## 3. Контекст и результаты аудита

Оба проверенных HTML-файла содержат по 55 внутренних экранов. Одинаковое количество не означает одинаковое качество.

| Показатель | Референс | Текущий результат |
|---|---:|---:|
| Внутренние экраны | 55 | 55 |
| Элементы с явным обработчиком клика | 249 | 54 основных CTA |
| Переходы между экранами | 206 | 54 |
| Bottom sheet / modal interactions | 14 | 0 |
| Локальные изменения состояния | 30 | только смена CSS-класса таба |
| Поля ввода | 7 редактируемых | 21, все `readonly` |
| Кнопки табов | контекстные | 54, контент не меняется |
| Визуальные toggle controls | работают | 9 без обработчиков |
| Активные кнопки без результата | 18 | 11 плюс псевдоконтролы |

### 3.1. Что работает в референсе

Референс моделирует предметные пользовательские сценарии:

- onboarding со слайдами и выбором языка;
- регистрация, OTP, MyID и ручной KYC fallback;
- разные состояния главного экрана;
- карты, переводы и обработка неизвестного статуса операции;
- платежи, ЖКХ, автоплатежи и QR;
- маркетплейс, каталог, фильтры, товар, checkout и заказ;
- запрос лимита, скоринг, одобрение и отказ;
- рассрочки, график платежей и погашение;
- документы с preview sheet;
- настройки уведомлений;
- offline, error, empty, update и blocked states.

Композиция, доступные действия и навигация меняются в зависимости от задачи экрана.

### 3.2. Что делает текущий результат

Текущий результат строит две линейные цепочки.

Цепочка авторизации и общих экранов:

```text
onboarding
  → language
  → login
  → login_otp
  → password_reset
  → password_reset_done
  → notifications
  → notification_settings
  → global_search
  → search_results
  → profile
  → profile_edit
  → security
  → design_system
```

Цепочка business-app:

```text
dashboard
  → activity_feed
  → quick_create
  → workspace
  → workspace_filters
  → workspace_empty
  → details
  → details_history
  → details_documents
  → form
  → form_review
  → workflow
  → workflow_queue
  → workflow_details
  → workflow_approval
  → workflow_rejected
  → workflow_success
  → tasks
  → task_details
  → task_create
  → calendar
  → clients
  → client_details
  → client_create
  → client_history
  → documents
  → document_details
  → history
  → analytics
  → reports
  → report_details
  → team
  → user_details
  → roles
  → permissions
  → integrations
  → integration_details
  → admin_workspace
  → audit_log
  → settings
  → help
  → onboarding
```

Основная CTA на каждом экране открывает следующий элемент массива независимо от пользовательского смысла.

### 3.3. Повторяемость UI

После исключения текстовых значений найдено 29 DOM-компоновок. При этом 11 повторяющихся шаблонов обслуживают 37 из 55 экранов:

- один timeline используется для уведомлений, activity feed, историй и audit log;
- одна readonly-форма используется для password reset, profile edit, form, task create и client create;
- один generic list используется для search results, workspace, tasks, clients и help;
- одна details-card используется для details, workflow details, task details и document details;
- один profile-layout используется для profile, team и user details;
- один settings-layout используется для security, roles и settings;
- один analytics-layout используется для analytics, reports и report details;
- success, document list, stepper и некоторые другие шаблоны также повторяются без предметного поведения.

Повторное использование компонентов допустимо. Недопустимо, когда смысл экрана меняется только через `title`, `description`, псевдослучайные метрики и строки `Название / Статус / Далее`.

### 3.4. Примеры некорректного содержания

- `language` показывает «Язык», «Статус», «Далее» вместо языков.
- `login` отображает описание, статус и технический ID вместо credentials.
- `login_otp` выводит буквы текста описания вместо цифр кода.
- `global_search` не содержит редактируемого search input.
- формы содержат только описание, статус и ID.
- `notification_settings` и `security` не позволяют менять настройки.
- workflow steps генерируются как `Старт / Статус / Готово`.
- document menu buttons `•••` ничего не делают.
- dashboard и reports используют синтетические числа без бизнес-смысла.
- onboarding содержит сырой текст задания на создание КП вместо ценности продукта.

## 4. Причины в текущей реализации

### 4.1. Фиксированный минимальный объём

`MIN_SCREEN_COUNT = 48` заставляет planner дополнять компактные продукты лишними экранами. Требуемое количество должно определяться пользовательскими процессами, а не глобальной нижней границей.

### 4.2. Generic business-app catalog

Если семейство продукта определяется как `business-app`, planner возвращает заранее заданный каталог общих экранов. Каталог не строится из конкретного scope проекта.

### 4.3. Механическое соединение действий

`connectScreenActions()` заменяет основное действие каждого экрана переходом на следующий экран массива. В результате:

- отсутствуют ветвления;
- CTA не соответствует объекту действия;
- success/error states выбираются не по результату;
- screen order становится business logic;
- циклы возникают автоматически.

### 4.4. Semantic content почти не используется

Реальные scope/task items используются главным образом в onboarding. Большинство экранов получает generic rows из `contextualItems()` и generic fields из `contextualFields()`.

### 4.5. Renderer не исполняет предметные действия

Runtime обрабатывает только:

- `data-action-target` как navigation;
- sidebar и bottom navigation;
- back stack;
- смену активного CSS-класса tab.

В runtime отсутствуют typed handlers для submit, validation, filter, search, select, toggle, dialog, sheet, optimistic state, async result и conditional navigation.

### 4.6. QA проверяет текстовую, а не поведенческую уникальность

Текущий DOM QA формирует signature по `textContent`. Замена title делает два структурно одинаковых экрана «уникальными». QA также не проверяет, изменился ли DOM после клика по tab, toggle или action-looking element.

## 5. Область изменений

### 5.1. В scope

- правила выбора состава экранов;
- контракт `appPrototypeSpec`;
- модель действий и состояний;
- библиотека screen layouts и components;
- renderer runtime;
- planner grounding;
- contract, semantic, behavioral и visual QA;
- unit, integration и end-to-end tests;
- версионирование и rollout новой генерации.

### 5.2. Не входит в scope

- создание production backend для демонстрируемого продукта;
- реальные платежи, отправка OTP или интеграция с MyID;
- хранение настоящих пользовательских данных;
- выполнение произвольного JavaScript, созданного моделью;
- полное pixel-perfect копирование предметной области BNPL;
- обязательное воспроизведение всех 55 экранов референса.

Референс задаёт ожидаемую глубину сценариев и UI-подход, но конкретный продукт должен иметь собственную информационную архитектуру.

## 6. Целевые принципы

### 6.1. Сначала пользовательские процессы, затем экраны

Planner сначала определяет:

1. роли;
2. цели ролей;
3. объекты предметной области;
4. главные процессы;
5. шаги и решения;
6. success, empty, error и permission states;
7. только после этого — необходимые экраны.

### 6.2. Количество экранов не является KPI

- Минимальное количество не задаётся глобальной константой.
- Рекомендуемый диапазон: 6–16 экранов для первой версии.
- Более 16 экранов допускается только при наличии нескольких обоснованных ролей или процессов.
- Каждый экран должен иметь `sourceRefs` или явно описанную derivation rule.
- Экран без собственного пользовательского намерения удаляется или объединяется с другим.

### 6.3. Общие компоненты, предметные композиции

Повторное использование button, card, list row, field и badge обязательно. Повторение полного экрана допустимо только если два экрана действительно представляют один pattern с разными данными.

Недопустимые варианты:

- form, в которой меняются только title и ID;
- details screen без предметных атрибутов объекта;
- report без осей, показателей или фильтров из модели;
- settings screen, где toggle не изменяет состояние;
- list screen, где строки не открываются и не фильтруются.

### 6.4. Любой интерактивный affordance имеет эффект

Если элемент визуально выглядит интерактивным, он обязан:

- выполнить действие;
- изменить состояние;
- открыть дополнительный UI;
- перейти на другой экран;
- либо быть явно `disabled` с объяснением.

Silent no-op запрещён.

### 6.5. Данные grounded по проекту

Контент экрана формируется из:

1. подтверждённых scope items;
2. процессов и состояний semantic model;
3. ролей и permissions;
4. интеграций;
5. безопасных demo values, соответствующих типу продукта.

Generic placeholders `Название / Статус / Далее`, raw prompt и внутренние IDs не должны попадать в клиентский HTML.

## 7. Целевая модель планирования

### 7.1. Промежуточная domain model

Перед построением экранов planner должен сформировать нормализованную модель:

```json
{
  "roles": [],
  "entities": [],
  "capabilities": [],
  "flows": [],
  "states": [],
  "integrations": [],
  "navigationCandidates": [],
  "sourceRefs": []
}
```

### 7.2. Модель пользовательского процесса

```json
{
  "id": "create-order",
  "title": "Оформление заказа",
  "actorRoleId": "buyer",
  "entryScreenId": "catalog",
  "successScreenIds": ["order-success"],
  "errorScreenIds": ["payment-error"],
  "steps": [
    {
      "id": "select-product",
      "intent": "Выбрать товар",
      "entityId": "product",
      "requiredState": "available"
    }
  ],
  "sourceRefs": ["PROCESS-002", "SCOPE-014"]
}
```

### 7.3. Правила включения экрана

Экран включается, если выполнено хотя бы одно условие:

- представляет entry point роли;
- необходим для шага основного процесса;
- отображает отдельное значимое состояние объекта;
- содержит самостоятельное пользовательское решение;
- необходим для обязательной интеграции;
- является outcome screen процесса;
- требуется для admin/operator role, явно присутствующей в scope.

Экран не включается только ради достижения количества.

### 7.4. Дедупликация экранов

Planner должен объединять экраны, если совпадают:

- actor role;
- primary intent;
- entity type;
- основные поля;
- доступные actions;
- state semantics.

Разные состояния одной сущности могут быть представлены:

- одним экраном с variants;
- отдельными экранами, если существенно меняются layout и доступные действия.

## 8. Расширение контракта `appPrototypeSpec`

### 8.1. Версия

Новая функциональность должна выпускаться как обратно несовместимая версия контракта, например `schemaVersion: "2.0"`.

### 8.2. Экран

```json
{
  "id": "transfer-confirm",
  "type": "confirmation",
  "title": "Подтверждение перевода",
  "description": "Проверка получателя и суммы",
  "roleIds": ["customer"],
  "sourceRefs": ["PROCESS-TRANSFER", "SCOPE-P2P"],
  "entityRef": "transfer",
  "variant": "ready",
  "layout": "transaction-confirmation",
  "content": {},
  "actions": [],
  "localState": {},
  "navigation": {}
}
```

### 8.3. Типизированные действия

`actions` должны быть discriminated union, а не только ссылкой на следующий экран.

Поддерживаемые типы первой версии:

- `navigate`;
- `back`;
- `open_sheet`;
- `open_dialog`;
- `close_overlay`;
- `select`;
- `toggle`;
- `set_value`;
- `set_tab`;
- `submit`;
- `branch`;
- `reset`;
- `copy_demo`.

Пример:

```json
{
  "id": "confirm-transfer",
  "type": "submit",
  "label": "Подтвердить перевод",
  "formId": "transfer-confirmation",
  "pendingState": "processing",
  "outcomes": [
    {
      "when": "demo-success",
      "targetScreenId": "transfer-success"
    },
    {
      "when": "demo-timeout",
      "targetScreenId": "transfer-pending"
    }
  ]
}
```

### 8.4. Типизированный контент

`content` должен зависеть от `layout` или `type` и валидироваться отдельной JSON Schema веткой.

Примеры:

- `form`: fields, validation, submit action;
- `list`: rows, filters, empty variant, row action;
- `details`: sections, attributes, related actions;
- `settings`: settings items и toggle action;
- `analytics`: metrics, dimensions, series и filter action;
- `stepper`: steps, current step и allowed transitions;
- `document_list`: documents и preview/download actions;
- `search`: query state, result groups и clear action.

### 8.5. Локальное состояние

```json
{
  "localState": {
    "activeTab": "overview",
    "selectedPeriod": "12m",
    "favorite": false,
    "form": {
      "amount": "250000"
    }
  }
}
```

Runtime state является демонстрационным и хранится только внутри страницы.

### 8.6. Варианты и состояния

Экран может определять variants:

```json
{
  "variants": [
    { "id": "loading", "trigger": "demo-loading" },
    { "id": "empty", "trigger": "demo-empty" },
    { "id": "error", "trigger": "demo-error" },
    { "id": "ready", "trigger": "default" }
  ]
}
```

Для каждого variant должны быть определены content overrides и доступные actions.

## 9. Требования к основным типам экранов

### 9.1. Onboarding

- показывает ценность и возможности конкретного продукта;
- не содержит raw prompt;
- поддерживает шаги или слайды, если их больше одного;
- имеет явные действия start, login или skip только при наличии соответствующих flows.

### 9.2. Login и OTP

- login содержит реальные demo credential fields;
- поля не должны быть `readonly`, если пользователь должен их вводить;
- OTP содержит цифровые demo-boxes или input;
- resend timer изменяется либо явно обозначается как статичный demo;
- success и invalid-code variants должны быть различимы.

### 9.3. Lists и workspace

- каждая строка представляет предметную сущность;
- row click открывает details или выполняет явное действие;
- tabs и filters изменяют видимый набор данных;
- empty state связан с результатом фильтра или отсутствием записей;
- list не должен состоять из строк `Название / Статус / Далее`.

### 9.4. Details

- показывает атрибуты конкретной сущности;
- содержит primary и secondary actions, допустимые в текущем state;
- связанные данные открываются через tabs, sections, sheets или отдельные экраны;
- технический ID показывается только если он нужен пользователю.

### 9.5. Forms

- поля соответствуют операции и entity schema;
- обязательность и validation описаны в spec;
- пользователь может менять значения;
- submit меняет state или выполняет navigation по outcome;
- review screen создаётся только при наличии значимого подтверждения.

### 9.6. Search

- query редактируется;
- clear очищает значение;
- results зависят от query хотя бы на demo dataset;
- result click открывает соответствующий объект;
- поддерживается empty-result state.

### 9.7. Settings

- toggle действительно меняет состояние;
- locked setting визуально disabled и содержит объяснение;
- табы меняют группу настроек;
- save action создаётся только при batch-save semantics.

### 9.8. Workflow и stepper

- шаги берутся из semantic process;
- current step соответствует демонстрируемому state;
- approve, reject, return и retry являются разными actions;
- success/error outcome определяется переходом, а не позицией экрана.

### 9.9. Analytics и reports

- метрики связаны с capability или process проекта;
- label, value, unit и period согласованы;
- chart series имеет понятные категории или время;
- filter/tab изменяет данные;
- псевдослучайные показатели, вычисленные из ID экрана, запрещены.

### 9.10. Documents

- row action открывает preview sheet или details;
- menu `•••` открывает список доступных действий;
- download/copy может быть безопасной demo-операцией;
- тип, размер, статус и дата соответствуют типу документа.

### 9.11. Success, error, empty и pending states

- outcome объясняет результат предыдущего действия;
- CTA ведёт в логически следующий раздел;
- retry повторяет соответствующее действие;
- error state не должен автоматически следовать после approval только из-за порядка массива;
- disabled action содержит видимое объяснение.

## 10. Требования к renderer runtime

### 10.1. Action dispatcher

Renderer должен иметь единый безопасный dispatcher:

```text
DOM event
  → resolve action ID
  → validate action against embedded runtime spec
  → apply state mutation
  → render affected component or screen
  → optionally navigate
  → record demo event for QA
```

Произвольный JavaScript из модели не допускается.

### 10.2. Navigation

- sidebar открывает любой экран;
- bottom navigation содержит только primary destinations текущей роли;
- app back использует prototype history stack;
- browser hash соответствует активному экрану;
- browser Back/Forward не должен покидать прототип при наличии внутренней истории;
- role-specific screens не должны попадать в mobile navigation другой роли.

### 10.3. Tabs

Клик по tab обязан:

- изменить `activeTab`;
- изменить связанный content или dataset;
- сохранить доступность через `aria-selected`;
- не быть только визуальным переключением класса.

### 10.4. Forms

- editable fields используют `input`, `select`, `textarea` или безопасный custom control;
- runtime поддерживает required, pattern, min/max и cross-field validation;
- ошибки отображаются возле поля;
- submit блокируется при invalid state;
- demo submission не отправляет данные во внешнюю сеть.

### 10.5. Overlays

- bottom sheet и dialog создаются из spec-defined component data;
- overlay закрывается по explicit action, backdrop и Escape;
- focus остаётся внутри dialog;
- после закрытия focus возвращается на trigger.

### 10.6. State persistence

- локальные изменения сохраняются между переходами в рамках текущей сессии;
- hard reload может возвращать default demo state;
- persistence не должен использовать персональные данные;
- state reset доступен для QA и повторного прохождения flow.

## 11. Требования к shell и UI

### 11.1. Контекстная оболочка

Глобальные элементы показываются по назначению экрана:

- onboarding/login могут не иметь bottom navigation;
- success/error могут иметь упрощённый app bar;
- admin screens используют navigation своей роли;
- avatar скрывается там, где он не является действием;
- back button скрывается на root destination.

### 11.2. Композиционная вариативность

Для каждого основного intent должен существовать подходящий layout:

- discovery;
- list/workspace;
- details;
- edit/create;
- confirmation;
- progress;
- result;
- analytics;
- configuration.

Layout выбирается по intent и data shape, а не только по строковому `screen.type`.

### 11.3. Дизайн-система

Общие tokens и components остаются едиными:

- typography;
- colors;
- spacing;
- radii;
- button hierarchy;
- status colors;
- cards;
- fields;
- sheets/dialogs;
- navigation.

Визуальная консистентность не должна приводить к одинаковой структуре всех экранов.

## 12. QA-стратегия

### 12.1. Contract QA

Проверяется:

- JSON Schema v2;
- уникальность screen/action/state IDs;
- валидность target screen и target state;
- соответствие content schema выбранному layout;
- наличие action handler для каждого interactive component;
- отсутствие недостижимых обязательных outcome screens;
- отсутствие беспричинных циклов;
- наличие sourceRefs.

### 12.2. Grounding QA

Для каждого non-system screen:

- существует подтверждённый intent;
- title и core content связаны со scope/process/entity;
- поля формы соответствуют операции;
- метрики имеют business meaning;
- screen не является generic filler.

Blocker findings:

- raw prompt в UI;
- `Название / Статус / Далее` как основной content;
- технический ID вместо пользовательского значения;
- экран без sourceRefs/derivation;
- случайные метрики без metric definition.

### 12.3. Structural QA

DOM signature строится без:

- текста;
- значений атрибутов контента;
- screen ID;
- active/selected state classes.

QA должен выявлять:

- одинаковую структуру у экранов с разными intent;
- чрезмерное использование одного full-screen template;
- одинаковые form field sets у несвязанных операций;
- одинаковые list rows у разных entities.

Повтор структуры не является автоматической ошибкой. Ошибка создаётся, когда совпадает структура, но различаются intent/data shape/actions.

### 12.4. Behavioral QA

Playwright должен пройти каждый интерактивный элемент и сравнить состояние до/после клика.

Допустимый эффект:

- активный экран изменился;
- hash изменился;
- overlay открылся/закрылся;
- field value изменился;
- validation message изменился;
- active tab и связанный content изменились;
- toggle state изменился;
- selected item изменился;
- disabled control остался disabled и имеет explanation.

Если ни один наблюдаемый эффект не произошёл, finding получает код `APP_PROTOTYPE_INTERACTION_NO_EFFECT`.

### 12.5. Flow QA

Для каждого flow:

- entry screen достижим из navigation или предыдущего flow;
- happy path достигает success outcome;
- обязательная развилка имеет минимум два различных outcome;
- back возвращает на предыдущий контекст;
- retry возвращает к соответствующей операции;
- CTA label соответствует эффекту.

Пример запрещённой последовательности:

```text
approval → rejected → success
```

если переходы определены только порядком массива, а не действиями пользователя.

### 12.6. Visual QA

- screenshot каждого screen/variant;
- проверка overflow и clipping;
- проверка overlay stacking;
- проверка disabled/active/focus states;
- desktop shell и mobile viewport;
- отсутствие неподходящей bottom navigation на auth/result screens;
- сравнение representative screens с design baseline.

### 12.7. Accessibility QA

- интерактивные элементы доступны с клавиатуры;
- `button` используется вместо кликабельного `div`;
- tabs имеют `role=tab`, `aria-selected` и связанный panel;
- dialog имеет `role=dialog` и accessible name;
- inputs имеют labels;
- focus state видим;
- disabled state доступен assistive technologies.

## 13. Обязательные acceptance criteria

### 13.1. Состав экранов

1. Нет глобального `MIN_SCREEN_COUNT`, заставляющего добавлять filler screens.
2. Каждый экран связан с intent и sourceRefs либо прозрачной derivation rule.
3. Generic business-app catalog не используется как готовый результат.
4. Главный пользовательский процесс покрыт от entry до outcome.
5. Admin/operator screens создаются только при наличии соответствующей роли или scope.

### 13.2. Контент

1. Raw prompt не отображается в UI.
2. Generic rows `Название / Статус / Далее` не используются как основной content.
3. Формы содержат предметные поля.
4. Метрики имеют label, unit, period и source/derivation.
5. Тексты соответствуют локали проекта.

### 13.3. Интерактивность

1. 100% визуально интерактивных элементов имеют наблюдаемый эффект или явно disabled.
2. 100% action targets существуют.
3. Tabs меняют content, а не только подсветку.
4. Toggle controls меняют состояние.
5. Editable forms не рендерятся как `readonly`.
6. Search, filters и selections влияют на demo dataset/state.
7. Основной flow содержит хотя бы одну предметную interaction кроме navigation, если это предусмотрено scope.

### 13.4. QA

1. Contract, grounding, structural, behavioral, flow, visual и accessibility QA завершились без blocker findings.
2. Каждый screen и declared variant был открыт в Playwright.
3. Каждый declared action был выполнен минимум один раз.
4. No-op interaction count равен нулю, кроме явно разрешённых `demo_external` actions.
5. В HTML отсутствуют console errors, локальные paths и секреты.

## 14. Изменения по файлам

### 14.1. `schemas/kp/app-prototype-spec-v1.schema.json`

- создать schema v2 либо новую schema рядом с v1;
- добавить discriminated action types;
- добавить typed content schemas;
- добавить local state, variants и flow references;
- сохранить чтение v1 только для ранее созданных артефактов.

### 14.2. `scripts/kp_app_prototype_planner.mjs`

- удалить принудительное дополнение до 48 экранов;
- заменить `businessScreens()` на flow-driven planning;
- удалить `connectScreenActions()` в текущем виде;
- строить action graph из semantic processes;
- использовать semantic items на всех релевантных экранах;
- удалить псевдослучайные метрики по screen ID;
- добавить dedupe по intent/entity/actions;
- добавить reason/sourceRefs для каждого выбранного screen.

### 14.3. `scripts/kp_app_prototype_renderer.mjs`

- добавить action dispatcher;
- реализовать typed state mutations;
- реализовать tabs с panels;
- реализовать editable forms и validation;
- реализовать search/filter/select/toggle;
- реализовать sheet/dialog runtime;
- сделать shell context-aware;
- сохранить экранирование и запрет model-generated JS.

### 14.4. `scripts/kp_app_prototype_qa.mjs`

- заменить text-only uniqueness на structural/content/action signatures;
- добавить crawling всех declared actions;
- проверять before/after observable state;
- добавить dead-control detection;
- добавить flow traversal;
- добавить role/navigation validation;
- добавить representative screenshots и artifact report.

### 14.5. `test/unit.mjs`

Добавить unit tests для:

- screen inclusion/exclusion;
- отсутствия filler screens;
- action graph generation;
- typed action validation;
- content grounding;
- screen deduplication;
- locale consistency;
- metric derivation;
- shell selection.

### 14.6. `test/smoke.mjs`

Добавить end-to-end scenarios минимум для:

- fintech/BNPL;
- ecommerce/marketplace;
- CRM;
- compact custom business app;
- проекта без auth;
- проекта с admin role;
- проекта с form validation и error outcome.

## 15. План реализации

### Этап 0. Зафиксировать regression baseline

- сохранить два аудируемых HTML как внешние fixtures или описать воспроизводимый input;
- добавить тест, который обнаруживает readonly generic forms;
- добавить тест, который обнаруживает no-op tabs/toggles;
- добавить тест, который запрещает последовательное соединение всех screens;
- зафиксировать текущие QA findings.

Результат этапа: текущая проблема воспроизводится автоматически.

### Этап 1. Контракт v2

- спроектировать action union;
- спроектировать typed screen content;
- добавить flow, variant и local state;
- реализовать schema validation;
- добавить migration/read compatibility для v1.

Результат этапа: planner и renderer могут обмениваться предметным поведением без произвольного JS.

### Этап 2. Flow-driven planner

- построить domain model;
- определить primary flows;
- выбирать screens по intent;
- строить ветвящийся action graph;
- удалить forced minimum;
- обеспечить grounding каждого screen.

Результат этапа: compact app создаёт компактный, но полный прототип; сложный продукт создаёт несколько обоснованных flows.

### Этап 3. Runtime interactions

- action dispatcher;
- state store;
- tabs/panels;
- forms/validation;
- toggles/selections;
- search/filters;
- dialogs/sheets;
- conditional outcomes.

Результат этапа: все controls имеют наблюдаемый эффект.

### Этап 4. Предметные layout families

- auth/onboarding;
- discovery/catalog;
- list/workspace;
- details;
- create/edit/review;
- confirmation/payment;
- workflow/progress;
- analytics/report;
- settings/permissions;
- result/system states.

Результат этапа: reuse происходит на уровне design system и pattern, а не копирования полного generic screen.

### Этап 5. Расширенный QA

- grounding QA;
- structural QA;
- behavioral crawler;
- flow traversal;
- accessibility checks;
- screenshot artifacts;
- новые blocker codes.

Результат этапа: title-only differences больше не позволяют пройти QA.

### Этап 6. Rollout

- добавить renderer/planner version в artifact record;
- включить v2 через feature flag;
- выполнить shadow generation на реальных обезличенных запросах;
- сравнить v1/v2 по QA и ручной оценке;
- постепенно перевести production на v2;
- сохранить возможность читать ранее опубликованные v1 artifacts.

## 16. Приоритеты backlog

### P0

- удалить forced screen count;
- прекратить последовательное соединение actions;
- добавить typed action contract;
- сделать forms editable;
- сделать tabs/toggles функциональными;
- добавить no-op interaction QA;
- запретить generic contextual rows как основной content.

### P1

- добавить sheets/dialogs;
- добавить variants и branching outcomes;
- сделать shell role- и screen-aware;
- добавить structural fingerprint QA;
- добавить grounding report;
- добавить browser Back/Forward integration.

### P2

- screenshot baseline по product families;
- расширенные animations;
- сохранение demo state между reloads;
- дополнительные component families;
- аналитика качества generation в production.

## 17. Метрики качества после rollout

Для каждого созданного прототипа сохраняются:

- количество screens и flows;
- доля screens с direct sourceRefs;
- количество actions по типам;
- количество branching points;
- количество interactive components;
- no-op interaction count;
- structural template distribution;
- generic content findings;
- flow coverage;
- QA status и codes;
- planner/renderer/schema versions.

Целевые значения:

- `noOpInteractionCount = 0`;
- `invalidActionTargetCount = 0`;
- `rawPromptLeakCount = 0`;
- `genericPrimaryContentCount = 0`;
- `declaredActionCoverage = 100%`;
- `requiredFlowOutcomeCoverage = 100%`;
- `nonSystemScreenGroundingCoverage = 100%`.

## 18. Новые коды QA

- `APP_PROTOTYPE_SCREEN_WITHOUT_INTENT`;
- `APP_PROTOTYPE_SCREEN_WITHOUT_SOURCE_REF`;
- `APP_PROTOTYPE_GENERIC_FILLER_SCREEN`;
- `APP_PROTOTYPE_GENERIC_PRIMARY_CONTENT`;
- `APP_PROTOTYPE_RAW_PROMPT_LEAK`;
- `APP_PROTOTYPE_METRIC_WITHOUT_DEFINITION`;
- `APP_PROTOTYPE_ACTION_GRAPH_LINEARIZED`;
- `APP_PROTOTYPE_ACTION_LABEL_EFFECT_MISMATCH`;
- `APP_PROTOTYPE_INTERACTION_NO_EFFECT`;
- `APP_PROTOTYPE_TAB_CONTENT_UNCHANGED`;
- `APP_PROTOTYPE_TOGGLE_STATE_UNCHANGED`;
- `APP_PROTOTYPE_FORM_NOT_EDITABLE`;
- `APP_PROTOTYPE_FLOW_OUTCOME_UNREACHABLE`;
- `APP_PROTOTYPE_ROLE_NAVIGATION_MISMATCH`;
- `APP_PROTOTYPE_STRUCTURAL_REPETITION`;

## 19. Definition of Done

Работа считается завершённой, когда:

1. Генерация текущего примера больше не создаёт фиксированный 55-screen business-app catalog.
2. Состав screens объясняется конкретными roles, scope items и processes.
3. Основной flow проходит от entry до success/error outcome через предметные действия.
4. Все tabs, toggles, forms, list rows, menus, sheets и CTA имеют эффект.
5. UI разных intent использует различающиеся композиции при общей design system.
6. В HTML отсутствуют raw prompt, generic rows и псевдослучайные метрики.
7. QA выполняет каждое declared action и обнаруживает no-op controls.
8. Fintech, marketplace, CRM и custom business app fixtures проходят новые tests.
9. `appPrototypeSpec` v2, planner, renderer и QA имеют независимые версии в artifact record.
10. Базовая спецификация `docs/app-prototype-generation-spec.md` обновлена после утверждения решений v2.

## 20. Открытые решения

До начала этапа 1 необходимо утвердить:

1. Будет ли schema v2 отдельным файлом или major update текущего schema path.
2. Какие action types обязательны в первой поставке.
3. Как model/planner описывает безопасные branch conditions без исполняемого кода.
4. Нужно ли сохранять demo state при reload.
5. Какой максимальный объём screens разрешён для multi-role проектов.
6. Какие product families входят в обязательный rollout набор.
7. Где хранить screenshots и behavioral trace QA.
8. Требуется ли ручное design approval перед production promotion.

