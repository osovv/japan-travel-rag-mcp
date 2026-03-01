# CloudPayments Billing Integration Plan

Date: 2026-03-01
Project: `japan-travel-rag-mcp`
Status: Draft implementation plan

## 0. Context

Related documents:
- `docs/research/payment-providers.md` - Payment providers research and decision rationale
- `docs/requirements.xml` - UC-017 (usage tracking)
- `docs/technology.xml` - Stack and architecture decisions

Business model:
- **Credits top-up** (not subscription)
- Expected revenue: <50,000 RUB/month initially
- Target: Russia + International users

Payment provider decision:
- **Primary:** CloudPayments (cards RF + international, SBP)
- **Future:** NOWPayments (crypto)

## 1. Goal

Add credits-based billing system with:
1. User credit balances
2. Usage limits per tier
3. Payment flow via CloudPayments
4. Portal UI for top-up and balance management

Target user-facing effect:
1. Users can purchase credits via CloudPayments widget
2. MCP tool calls consume credits
3. Portal shows balance and usage stats
4. Clear limits with upgrade prompts

## 2. Problem Summary

Current state:
- UC-017 tracks per-user per-tool call counts in `usage_counters` table
- No limits enforcement
- No billing integration
- No monetization path

Needed:
- Credit system where 1 credit = 1 tool call (simplest model)
- Soft limits (warnings) vs hard limits (blocked calls)
- Payment gateway integration
- Portal billing UI

## 3. Scope

### In scope (Phase 1):
1. Database schema for credits, transactions, payments
2. PaymentGateway adapter interface + CloudPayments implementation
3. Credit consumption on MCP tool calls
4. Portal billing page (balance, top-up, history)
5. Usage limits enforcement (configurable tiers)

### Out of scope (Phase 1):
1. NOWPayments crypto integration
2. Subscription/recurring billing
3. Admin billing management UI
4. Invoice generation
5. Multi-currency pricing (RUB only initially)
6. Refunds automation

### Future phases:
1. NOWPayments adapter for crypto
2. Subscription tiers
3. Admin billing dashboard
4. Automated invoicing

## 4. Locked Decisions (v1)

1. **Credit model:** 1 credit = 1 MCP tool call (simplest, transparent)
2. **Pricing packages:** Fixed RUB amounts (e.g., 500₽ = 100 credits)
3. **Limits:** Soft limit (email/warning) → Hard limit (blocked calls)
4. **Gateway:** CloudPayments widget integration (hosted payment page)
5. **Settlement:** RUB to Russian bank account (T+1)
6. **Architecture:** Adapter pattern for pluggable payment gateways
7. **Webhooks:** CloudPayments webhook for payment confirmation
8. **Idempotency:** Payment ID used for deduplication
9. **Free tier:** Configurable starting credits for new users
10. **Balance precision:** Integer credits (no fractions)

## 5. Target Design

### 5.1 Database Schema

```sql
-- User credit balances
CREATE TABLE user_balances (
  user_id TEXT PRIMARY KEY REFERENCES users(logto_sub),
  credits_balance INTEGER NOT NULL DEFAULT 0,
  credits_used INTEGER NOT NULL DEFAULT 0,
  soft_limit INTEGER NOT NULL DEFAULT 100,
  hard_limit INTEGER NOT NULL DEFAULT 0, -- 0 = no hard limit
  tier TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Credit packages (pricing)
CREATE TABLE credit_packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  credits INTEGER NOT NULL,
  price_rub INTEGER NOT NULL, -- in kopecks (100 = 1 RUB)
  bonus_credits INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Payment transactions
CREATE TABLE payment_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_balances(user_id),
  gateway TEXT NOT NULL, -- 'cloudpayments' | 'nowpayments' | ...
  gateway_transaction_id TEXT,
  gateway_invoice_id TEXT,
  amount_kopecks INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  credits_purchased INTEGER NOT NULL,
  bonus_credits INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL, -- 'pending' | 'completed' | 'failed' | 'refunded'
  payment_method TEXT, -- 'card' | 'sbp' | 'applepay' | 'crypto'
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Credit transactions (audit log)
CREATE TABLE credit_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_balances(user_id),
  payment_transaction_id TEXT REFERENCES payment_transactions(id),
  credits_change INTEGER NOT NULL, -- positive = top-up, negative = usage
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL, -- 'top-up' | 'tool-usage' | 'refund' | 'admin-adjustment'
  tool_name TEXT, -- for 'tool-usage' reason
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_payment_transactions_user ON payment_transactions(user_id);
CREATE INDEX idx_payment_transactions_status ON payment_transactions(status);
CREATE INDEX idx_payment_transactions_gateway ON payment_transactions(gateway, gateway_transaction_id);
CREATE INDEX idx_credit_transactions_user ON credit_transactions(user_id);
CREATE INDEX idx_credit_transactions_reason ON credit_transactions(reason);
```

