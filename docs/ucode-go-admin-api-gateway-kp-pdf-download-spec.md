# Спецификация: постоянный URL preview и скачивание PDF коммерческого предложения через API Gateway

## 1. Цель

Добавить в `ucode_go_admin_api_gateway` защищённые endpoints для повторного открытия preview и скачивания PDF, созданного `kp-generator-agent`.

После изменения:

- preview открывается на отдельном frontend URL `/kp/{requestId}`, а не на `about:blank`;
- URL можно обновить или открыть повторно, и frontend заново получает данные КП по `requestId`;
- кнопка `Сохранить PDF` скачивает исходный многостраничный PDF генератора, а не печатает HTML-preview через браузер.

## 2. Репозитории и ответственность

- Frontend: `professio_app_69f844`.
- API Gateway, который нужно изменить: `ucode_go_admin_api_gateway`.
- Сервис генерации: `kp-generator-agent`.

Изменения для этой задачи должны быть реализованы в `ucode_go_admin_api_gateway`. Frontend использует канонические endpoints:

```http
GET /v1/kp-proposals/{requestId}
GET /v1/kp-proposals/{requestId}/html
GET /v1/kp-proposals/{requestId}/pdf
```

## 3. Текущая проблема

Генерация работает:

```http
POST /v1/kp-proposals
```

Gateway вызывает агент:

```http
POST {KP_AGENT_URL}/v1/proposals
```

Агент создаёт PDF и умеет отдавать его через защищённый endpoint:

```http
GET {KP_AGENT_URL}/v1/proposals/{requestId}/pdf
Authorization: Bearer {KP_AGENT_API_KEY}
```

Но в gateway сейчас отсутствуют маршруты чтения результата и скачивания PDF. Поэтому обновление `/kp/{requestId}` и кнопка скачивания получают `404 Not Found`.

Браузер не должен обращаться к `kp-generator-agent` напрямую, поскольку для этого пришлось бы раскрыть `KP_AGENT_API_KEY`.

## 4. Требуемый поток

```text
Professio frontend
    │
    │ POST /v1/kp-proposals
    ▼
ucode_go_admin_api_gateway
    │
    │ POST {KP_AGENT_URL}/v1/proposals
    │ Authorization: Bearer {KP_AGENT_API_KEY}
    ▼
kp-generator-agent
    │
    │ requestId + HTML + generated PDF
    ▼
Gateway сохраняет owner + metadata + HTML и возвращает requestId + htmlUrl + pdfUrl

Frontend открывает /kp/{requestId}
    │
    │ GET /v1/kp-proposals/{requestId}
    │ GET /v1/kp-proposals/{requestId}/html
    ▼
Gateway проверяет авторизацию и возвращает сохранённые metadata + HTML

Пользователь нажимает «Сохранить PDF»
    │
    │ GET /v1/kp-proposals/{requestId}/pdf
    ▼
Gateway проверяет авторизацию и владельца requestId
    │
    │ GET {KP_AGENT_URL}/v1/proposals/{requestId}/pdf
    │ Authorization: Bearer {KP_AGENT_API_KEY}
    ▼
Gateway потоково возвращает application/pdf браузеру
```

## 5. Изменения API Gateway

### 5.1. Зарегистрировать маршрут

Маршрут должен находиться внутри существующей группы `/v1`, защищённой `AuthMiddleware`:

```go
v1.GET("/kp-proposals/:requestId", h.V1.GetKpProposal)
v1.GET("/kp-proposals/:requestId/html", h.V1.GetKpProposalHTML)
v1.GET("/kp-proposals/:requestId/pdf", h.V1.DownloadKpProposalPDF)
```

Ожидаемый файл регистрации:

```text
api/api.go
```

### 5.2. Сохранить результат и вернуть канонические URL после генерации

Успешный ответ `POST /v1/kp-proposals` должен содержать:

```json
{
  "ok": true,
  "status": "completed",
  "requestId": "KP-20260804-D6BE339096AF",
  "title": "SaaS-платформа",
  "html": "<!doctype html>...",
  "htmlUrl": "/v1/kp-proposals/KP-20260804-D6BE339096AF/html",
  "pdfUrl": "/v1/kp-proposals/KP-20260804-D6BE339096AF/pdf",
  "pageCount": 11,
  "prototype": {
    "url": "https://..."
  }
}
```

`htmlUrl` и `pdfUrl` должны указывать на gateway, а не на внутренний `/v1/proposals/...` агента или локальный filesystem path.

После успешного ответа агента gateway должен сохранить результат до отправки ответа клиенту. Минимальная запись:

```text
requestId
projectId
environmentId
status
title
pageCount
qaStatus
prototype public URL + screenCount + rendererVersion
generated HTML или ссылка на HTML в object storage
createdAt
expiresAt
```

Запись владельца и артефактов должна быть атомарной с точки зрения последующих `GET`: после успешного `POST` маршрут `GET /v1/kp-proposals/{requestId}` не должен возвращать `404`.

Ожидаемый файл:

```text
api/handlers/v1/kp_proposals.go
```

### 5.3. Реализовать metadata endpoint для постоянного preview URL

