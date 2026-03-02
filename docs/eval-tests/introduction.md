# Evaluation Tests: Introduction

Date: 2026-02-21
Project: `travelmind-mcp`

## 1. v1 quality strategy

V1 uses hard quality guardrails without a full automated eval pipeline.

Goal: ship fast while preventing obvious regressions in evidence quality and verification reliability.

## 2. Mandatory release guardrails

1. Weekly smoke run of `30-50` realistic queries.
2. Evidence/citation coverage must be `>= 95%`.
3. Connector replay fixtures and contract tests must pass.
4. Validator obvious error rate must be `<= 10%` on weekly manual audit sample.

Release is blocked when any guardrail fails.

## 3. Smoke set composition

Balanced query mix:
1. Real-time: today/tonight/date-specific asks.
2. Discovery: hidden gems, neighborhoods, temple/food picks.
3. Logistics: transport, luggage, transfer constraints.
4. Verification: map and Tabelog link checks.

Language coverage:
1. RU
2. EN
3. Optional JA growth as dataset expands.

## 4. Minimal weekly process (solo-friendly)

1. Run smoke queries through `search_context`.
2. Check evidence coverage and inspect failed cases.
3. Run validator audit sample and label obvious errors.
4. Run connector replay fixtures.
5. Document top failure cluster and fix highest-impact issue first.

## 5. Minimal artifacts

1. `smoke_queries.csv` with routing fields (`workspace_id`, `region_pack_id`, `source_list_version`).
2. `smoke_runs/` result snapshots.
3. `validator_audit.csv` with human labels.
4. `connector_replay/` fixtures and expected outputs.

## 6. Post-v1 roadmap

1. Add automated `eval_cases/eval_runs/eval_results` pipeline.
2. Add retrieval metrics (`Hit@10`, `Recall@20`, `nDCG@10`).
3. Add language parity tracking (`ru/en/ja`).
4. Add trend dashboards and regression gates.
