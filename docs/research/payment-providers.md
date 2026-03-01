# Payment Providers Research

**Date:** 2025-03-01
**Project:** japan-travel-rag-mcp
**Business Model:** Credits top-up (usage-based)

---

## Executive Summary

| Decision | Provider | Purpose |
|----------|----------|---------|
| **Primary** | CloudPayments | Cards (RF + International), SBP, Apple/Google Pay |
| **Future** | NOWPayments | Cryptocurrency (USDT, BTC) for international users |
| **Architecture** | Adapter pattern | Pluggable payment gateways |

---

## Business Context

### Current Project
- **Model:** Credits top-up (not subscription)
- **Expected revenue:** <50,000 RUB/month initially
- **Target users:** Russia + International (Japan travel enthusiasts)

### Future Projects (5 total)
- **Model:** Subscriptions (recurring payments)
- **Combined revenue potential:** >100,000-200,000 RUB/month

### Constraints
- Russian tax resident (no foreign company)
- No Stripe, PayPal, or Western payment processors (sanctions)
- Need to accept international cards (Visa/Mastercard from abroad)

---

## Market Analysis

### Sanctions Impact (2022-2025)

| Restriction | Status |
|-------------|--------|
| Stripe | ❌ Not available in Russia |
| PayPal | ❌ Suspended Russian accounts |
| Visa/Mastercard RF-issued | ❌ Don't work internationally |
| Visa/Mastercard foreign-issued | ✅ Can accept via intermediaries |
| SWIFT | ❌ Most Russian banks disconnected |

---

## Provider Comparison

### Option 1: CloudPayments (SELECTED)

**Website:** https://cloudpayments.ru

| Parameter | Value |
|-----------|-------|
| Cards RF | 3.5-3.9% |
| Cards International | Individual (negotiated) |
| SBP | 0.7-1.5% |
| Monthly fee | 900 RUB (if <50k turnover) |
| Monthly fee | Waived (if >50k turnover) |
| Verification fee | ~1,900 RUB (one-time) |
| Settlement | T+1 |
| Currencies | 30+ |
| English interface | ✅ |
| API quality | Excellent (recurring, subscriptions) |
| On market since | 2014 |

**Payment Methods:**
- Bank cards (RF + International)
- SBP (Система быстрых платежей)
- Apple Pay, Google Pay
- T-Pay, SberPay, Mir Pay
- Installments (Долями, Рассрочка)

**Pros:**
- Best API for subscriptions (future projects)
- Single integration for all 6 projects
- International cards support
- Mature platform, Tinkoff backing
- No need for YooKassa (covers everything)

**Cons:**
- Monthly fee 900 RUB for small turnover
- International card commission not published (individual)

---

### Option 2: Prodamus (Alternative)

**Website:** https://prodamus.ru

| Parameter | Value |
|-----------|-------|
| Cards RF | 3.5% |
| Cards International | 10% (min 100 RUB) |
| Monthly fee | 0 RUB |
| Settlement | T+2 |
| Currencies | RUB, USD, EUR |
| English interface | ❌ (in testing) |
| Connection time | 1 day |

**Payment Flow for International Cards:**
- Goes through Kazakhstan (KZT currency)
- Double conversion: Client's currency → KZT → RUB
- Additional ~10-15% effective cost on top of 10% commission

**Pros:**
- No monthly fee
- Transparent international card pricing
- Fast setup

**Cons:**
- 10% commission on international cards
- Double conversion adds 10-15% more
- No English interface
- Weaker subscription API

---

### Option 3: NOWPayments (Future - Crypto)

**Website:** https://nowpayments.io

| Parameter | Value |
|-----------|-------|
| Commission | ~0.5% |
| Cryptos | 200+ (USDT, BTC, ETH, etc.) |
| Subscription support | ✅ API available |
| Settlement | Direct to wallet (USDT) |
| KYC | Minimal |

**Pros:**
- Very low commission
- No banking restrictions
- Global reach
- Direct USDT settlement

**Cons:**
- Not all users want to pay crypto
- Tether has frozen some Russia-related wallets
- Volatility (mitigated by stablecoins)

---

### Option 4: CoolPay (Alternative Crypto)

**Website:** https://cool-pay.com

