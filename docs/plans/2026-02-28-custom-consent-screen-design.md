# Custom OAuth Consent Screen

## Problem

MCP OAuth flow shows two consent screens:

1. **FastMCP consent** — hardcoded purple gradient HTML, generic "MCP Client requests access"
2. **Logto consent** — "Authorize TravelMind MCP Proxy", shows user info, "Powered by Logto"

Goal: single custom consent screen in portal visual style.

## Solution

Monkey-patch `OAuthProxy.consentManager.generateConsentScreen()` to render portal-styled HTML instead of FastMCP's built-in consent page.

### Architecture

New module `src/auth/consent-patch.ts` with single entry point:

```ts
patchOAuthProxyConsent(oauthProxy: OAuthProxy): void
```

Called in `createOauthProxy()` after `new OAuthProxy(config)`, before return.

### What gets patched

**`oauthProxy.consentManager.generateConsentScreen`** — replaced with `generatePortalConsentScreen()` that returns HTML in portal style.

### What stays unchanged

- `consentRequired: true` in OAuthProxyConfig (default)
- POST `/oauth/consent` handling — FastMCP manages transaction state, cookies, signing
- `redirectToUpstream()` — no `prompt` parameter added (Logto consent removed via Logto Console configuration: set app as first-party)

### Flow after patch

1. MCP client -> GET `/oauth/authorize`
2. FastMCP creates transaction -> `consentRequired: true` -> calls `generateConsentScreen()` -> **our HTML**
3. User clicks Approve -> POST `/oauth/consent` -> FastMCP handles automatically
4. FastMCP calls `redirectToUpstream()` -> 302 to Logto (no prompt param)
5. Logto: login if no session, skip consent (first-party app config)
6. Callback -> FastMCP exchanges code -> done

### Fallback

If Logto consent cannot be disabled via Console config, add `redirectToUpstream` patch to inject `prompt=login` into Location URL.

## Consent Screen Design

Portal style: teal accent (`#0d9488`), light blue-gray gradient background, white card, system fonts.

### HTML structure

```html
<div class="portal-center">
  <div class="portal-card">
    <div class="portal-header">
      <h1>TravelMind</h1>
      <p>An application is requesting access to your account</p>
    </div>

    <div class="permissions">
      <h3>Requested permissions:</h3>
      <ul>
        <li><!-- scope items from data.scope[] --></li>
      </ul>
    </div>

    <form method="POST" action="/oauth/consent">
      <input type="hidden" name="transaction_id" value="${transactionId}">
      <div class="consent-actions">
        <button name="action" value="deny" class="btn btn-outline btn-full">Deny</button>
        <button name="action" value="approve" class="btn btn-primary btn-full">Approve</button>
      </div>
    </form>
  </div>
</div>
```

### Key decisions

- App name hardcoded "TravelMind" (not generic "MCP Client")
- Buttons: `.btn-primary` (teal) for Approve, `.btn-outline` for Deny
- Scopes displayed with human-readable labels via `formatScopeLabel()` mapping
- Background: same gradient as portal (`linear-gradient(135deg, #dbeafe, #f0f4f8, #e2e8f0)`)
- CSS: fully inline in HTML, same root variables as portal

## Module Structure

### `src/auth/consent-patch.ts`

```
Exports:
  patchOAuthProxyConsent(oauthProxy: OAuthProxy): void

Internal:
  generatePortalConsentScreen(data: ConsentScreenData): string
  formatScopeLabel(scope: string): string
  portalConsentStyles(): string

Types:
  ConsentScreenData = { clientName: string, provider: string, scope: string[], transactionId: string }
```

### Integration point

`src/auth/oauth-proxy.ts` — one line added in `createOauthProxy()`:

```ts
patchOAuthProxyConsent(oauthProxy);
```

## Logto Configuration (manual step)

In Logto Console, configure the OAuth application as first-party to skip consent screen automatically. Check:

- Application settings -> app type / first-party flag
- API Resources -> consent settings per resource
