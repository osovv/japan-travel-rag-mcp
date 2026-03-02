# Pricing & Monetization Strategy

**Date:** 2026-03-02
**Status:** Discussion / Draft
**Participants:** Al + Claude

---

## 1. Strategic Context

### Platform, not single-destination product

The product is **TravelMind** — a **multi-destination travel RAG platform** where Japan is the first supported region:
- `/ja/mcp` — Japan
- `/cn/mcp` — China (future)
- `/it/mcp` — Italy (future)
- etc.

Single codebase, multiple destination deployments. Each destination has its own sources (Telegram communities, curated websites, embeddings).

### Phased monetization approach

1. **Phase 0 (current):** Free unlimited access, analytics tracking, donate link
2. **Phase 1:** Introduce pricing when real usage data and user base exist
3. **Phase 2:** Expand with more destinations and Dev2Dev offering

Rationale for free-first:
- No user base yet — need traction first
- Real infra costs are ~tens of dollars/month (excluding shared VPS)
- Removes legal concerns about commercial use of external sources
- Project as portfolio/showcase: "I can build this for you"
- Real usage data will validate or invalidate pricing assumptions

See: `docs/plans/2026-03-02-usage-analytics-and-monetization-strategy.md`

---

## 2. User Segments

| Segment | Description | Usage pattern | Volume |
|---------|-------------|---------------|--------|
| **Individual traveler** | Planning trip to Japan/etc. | Seasonal: 2-3 months/year (pre-trip + during trip 14-30 days) | Tens of calls/session |
| **Guide / Agency** | Travel organizers, individual guides, agencies | Year-round, steady | Hundreds-thousands/month |
| **Dev2Dev** | Developers building AI Travel Planner agents | Year-round, programmatic | Thousands-tens of thousands/month |

### Dev2Dev segment rationale

- MCP protocol is the native interface for AI agents — product is already an API
- Developers understand API pricing, willing to pay per-call
- Predictable revenue (not seasonal)
- Powerful portfolio signal: "other AI agents use my MCP server"
- Need SLA guarantees (uptime, latency) — justifies premium
- Rate limiting becomes critical (one dev client can overwhelm service)
- `api_keys` table already exists in schema

---

## 3. Tool Cost Model

Tools have different real infrastructure costs:

| Tool | Cost tier | Virtual weight | Why |
|------|-----------|---------------|-----|
| `list_sources` | free | 0 | Static data, proxied call, trivial |
| `get_site_sources` | free | 0 | Static frozen registry, local memory |
| `get_message_context` | low | 1 | Upstream DB query, no embeddings |
| `get_page_chunk` | low | 1 | Local DB query, single row |
| `get_related_messages` | medium | 2 | Vector similarity search, 25GB upstream DB |
| `search_messages` | medium | 2 | Vector search + embeddings, 25GB upstream DB |
| `search_sites` | high | 3 | Vector search + spider.cloud API + local embeddings |

Virtual weights are for analytics and relative comparison. Will be calibrated to real costs after data collection.

---

## 4. Pricing Philosophy

### Value-based, not cost-based

Infrastructure cost per user is negligible. Pricing based on **value delivered**:

- Budget Japan trip (2 weeks, from Russia): minimum 250k RUB (~$2,700)
- Realistic: 400-600k RUB ($4,300-6,500)
- Comfortable: 800k+ RUB ($8,600+)

The product saves:
- 10-20 hours of research before the trip (forums, Reddit, blogs, YouTube)
- Dozens of hours of stress on-site (navigation, dining, logistics decisions)
- Real money — AI suggests better/cheaper options not easily found via Google

**$49 = 1.8% of the cheapest trip variant. One dinner in Shinjuku.**

### Don't be shy about pricing

- Low price ($5-10) signals "toy/experiment"
- $20-50 signals "serious professional tool"
- Quality is hand-curated, not automated scraping — editorial product
- Builder personally uses and tests the product — quality guarantee

### Anchoring psychology