| Parameter | Value |
|-----------|-------|
| RF residents | ✅ Supported |
| Settlement | USDT |
| Type | International acquiring |

---

### Option 5: YooKassa (Not Selected)

**Website:** https://yookassa.ru

**Why not selected:**
- CloudPayments covers all YooKassa features
- Adding YooKassa = redundant integration
- Only useful if YooMoney wallet specifically needed

---

## Rejected Options

### US LLC via Stripe Atlas
- Cost: ~$500 setup
- Problem: Enhanced scrutiny for Russian nationals
- High risk of account closure
- Not viable

### Estonia e-Residency
- Cost: ~€265
- Problem: **No longer available to new Russian applicants** (suspended 2022)
- Not viable

### Kazakhstan Bank Account
- Requires: Kazakhstan company or IP
- Viable only if Georgian IP obtained
- Too complex for current stage

---

## Architecture Decision: Adapter Pattern

```typescript
// Target interface
interface PaymentGateway {
  createPayment(params: CreatePaymentParams): Promise<PaymentResult>;
  getPaymentStatus(paymentId: string): Promise<PaymentStatus>;
  handleWebhook(payload: unknown): Promise<WebhookResult>;
}

// Implementations
class CloudPaymentsAdapter implements PaymentGateway { ... }
class NOWPaymentsAdapter implements PaymentGateway { ... }
class ProdamusAdapter implements PaymentGateway { ... }
```

### Benefits
- Easy to switch providers
- Add new gateways without changing business logic
- Test with mock gateway
- A/B test different providers

### Database Schema (Draft)

```sql
-- Payment transactions
CREATE TABLE payment_transactions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  gateway TEXT NOT NULL, -- 'cloudpayments' | 'nowpayments' | ...
  gateway_transaction_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  status TEXT NOT NULL, -- 'pending' | 'completed' | 'failed' | 'refunded'
  credits_added INTEGER,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- User credit balance
CREATE TABLE user_balances (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  credits_balance INTEGER NOT NULL DEFAULT 0,
  credits_used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Credit transactions (audit log)
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  payment_transaction_id UUID REFERENCES payment_transactions(id),
  credits_change INTEGER NOT NULL, -- positive = top-up, negative = usage
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL, -- 'top-up' | 'tool-usage' | 'refund'
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Implementation Roadmap

### Phase 1: Core Infrastructure
1. Database tables (balances, transactions)
2. Payment gateway adapter interface
3. Usage tracking integration with credits

### Phase 2: CloudPayments Integration
1. CloudPaymentsAdapter implementation
2. Payment widget in portal
3. Webhook handler
4. Credit top-up flow

### Phase 3: Portal UI
1. Balance display in portal
2. Top-up page with amount selection
3. Transaction history
4. Usage stats with credit costs

### Phase 4: NOWPayments (Future)
1. NOWPaymentsAdapter implementation
2. Crypto payment option in UI
3. USDT settlement setup

---

## Cost Estimates

### Current Project (<50k RUB/month)

| Item | Cost |
|------|------|
| CloudPayments monthly | 900 RUB |
| CloudPayments commission (3.9%) | ~1,950 RUB |
| **Total** | ~2,850 RUB/month (5.7%) |

### After Growth (>50k RUB/month)

| Item | Cost |
|------|------|
| CloudPayments monthly | 0 RUB (waived) |
| CloudPayments commission (3.5%) | ~1,750 RUB |
| **Total** | ~1,750 RUB/month (3.5%) |

### With Crypto Option

| Item | Cost |
|------|------|
| NOWPayments commission | ~0.5% |
| Per 10k RUB in crypto | 50 RUB |

---

## References

- [CloudPayments](https://cloudpayments.ru)
- [CloudPayments API Docs](https://cloudpayments.ru/Docs/Api)
- [NOWPayments](https://nowpayments.io)
- [NOWPayments API Docs](https://documenter.getpostman.com/view/7908241/S1a3Rv6u)
- [Prodamus International Payments](https://prodamus.ru/priem-mezhdynarodnyh-platezhey)
- [CoolPay](https://cool-pay.com)
- [OFAC Sanctions Search](https://sanctionssearch.ofac.treas.gov/)