```http
GET /v1/kp-proposals/{requestId}
```

Успешный JSON-ответ:

```json
{
  "ok": true,
  "status": "completed",
  "requestId": "KP-20260804-D6BE339096AF",
  "title": "SaaS-платформа",
  "htmlUrl": "/v1/kp-proposals/KP-20260804-D6BE339096AF/html",
  "pdfUrl": "/v1/kp-proposals/KP-20260804-D6BE339096AF/pdf",
  "pageCount": 11,
  "qaStatus": "PASS",
  "prototype": {
    "url": "https://kp.example.com/p/public-id/",
    "qaStatus": "PASS",
    "screenCount": 12,
    "rendererVersion": "app-prototype-v2"
  }
}
```

Требования:

- endpoint защищён существующим `AuthMiddleware`;
- проверяется владелец `projectId + environmentId`;
- внутренние URL, service key и filesystem paths не возвращаются;
- для `pending`/`processing` возвращается текущее состояние с HTTP `200`, чтобы frontend мог polling;
- для `failed` возвращается `status: "failed"` и безопасное поле `error.message` без внутренних подробностей.

### 5.4. Реализовать HTML endpoint для preview

```http
GET /v1/kp-proposals/{requestId}/html
```

Успешный ответ:

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Cache-Control: private, no-store
X-Content-Type-Options: nosniff

<!doctype html>...
```

Тело должно содержать исходный HTML генератора без JSON envelope. Gateway не должен печатать HTML в PDF и не должен добавлять в него UI header Professio. Экранные улучшения preview — горизонтальный скролл для mindmap/user process и размещение телефона-прототипа в конце — выполняются frontend-кодом и не должны изменять серверный PDF.

### 5.5. Реализовать PDF proxy handler

Рекомендуемый отдельный файл:

```text
api/handlers/v1/kp_proposal_pdf.go
```

Handler `DownloadKpProposalPDF` должен:

1. Получить `requestId` из path parameter.
2. Проверить формат идентификатора.
3. Проверить доступ текущего project/environment к данному `requestId`.
4. Проверить, что `KP_AGENT_URL` настроен.
5. Выполнить запрос к агенту:

   ```http
   GET {KP_AGENT_URL}/v1/proposals/{requestId}/pdf
   Authorization: Bearer {KP_AGENT_API_KEY}
   ```

6. Не передавать пользовательский JWT агенту.
7. Не возвращать `KP_AGENT_API_KEY`, внутренний URL агента или filesystem path клиенту.
8. Потоково передать PDF клиенту без загрузки всего файла в память gateway.
9. Сохранить безопасные response headers агента:

   - `Content-Type`;
   - `Content-Length`;
   - `Content-Disposition`;
   - `Cache-Control`;
   - `X-Content-Type-Options`.

Рекомендуемый timeout запроса к агенту: 30 секунд.

### 5.6. Валидация `requestId`

Формат должен совпадать с контрактом агента:

```regex
^KP-[A-Za-z0-9_-]+$
```

Также следует ограничить максимальную длину, например 96 символами. Некорректный идентификатор нельзя подставлять во внутренний URL.

### 5.7. Авторизация и tenant isolation

Endpoint обязательно должен оставаться под существующим `AuthMiddleware`.

После успешной генерации gateway должен сохранить связь и metadata:

```text
requestId -> projectId + environmentId
```

При чтении metadata, HTML или PDF текущие `project_id` и `environment_id` из Gin context должны совпадать с владельцем артефакта. Для хранения можно использовать существующее durable-хранилище gateway; TTL должен соответствовать сроку доступности HTML и PDF. In-memory map допустим только для локальной разработки: он не обеспечивает refresh/share URL после рестарта или между репликами.

Знание `requestId` не является достаточной авторизацией.

## 6. Контракт endpoint скачивания

### Request

```http
GET /v1/kp-proposals/KP-20260804-D6BE339096AF/pdf
Authorization: Bearer {USER_ACCESS_TOKEN}
```

### Success response

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="SaaS-platform.pdf"; filename*=UTF-8''SaaS-%D0%BF%D0%BB%D0%B0%D1%82%D1%84%D0%BE%D1%80%D0%BC%D0%B0.pdf
Cache-Control: no-store
X-Content-Type-Options: nosniff

%PDF-...
```

Тело должно быть бинарным PDF без JSON envelope.

## 7. Ошибки

Рекомендуемый контракт:

| Ситуация | HTTP | Code |
|---|---:|---|
| Некорректный или неизвестный `requestId` | 404 | `KP_ARTIFACT_NOT_FOUND` |
| Артефакт был удалён | 410 | `KP_ARTIFACT_GONE` |
| Нет доступа к чужому проекту/environment | 403 | `KP_ARTIFACT_FORBIDDEN` |
| `KP_AGENT_URL` не настроен | 503 | `KP_AGENT_UNAVAILABLE` |
| Агент недоступен или timeout | 502 | `KP_AGENT_UNAVAILABLE` |
| Агент отклонил service API key | 502 | `KP_AGENT_AUTH_FAILED` |
| Агент вернул успешный ответ не в формате PDF | 502 | `KP_ARTIFACT_INVALID` |

