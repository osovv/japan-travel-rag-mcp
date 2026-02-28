# Tech Debt Backlog: Chat Scope Hardening for MCP Proxy

Date: 2026-02-28
Project: `japan-travel-rag-mcp`
Owner: `solo founder`
Status: Planned

## 1. Что уже реализовано (не техдолг)

1. `TG_CHAT_RAG_CHAT_IDS` задается через env и валидируется в конфиге.
2. Для `search_messages` действует строгий policy path:
   - внешние `filters.chat_ids` запрещены,
   - внутренний allowlist инжектится принудительно.
3. Отдельного метода для "full-history export" в текущем публичном tool surface нет.

## 2. Реальная проблема (текущий техдолг)

Для message-based методов нет симметричного локального chat-scope enforcement, как у `search_messages`:
1. `get_message_context`
2. `get_related_messages`
3. `list_sources`

Это оставляет зависимость от поведения upstream и снижает предсказуемость policy на границе proxy.

## 3. Цель фикса

Сделать единый локальный policy-enforcement в `M-TOOL-PROXY`:
1. Любой `message_uid`/`message_uids` должен относиться только к разрешенным `chat_id` из `TG_CHAT_RAG_CHAT_IDS`.
2. Если вход выходит за скоуп — deterministic ошибка (`FORBIDDEN_INPUT_CHAT_SCOPE` или эквивалент по текущему error-code дизайну).

## 4. План работ (P0)

1. Input policy для `get_message_context`:
   - извлекать `chat_id` из `message_uid`;
   - блокировать запрос вне allowlist.
2. Input policy для `get_related_messages`:
   - тот же подход, что выше.
3. Input policy для `list_sources`:
   - фильтровать `message_uids` по allowlist;
   - если после фильтра пусто — deterministic ошибка.
4. Тесты:
   - deny/allow сценарии для всех трех методов,
   - регрессия `search_messages` policy.

## 5. Дополнительно (P1, не блокер)

1. Output defense для `get_message_context` и `list_sources` (проверка/санитизация `chat_id` в ответе).
2. Ограничение размера текстовой выдачи в proxy-ответах (snippet budget), чтобы снизить риск нежелательной «широкой выдачи».

## 6. Что исключено из работ как некорректная постановка

1. "Запретить full-history export endpoint" — сейчас такого endpoint/tool нет в текущем surface.
2. "Сделать allowlist через env" — уже сделано (`TG_CHAT_RAG_CHAT_IDS`).

## 7. Файлы-кандидаты для изменений

1. `src/tools/proxy-service.ts`
2. `src/tools/proxy-service.test.ts`
3. `docs/product/legal-telegram-indexing-policy-2026-02-28.md` (статус planned -> done после внедрения)

## 8. Критерии готовности

1. Для всех 4 proxied tools действует локально проверяемый chat scope.
2. Тесты policy path покрывают deny/allow сценарии.
3. Логи имеют явные события по блокировке вне скоупа.
4. Legal-док обновлен на фактический статус.

## 9. Оценка

1. Код + тесты P0: 2-4 часа.
2. Документация: 15-20 минут.
