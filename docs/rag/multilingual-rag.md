
• Принял. Сейчас соберу только первичные источники (papers + официальная документация) по мультиязычному RAG: ingestion, retrieval, rerank, translation и language
  routing, затем дам практичный summary для твоего кейса.

  ———

  [ml-webscan_v1] Starting primary-source research on multilingual RAG patterns

• Searched MIRACL benchmark multilingual retrieval paper arxiv

───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• Первые результаты шумные, поэтому я ужимаю выборку до строго первичных: arXiv/ACL для подходов и официальные доки (Elastic/OpenSearch/Vector DB/Voyage) для продакшн-
  паттернов.

  ———

  [ml-webscan_v2] Narrowing to primary papers and official implementation docs

• Searched site:aclanthology.org Language-agnostic BERT Sentence Embedding ACL 2022

• Searched site:arxiv.org 2402.03216 BGE-M3

• Searched MIRACL A Multilingual Retrieval Dataset Covering 18 Languages arxiv 2022

───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• Теперь добираю практическую сторону из официальных доков: как в проде делают language detection, analyzer-by-language, multilingual embeddings и rerank.

  ———

  [ml-webscan_v3] Collecting official implementation docs for multilingual retrieval stacks

• Searched Voyage AI multilingual embeddings documentation

• Searched site:elastic.co guide language analyzers elasticsearch

• Searched Elasticsearch language analyzers documentation

• Searched site:aclanthology.org MIRACL multilingual retrieval dataset covering 18 languages

• Searched https://arxiv.org/abs/2402.03216

• Searched https://arxiv.org/abs/2212.10496

• Searched 'voyage-4-large' in https://docs.voyageai.com/docs/embeddings

• Searched 'OpenSearch supports the following language analyzers' in https://docs.opensearch.org/docs/latest/analyzers/language-analyzers/index/

• Searched https://www.elastic.co/blog/multilingual-search-using-language-identification-in-elasticsearch

• Searched site:docs.voyageai.com rerankers multilingual

• Searched 'multilingual support' in https://docs.voyageai.com/docs/reranker

• Searched https://arxiv.org/abs/2502.17163

• Searched https://docs.opensearch.org/docs/1.3/analyzers/language-analyzers/

• Searched 'OpenSearch supports the following language values' in https://docs.opensearch.org/docs/1.3/analyzers/language-analyzers/

• Searched 'semantic_text field type is the recommended starting point' in https://www.elastic.co/docs/solutions/search/vector/dense-vector

• Searched https://learn.microsoft.com/en-us/azure/search/search-language-support

• Searched https://learn.microsoft.com/en-us/azure///search/vector-search-overview

• Searched mContriever: Multilingual Contriever arxiv

─ Worked for 1m 13s ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• Добавляю ещё слой именно про multilingual RAG (не просто retrieval), чтобы ответить, как это делают end-to-end в системах с генерацией.

  ———

  [mrag-webscan_v1] Gathering primary sources on multilingual RAG behavior and evaluation

• Searched site:arxiv.org multilingual retrieval augmented generation mRAG

• Searched https://aclanthology.org/2025.findings-acl.295/

• Searched 'retrieving multilingual documents best improves response consistency' in https://aclanthology.org/2025.findings-acl.219/

───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• Изучил. По первичным источникам (papers + official docs) сейчас чаще делают так:

  1. Единый мультиязычный векторный индекс, а не отдельный индекс на каждый язык.

  - Используют multilingual embeddings (например, современные Voyage модели и voyage-multilingual-2) и хранят один embedding-space.
  - На запросе обязательно тот же embedding model, что и при индексации.

  2. Параллельно держат lexical-ветку с language-aware анализаторами.

  - Для full-text делают language-specific fields/indices (пер-языковые анализаторы), особенно чтобы не терять морфологию/стемминг.
  - Это стандартный паттерн “vector + language analyzers”.

  3. Retrieval почти всегда гибридный.

  - Vector + keyword одновременно, затем объединение (часто RRF).
  - Потом rerank top-N cross-encoder’ом (мультиязычным).

  4. Translation обычно не делают “на весь корпус”.

  - Переводят query (иногда в несколько языков) и/или только top-K кандидатов перед ответом.
  - Оригинальный текст источника сохраняют всегда; в ответе дают цитату в оригинале + перевод при необходимости.

  5. В mRAG есть языковые перекосы — это подтверждено.

  - Есть наблюдение, что retriever тяготеет к high-resource/query language, а generator часто тянет к языку запроса/латинице.
  - Смешанный multilingual retrieval и добавление переведённых проходов может повышать устойчивость и консистентность.

  6. Оценка качества — не “на глаз”.

  - Retrieval: MIRACL (18 языков), плюс MTEB для общей проверки embedding-моделей.
  - Для multilingual RAG отдельно смотрят robustness/consistency между языками.

  Что это значит для твоего продукта practically:

  1. Делай original_text + lang + source + published_at + tenant_id.
  2. Делай единый multilingual vector index (Voyage), плюс RU/EN/JA lexical fields.
  3. На query: detect lang -> embed -> hybrid retrieve -> multilingual rerank -> ответ.
  4. Перевод только top-K (не при ingest всего потока), с обязательными оригинальными цитатами.

  Источники:

  - MIRACL (TACL 2023): https://aclanthology.org/2023.tacl-1.63/
  - LaBSE (ACL 2022): https://aclanthology.org/2022.acl-long.62/
  - MTEB: https://arxiv.org/abs/2210.07316
  - M3-Embedding: https://arxiv.org/abs/2402.03216
  - Voyage Text Embeddings: https://docs.voyageai.com/docs/embeddings
  - Voyage Rerankers: https://docs.voyageai.com/docs/reranker
  - Azure Vector Search overview (multilingual/hybrid): https://learn.microsoft.com/en-us/azure/search/vector-search-overview
  - Azure multi-language indexing patterns: https://learn.microsoft.com/en-us/azure/search/search-language-support
  - Azure vector query (same model + weights): https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-query
  - Elastic vector search: https://www.elastic.co/docs/solutions/search/vector
  - Elastic hybrid search (RRF): https://www.elastic.co/docs/solutions/search/hybrid-search
  - Elastic language analyzers: https://www.elastic.co/docs/reference/text-analysis/analysis-lang-analyzer
  - Elastic per-field/per-index multilingual strategy: https://www.elastic.co/blog/multilingual-search-using-language-identification-in-elasticsearch
  - mRAG language preference (ACL Findings 2025): https://aclanthology.org/2025.findings-acl.295/
  - Cross-lingual robustness in multilingual RAG (ACL Findings 2025): https://aclanthology.org/2025.findings-acl.219/
  - MEMERAG (multilingual RAG eval): https://arxiv.org/abs/2502.17163