Ошибки `401/403` от внутреннего агента нельзя пробрасывать как пользовательский `401`, иначе frontend может ошибочно завершить пользовательскую сессию.

Пример JSON-ошибки:

```json
{
  "ok": false,
  "error": {
    "code": "KP_ARTIFACT_NOT_FOUND",
    "message": "PDF artifact not found"
  }
}
```

## 8. Конфигурация

Gateway использует существующие переменные:

```env
KP_AGENT_URL=http://kp-generator-agent:8787
KP_AGENT_API_KEY=service-secret
```

Новые frontend environment variables и передача service key в браузер не требуются.

## 9. Тесты

Добавить unit-тесты минимум для следующих сценариев.

### `POST /v1/kp-proposals`

- успешный ответ содержит канонический `pdfUrl`;
- успешный ответ содержит канонический `htmlUrl`;
- результат и owner record доступны через `GET` до отправки успешного ответа `POST`;
- `pdfUrl` не содержит внутренний host агента;
- `pdfUrl` не содержит filesystem path.

### `GET /v1/kp-proposals/:requestId`

- возвращаются metadata сохранённого КП и канонические `htmlUrl`/`pdfUrl`;
- refresh того же URL после завершения `POST` возвращает `200`;
- внутренний host агента, service key и filesystem paths отсутствуют;
- запрос чужого project/environment возвращает `403`;
- неизвестный или истёкший `requestId` корректно преобразуется в `404`/`410`.

### `GET /v1/kp-proposals/:requestId/html`

- возвращается исходный HTML без JSON envelope;
- `Content-Type` равен `text/html; charset=utf-8`;
- HTML не обрезается для больших многостраничных КП;
- запрос чужого project/environment возвращает `403`;
- неизвестный или истёкший артефакт корректно преобразуется в `404`/`410`.

### `GET /v1/kp-proposals/:requestId/pdf`

- gateway обращается к `/v1/proposals/{requestId}/pdf` агента;
- gateway передаёт `Authorization: Bearer {KP_AGENT_API_KEY}`;
- пользовательский JWT не передаётся агенту;
- тело PDF передаётся без изменений;
- сохраняются `Content-Type` и `Content-Disposition`;
- некорректный `requestId` отклоняется без запроса к агенту;
- запрос чужого project/environment возвращает `403`;
- upstream `404` и `410` корректно преобразуются;
- upstream `401/403` преобразуется в `502 KP_AGENT_AUTH_FAILED`;
- timeout/connection error возвращает `502`.

Рекомендуемые команды проверки:

```bash
go test ./api/handlers/v1 -run 'Test.*KpProposal' -count=1
go test ./api/handlers/v1 -count=1
go build ./...
```

## 10. Интеграционная проверка

1. Запустить gateway с корректными `KP_AGENT_URL` и `KP_AGENT_API_KEY`.
2. Выполнить `POST /v1/kp-proposals` с пользовательской авторизацией.
3. Убедиться, что ответ содержит `requestId`, `htmlUrl`, `pdfUrl` и `pageCount > 1` для многостраничного КП.
4. Открыть frontend URL `/kp/{requestId}`, обновить страницу и убедиться, что preview повторно загружается через metadata/HTML endpoints, а адресная строка не содержит `about:blank` или `blob:`.
5. Выполнить `GET` по возвращённому `pdfUrl` с той же пользовательской авторизацией.
6. Проверить:

   ```text
   HTTP status = 200
   Content-Type = application/pdf
   первые пять байт = %PDF-
   фактическое количество страниц = pageCount из POST response
   PDF не содержит header preview-страницы и about:blank footer
   ```

7. Повторить скачивание из Professio через кнопку `Сохранить PDF`.

## 11. Критерии приёмки

- Кнопка `Сохранить PDF` скачивает файл без `404`.
- Preview открывается на `/kp/{requestId}`, а не на `about:blank`.
- После browser refresh `/kp/{requestId}` снова показывает то же КП.
- Metadata и HTML недоступны пользователю другого project/environment.
- Скачивается серверный PDF генератора, а не browser print HTML-preview.
- Количество страниц совпадает с `pageCount`.
- Верстка PDF совпадает с PDF, созданным `kp-generator-agent`.
- В ответ не попадают UI header preview, `about:blank`, дата печати браузера и кнопки Professio.
- `KP_AGENT_API_KEY` не доступен frontend-коду и браузерной сети как request credential к агенту.
- Пользователь не может скачать PDF другого project/environment.
- `go test ./api/handlers/v1` и `go build ./...` проходят.

## 12. Ограничение текущего агента

Сейчас `kp-generator-agent` регистрирует PDF в памяти процесса. При рестарте агента или при нескольких репликах без sticky routing/shared storage ранее созданный `requestId` может вернуть `404`.

Gateway обязан хранить metadata и HTML устойчиво, иначе постоянный preview URL не будет работать после рестарта/между репликами. Для PDF в текущем синхронном сценарии требуется либо одна реплика агента, либо гарантированная маршрутизация к создавшей артефакт реплике. Целевой вариант — persistent object storage для HTML и PDF с tenant metadata в durable storage.