- Grand Tour $89 makes Trip $49 look reasonable
- Agency Pro $499 makes Guide $99 look cheap

---

## 5. Pricing Structure (Draft v1)

### Individual Traveler (top-up, not subscription)

| Package | Price | Credits | Use case |
|---------|-------|---------|----------|
| **Try** | free | 30 | Demo: see the wow-effect, not enough to plan a trip |
| **Trip** | $49 | 600 | Standard 2-week trip planning + on-trip use |
| **Grand Tour** | $89 | 1,500 | Long trip / multiple destinations / perfectionist |

Free tier is intentionally small: enough to experience value, not enough to complete planning. Drives conversion.

### Guide / Agency (top-up)

| Package | Price | Credits | Use case |
|---------|-------|---------|----------|
| **Guide** | $99 | 3,000 | Individual guide, several clients |
| **Agency** | $249 | 10,000 | Agency with regular client flow |
| **Agency Pro** | $499 | 25,000 | Large agency, high volume |

A guide charges $200-500/day. $99 pays for itself in half a day with one client.

### Dev2Dev (subscription + overage)

| Tier | Price/mo | Credits/mo | Overage | Use case |
|------|----------|------------|---------|----------|
| **Sandbox** | free | 100 | — | API evaluation, prototyping |
| **Build** | $79/mo | 5,000 | $0.01/credit | MVP, beta users |
| **Ship** | $199/mo | 20,000 | $0.008/credit | Production |
| **Scale** | $499/mo | 60,000 | $0.005/credit | High volume |

Dev2Dev uses subscription (not top-up) because they need cost predictability. Overage prevents hard cutoffs.

---

## 6. Multi-Destination Pricing

### Decision: TBD (two options)

**Option A: Unified credits across all destinations**
- Buy 600 credits → use on `/ja/mcp`, `/it/mcp`, any destination
- Simple for user, simple to implement
- Multi-destination users naturally consume more credits

**Option B: Per-destination packs**
- $49 Japan Trip = 600 credits for `/ja/mcp` only
- $49 Italy Trip = 600 credits for `/it/mcp` only
- $89 Multi-destination = 1,500 credits for any destination
- Higher revenue from multi-country travelers
- More complex to manage

**Leaning toward:** Option A for simplicity at launch, consider B when multiple destinations are live.

---

## 7. Currency & Payment

- Prices in **USD** (international standard, Russian IT users are accustomed to dollar pricing)
- Payment via **CloudPayments** (cards RF + international, SBP, Apple/Google Pay)
- Auto-conversion to RUB at payment time
- Future: **NOWPayments** for crypto (USDT, BTC) for international users

See: `docs/research/payment-providers.md`

---

## 8. Open Questions

1. **Credit expiration?** — Do credits expire? (Leaning: no expiration, simplifies everything)
2. **Refund policy?** — Unused credits refundable? Partially?
3. **Volume discounts beyond listed tiers?** — Custom pricing for large agencies/devs?
4. **Multi-destination pricing model** — unified vs per-destination (see section 6)
5. **Dev2Dev SLA** — What uptime/latency guarantees? Different per tier?
6. **Legal entity** — Payment processing requires a legal structure. Current constraint: Russian tax resident, no foreign company. See `docs/product/legal-structure-wren-vs-japan-travel-rag-2026-02-28.md` (TravelMind legal structure)

---

## 9. Market Research (pending)

Deep research prompt submitted 2026-03-02 covering:
- AI Travel Agent market (2024-2026)
- MCP ecosystem adoption
- Competitive landscape (travel data APIs)
- Multi-destination platform dynamics
- Dev2Dev pricing benchmarks
- Distribution channels

Results will inform pricing validation and adjustments.

---

## 10. Next Steps

1. **Now:** Ship usage analytics (see implementation plan)
2. **1-2 months:** Collect real usage data, validate segment assumptions
3. **After data:** Finalize pricing, implement billing (revive CloudPayments plan from archive)
4. **After billing:** Add destinations, launch Dev2Dev offering
