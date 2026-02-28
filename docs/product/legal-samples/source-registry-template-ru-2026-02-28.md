# Source Registry (Internal Template, RU)

Date: 2026-02-28  
Status: Internal working register

## 1. Назначение

`Source Registry` фиксирует для каждого источника:
1. что именно индексируется,
2. на каком основании,
3. кто одобрил,
4. какой текущий статус.

## 2. Статусы

1. `ACTIVE` — источник разрешен и используется.
2. `ACTIVE_CONDITIONAL` — источник используется, но есть условие/срок переподтверждения.
3. `PAUSED` — временно выключен.
4. `PENDING_APPROVAL` — ожидает подтверждения прав/разрешения.
5. `BLOCKED` — запрещен к индексации.

## 3. Шаблон таблицы

| source_id | source_type | source_name | source_ref | owner_or_admin | legal_basis | approval_evidence | approved_by | approved_at | review_due | status | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `src_a_author_channel` | `telegram_channel_public` | `[Author channel]` | `[link/@handle]` | `[owner/admin]` | `OWNED` | `[internal note/link]` | `[name]` | `YYYY-MM-DD` | `YYYY-MM-DD` | `ACTIVE` | `[notes]` |
| `src_b_travel_chat` | `telegram_chat_public` | `[Travel chat]` | `[link/@handle]` | `[owner/admin]` | `WRITTEN_ADMIN_PERMISSION` | `[email/msg link id]` | `[name]` | `YYYY-MM-DD` | `YYYY-MM-DD` | `ACTIVE_CONDITIONAL` | `[conditions]` |

## 4. Поля, обязательные к заполнению

1. `source_id`
2. `source_type`
3. `legal_basis`
4. `status`
5. `approved_at` (если статус `ACTIVE`/`ACTIVE_CONDITIONAL`)
6. `approval_evidence` (кроме `OWNED`, где можно internal reference)

## 5. Правило изменения статуса

1. `ACTIVE`/`ACTIVE_CONDITIONAL` -> `PAUSED`/`BLOCKED` при жалобе, истечении подтверждения или policy-риске.
2. Любое изменение статуса должно фиксироваться с датой и коротким reason note.
