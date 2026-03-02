# Multilingual RAG Research Notes

Date: 2026-02-20
Project: `travelmind-mcp`

## 1) Как это обычно делают в проде

1. Индексируют документы в оригинальном языке, без принудительного перевода всего корпуса.
2. На этапе ingest добавляют метаданные: `tenant_id`, `source_type`, `source_id`, `url`, `author`, `published_at`, `ingested_at`, `lang`, `quality_score`, `trust_score`.
3. Хранят два канала поиска:
   - lexical/BM25 (точные совпадения, имена мест, цены, даты)
   - vector search (семантика, перефраз)
4. Делают hybrid retrieval + rerank (обычно лучше, чем только вектора).
5. На выдаче возвращают цитаты/сниппеты с источником и временем публикации.
6. Для high-churn источников (Telegram/Reddit) делают incremental ingest + backfill + дедуп + anti-spam/quality scoring.

## 2) Что важно для multilingual сценария

1. Не переводить всё заранее: это дорого, теряется нюанс, и появляются артефакты.
2. Использовать мультиязычные эмбеддинги (или сильные модели с хорошей cross-lingual переносимостью).
3. Определять язык на chunk/document уровне и хранить `lang` как обязательное поле.
4. Добавлять language-aware нормализацию текста:
   - Unicode normalization
   - очистка мусора/boilerplate
   - language-specific tokenization (там, где это критично)
5. Для запроса пользователя делать language-aware план:
   - query rewrite в 1-2 вспомогательных языка (например: ru/en/ja)
   - объединение кандидатов
   - единый rerank
6. Для ответа агента отделять:
   - `retrieval_language` (на каком языке найдено)
   - `response_language` (на каком языке отвечаем пользователю)

## 3) Рекомендованный blueprint для `travelmind-mcp`

1. В ingest pipeline добавить этапы:
   - `normalize_text`
   - `detect_language`
   - `deduplicate`
   - `chunk`
   - `embed` (Voyage AI)
   - `index` (PostgreSQL + pgvector + FTS)
2. В retrieval pipeline:
   - `query_normalize`
   - `query_expand_multilingual` (ru/en/ja)
   - `hybrid_retrieve`
   - `cross_encoder_rerank`
   - `source_diversification` (чтобы не было 10 кусков из одного и того же треда)
3. Для trust/quality:
   - пер-источник baseline trust
   - decay по времени
   - штраф за маркетинговый/SEO-паттерн
   - бонус за подтверждение из независимых источников
4. Для backfill:
   - режимы `last_2y` и `from_start_of_time`
   - прогресс и checkpoint per source
   - идемпотентный upsert
5. Для multi-tenant:
   - `tenant_id` = ISO country code (`JP` сейчас)
   - везде row-level фильтр по `tenant_id`

## 4) Минимальный набор таблиц (черновой)

- `sources`
- `source_items`
- `chunks`
- `chunk_embeddings`
- `ingest_jobs`
- `backfill_jobs`
- `query_logs`
- `feedback`

Ключевые поля:
- `tenant_id`, `source_id`, `external_id`, `lang`, `published_at`, `ingested_at`, `checksum`, `version`, `is_deleted`

## 5) Evaluation (что мерить)

1. Retrieval:
   - Recall@k
   - nDCG@k
   - MRR
2. Multilingual quality:
   - same-intent query parity между ru/en/ja
   - bias по языкам (не должен "забывать" менее представленные языки)
3. Freshness:
   - median lag ingest (source -> index)
4. Source trust:
   - доля ответов с >=2 независимыми источниками
5. Product quality:
   - human eval на grounding, usefulness, freshness

## 6) Практический вывод для твоего продукта

Твоя идея сильная и коммерчески жизнеспособная именно из-за **curated + fresh + cited** подхода.
Главная защита от конкурентов: собственный индекс качественных источников + быстрый ingest + хорошая retrieval архитектура (hybrid + rerank + trust scoring), а не просто «еще один чат-бот».

## 7) Ссылки (ядро исследования)

Embeddings / Retrieval / Benchmarks:
- https://docs.voyageai.com/docs/embeddings
- https://docs.voyageai.com/docs/reranker
- https://aclanthology.org/2022.acl-long.62/  (MIRACL)
- https://arxiv.org/abs/2007.01852  (LaBSE)
- https://huggingface.co/spaces/mteb/leaderboard  (MTEB leaderboard)
- https://arxiv.org/abs/2402.03216  (BGE-M3)

Search platforms / language support:
- https://learn.microsoft.com/azure/search/vector-search-overview
- https://learn.microsoft.com/azure/search/search-language-support
- https://www.elastic.co/guide/en/elasticsearch/reference/current/semantic-search.html
- https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-lang-analyzer.html

Multilingual RAG research direction:
- https://aclanthology.org/2025.findings-acl.26/
- https://aclanthology.org/2025.findings-acl.1117/

## 8) Что можно сделать следующим шагом

1. Зафиксировать формат `chunk` + `metadata` контрактом в `docs/development-plan.xml`.
2. Добавить language-aware query expansion в модуль `M-RAG-RETRIEVER`.
3. Добавить trust scoring policy в `M-TRIP-PLANNER`.
4. Ввести evaluation job с weekly regression отчетом по ru/en/ja.