### 5.2 Code Layout

```
src/
├── billing/
│   ├── index.ts                    # Public exports
│   ├── gateway-interface.ts        # PaymentGateway interface
│   ├── gateways/
│   │   ├── cloudpayments.ts        # CloudPayments adapter
│   │   └── nowpayments.ts          # Future: crypto adapter
│   ├── credits.ts                  # Credit balance operations
│   ├── limits.ts                   # Usage limit enforcement
│   ├── packages.ts                 # Credit package definitions
│   └── webhooks/
│       └── cloudpayments.ts        # Webhook handler
├── db/
│   └── schema.ts                   # Add billing tables (existing)
└── portal/
    └── billing-routes.tsx          # Portal billing UI routes
```

### 5.3 PaymentGateway Interface

```typescript
// src/billing/gateway-interface.ts

export interface CreatePaymentParams {
  userId: string;
  amountKopecks: number;
  credits: number;
  bonusCredits: number;
  currency: string;
  description: string;
  successUrl: string;
  failUrl: string;
}

export interface PaymentResult {
  transactionId: string;
  gatewayInvoiceId: string;
  paymentUrl: string; // URL to redirect user to payment page
}

export interface PaymentStatus {
  transactionId: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  gatewayTransactionId?: string;
  paymentMethod?: string;
  completedAt?: Date;
}

export interface WebhookPayload {
  raw: unknown;
  transactionId: string;
  status: 'success' | 'fail' | 'refund';
  gatewayTransactionId: string;
  amount: number;
  currency: string;
}

export interface PaymentGateway {
  readonly name: string;

  createPayment(params: CreatePaymentParams): Promise<PaymentResult>;
  getPaymentStatus(transactionId: string): Promise<PaymentStatus>;
  validateWebhookSignature(rawBody: string, signature: string): boolean;
  parseWebhook(rawBody: string): WebhookPayload;
}
```

### 5.4 CloudPayments Integration

```typescript
// src/billing/gateways/cloudpayments.ts

export class CloudPaymentsGateway implements PaymentGateway {
  readonly name = 'cloudpayments';

  constructor(
    private publicKey: string,
    private privateKey: string,
    private apiUrl: string = 'https://api.cloudpayments.ru'
  ) {}

  async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
    // Use CloudPayments "pay" API endpoint
    // Generate invoice with custom receipt
    // Return payment URL for redirect
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentStatus> {
    // Query CloudPayments API for transaction status
  }

  validateWebhookSignature(rawBody: string, signature: string): boolean {
    // Validate HMAC signature from CloudPayments
  }

  parseWebhook(rawBody: string): WebhookPayload {
    // Parse CloudPayments webhook JSON
  }
}
```

### 5.5 Credit Consumption Flow

```typescript
// On MCP tool call (in usage tracker)

async function trackAndConsumeCredit(userId: string, toolName: string): Promise<{
  allowed: boolean;
  remaining: number;
  limitReached: boolean;
}> {
  const balance = await getBalance(userId);

  // Check hard limit
  if (balance.hardLimit > 0 && balance.creditsUsed >= balance.hardLimit) {
    return { allowed: false, remaining: 0, limitReached: true };
  }

  // Consume credit
  await deductCredit(userId, 1, toolName);

  const newBalance = balance.creditsBalance - 1;

  // Check soft limit for warning
  const limitReached = newBalance <= (balance.softLimit * 0.2); // 20% warning

  return { allowed: true, remaining: newBalance, limitReached };
}
```

### 5.6 Portal Routes

| Route | Purpose |
|-------|---------|
| `GET /portal/billing` | Billing overview (balance, usage, packages) |
| `POST /portal/billing/top-up` | Initiate payment (returns redirect URL) |
| `GET /portal/billing/success` | Payment success landing |
| `GET /portal/billing/history` | Transaction history |
| `POST /webhooks/cloudpayments` | CloudPayments webhook endpoint |

### 5.7 Config Extension

```typescript
// Add to AppConfig
interface BillingConfig {
  cloudpaymentsPublicKey: string;
  cloudpaymentsPrivateKey: string;
  defaultSoftLimit: number;
  defaultHardLimit: number; // 0 = unlimited
  startingCredits: number; // for new users
}
```

New env vars:
```
CLOUDPAYMENTS_PUBLIC_KEY=pk_xxx
CLOUDPAYMENTS_PRIVATE_KEY=sk_xxx
BILLING_DEFAULT_SOFT_LIMIT=100
BILLING_DEFAULT_HARD_LIMIT=0
BILLING_STARTING_CREDITS=50
```

## 6. Implementation Phases

### Phase 1: Database & Core (M-BILLING-SCHEMA)
1. Add billing tables to `src/db/schema.ts`
2. Create migration
3. Add seed data for credit packages
4. Create `src/billing/credits.ts` for balance operations

### Phase 2: Payment Gateway (M-BILLING-GATEWAY)
1. Define `PaymentGateway` interface
2. Implement `CloudPaymentsGateway`
3. Create `src/billing/webhooks/cloudpayments.ts`
4. Add webhook route to server

### Phase 3: Usage Limits (M-BILLING-LIMITS)
1. Create `src/billing/limits.ts`
2. Integrate with MCP tool execution
3. Add limit checks before tool calls
4. Return appropriate errors when limited

### Phase 4: Portal UI (M-BILLING-PORTAL)
1. Create `src/portal/billing-routes.tsx`
2. Billing overview page
3. Top-up flow with CloudPayments widget
4. Transaction history page
5. Success/fail callback pages

### Phase 5: Config & Env (M-BILLING-CONFIG)
1. Extend `AppConfig` with billing config
2. Add env validation
3. Update `CLAUDE.md` with new env vars

## 7. Testing Strategy

### Unit Tests
1. Credit balance operations (add, deduct, balance check)
2. Limit enforcement logic
3. Payment gateway interface compliance

### Integration Tests
1. CloudPayments API mock tests
2. Webhook handling with signature validation
3. End-to-end top-up flow

### Manual Testing
1. CloudPayments test card payments
2. Portal UI flow
3. Limit enforcement in MCP calls

## 8. Security Considerations

1. **Webhook signature validation** - Always validate CloudPayments HMAC
2. **Idempotency** - Use transaction IDs to prevent double-crediting
3. **Rate limiting** - Prevent abuse of top-up endpoint
4. **Amount validation** - Server-side validation of credit amounts
5. **User isolation** - Ensure users can only access their own billing data

## 9. Monitoring & Observability

1. Log all payment transactions (status, amount, gateway)
2. Log credit consumption per tool
3. Alert on failed payments or webhook errors
4. Track conversion funnel (view → initiate → complete)

## 10. Rollout Plan

1. **Alpha:** Internal testing with CloudPayments test mode
2. **Beta:** Limited rollout to selected users
3. **GA:** Full production with CloudPayments live mode

CloudPayments test cards:
- Success: 4242 4242 4242 4242
- Fail: 4000 0000 0000 0002

## 11. Success Criteria

1. User can purchase credits via CloudPayments
2. Credits are correctly deducted on MCP tool calls
3. Limits are enforced correctly
4. Portal shows accurate balance and history
5. Webhooks are processed reliably (99.9%+)
6. No duplicate crediting from webhooks

## 12. Future Considerations

1. **NOWPayments:** Add crypto payment option
2. **Subscriptions:** Monthly credit allowances
3. **Tiered pricing:** Volume discounts
4. **Referrals:** Bonus credits for invites
5. **Enterprise:** Custom pricing and invoicing
