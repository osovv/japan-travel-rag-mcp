// FILE: src/admin/countries-page.tsx
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Query country settings data with per-country source counts for the Countries Management admin page, and render HTML views for the countries list and country create/edit forms.
//   SCOPE: Define page data types (CountryRow, CountriesPageData), fetch aggregated source counts via Drizzle raw SQL, return structured page model, and render server-side HTML for countries management UI.
//   DEPENDS: M-DB, M-LOGGER, M-COUNTRY-SETTINGS
//   LINKS: M-ADMIN-COUNTRIES, M-DB, M-LOGGER, M-COUNTRY-SETTINGS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   CountryRow (type) - Country metadata + aggregated source count.
//   CountriesPageData (type) - Full page data model with countries array.
//   AdminCountriesError - Typed admin countries failure with ADMIN_COUNTRIES_ERROR code.
//   fetchCountriesPageData - Query all countries with aggregated source counts.
//   handleCreateCountry - Validate input and upsert a new country settings row.
//   handleUpdateCountry - Validate input and update an existing country settings row.
//   handleDeleteCountry - Delete a country if it has no linked site sources.
//   renderCountriesContent - Render the main countries management page content.
//   renderCountryForm - Render create or edit form for a country.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial countries management admin page.
// END_CHANGE_SUMMARY

import * as Html from "@kitajs/html";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "../logger/index";
import {
  upsertCountrySettings,
  deleteCountrySettings,
  type CountryStatus,
} from "../countries/country-settings";

// ─── Types ──────────────────────────────────────────────────────────────────

export type CountryRow = {
  country_code: string;
  status: string;
  settings: Record<string, unknown>;
  source_count: number;
  created_at: Date;
  updated_at: Date;
};

export type CountriesPageData = {
  countries: CountryRow[];
};

// ─── Error ──────────────────────────────────────────────────────────────────

export class AdminCountriesError extends Error {
  public readonly code = "ADMIN_COUNTRIES_ERROR" as const;
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AdminCountriesError";
    this.details = details;
  }
}

function toAdminCountriesError(
  error: unknown,
  message: string,
  details?: Record<string, unknown>,
): AdminCountriesError {
  if (error instanceof AdminCountriesError) {
    return error;
  }
  const cause = error instanceof Error ? error.message : String(error);
  return new AdminCountriesError(message, { ...details, cause });
}

// ─── Data Fetching ──────────────────────────────────────────────────────────

// START_CONTRACT: fetchCountriesPageData
//   PURPOSE: Query all countries with aggregated site source counts.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, logger: Logger - Structured logger }
//   OUTPUTS: { Promise<CountriesPageData> - Page data model with countries array }
//   SIDE_EFFECTS: [Reads from country_settings and site_sources tables]
//   LINKS: [M-ADMIN-COUNTRIES, M-DB, M-LOGGER]
// END_CONTRACT: fetchCountriesPageData
export async function fetchCountriesPageData(
  db: NodePgDatabase,
  logger: Logger,
): Promise<CountriesPageData> {
  try {
    const rows = await db.execute(sql`
      SELECT
        cs.country_code,
        cs.status,
        cs.settings,
        cs.created_at,
        cs.updated_at,
        COALESCE(src.source_count, 0) AS source_count
      FROM country_settings cs
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS source_count
        FROM site_sources ss
        WHERE ss.country_code = cs.country_code
      ) src ON true
      ORDER BY cs.country_code
    `);

    const countries: CountryRow[] = (rows.rows ?? rows).map((row: any) => ({
      country_code: row.country_code,
      status: row.status,
      settings: (row.settings ?? {}) as Record<string, unknown>,
      source_count: Number(row.source_count),
      created_at: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
      updated_at: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    }));

    logger.info(
      `Fetched ${countries.length} countries for admin page.`,
      "fetchCountriesPageData",
      "FETCH_COUNTRIES_PAGE_DATA",
    );

    return { countries };
  } catch (error: unknown) {
    const countriesError = toAdminCountriesError(
      error,
      "Failed to fetch countries page data.",
      { operation: "fetchCountriesPageData" },
    );

    logger.error(
      "Failed to fetch countries page data.",
      "fetchCountriesPageData",
      "FETCH_COUNTRIES_PAGE_DATA",
      { code: countriesError.code, cause: countriesError.details?.cause ?? countriesError.message },
    );

    throw countriesError;
  }
}

// ─── CRUD Handlers ──────────────────────────────────────────────────────────

const VALID_STATUSES: CountryStatus[] = ["draft", "active", "coming_soon", "maintenance"];
const COUNTRY_CODE_PATTERN = /^[a-z]{2}$/;

// START_CONTRACT: handleCreateCountry
//   PURPOSE: Validate input and upsert a new country settings row.
//   INPUTS: { db: NodePgDatabase, logger: Logger, input: { country_code: string, status: string, tg_chat_ids: string } }
//   OUTPUTS: { Promise<{ success: boolean; errors?: Record<string, string[]> }> }
//   SIDE_EFFECTS: [INSERT/UPDATE country_settings; emits structured logs]
//   LINKS: [M-ADMIN-COUNTRIES, M-DB, M-LOGGER]
// END_CONTRACT: handleCreateCountry
export async function handleCreateCountry(
  db: NodePgDatabase,
  logger: Logger,
  input: { country_code: string; status: string; tg_chat_ids: string },
): Promise<{ success: boolean; errors?: Record<string, string[]> }> {
  const errors: Record<string, string[]> = {};

  if (!input.country_code || !COUNTRY_CODE_PATTERN.test(input.country_code)) {
    errors.country_code = ["Country code must be exactly 2 lowercase letters (ISO 3166-1 alpha-2)."];
  }

  if (!input.status || !VALID_STATUSES.includes(input.status as CountryStatus)) {
    errors.status = [`Status must be one of: ${VALID_STATUSES.join(", ")}.`];
  }

  const tgChatIds = parseTgChatIds(input.tg_chat_ids);

  if (Object.keys(errors).length > 0) {
    logger.warn("Create country validation failed.", "handleCreateCountry", "VALIDATE_COUNTRY", { errors });
    return { success: false, errors };
  }

  try {
    await upsertCountrySettings(db, {
      countryCode: input.country_code,
      status: input.status as CountryStatus,
      settings: { tg_chat_ids: tgChatIds },
    });

    logger.info(
      "Created/updated country settings.",
      "handleCreateCountry",
      "CREATE_COUNTRY",
      { countryCode: input.country_code },
    );

    return { success: true };
  } catch (error: unknown) {
    const countriesError = toAdminCountriesError(error, "Failed to create country.", {
      operation: "handleCreateCountry",
      countryCode: input.country_code,
    });

    logger.error(
      "Failed to create country.",
      "handleCreateCountry",
      "CREATE_COUNTRY",
      { code: countriesError.code, cause: countriesError.details?.cause ?? countriesError.message },
    );

    throw countriesError;
  }
}

// START_CONTRACT: handleUpdateCountry
//   PURPOSE: Validate input and update an existing country settings row.
//   INPUTS: { db: NodePgDatabase, logger: Logger, countryCode: string, input: { status: string, tg_chat_ids: string } }
//   OUTPUTS: { Promise<{ success: boolean; errors?: Record<string, string[]> }> }
//   SIDE_EFFECTS: [UPDATE country_settings; emits structured logs]
//   LINKS: [M-ADMIN-COUNTRIES, M-DB, M-LOGGER]
// END_CONTRACT: handleUpdateCountry
export async function handleUpdateCountry(
  db: NodePgDatabase,
  logger: Logger,
  countryCode: string,
  input: { status: string; tg_chat_ids: string },
): Promise<{ success: boolean; errors?: Record<string, string[]> }> {
  const errors: Record<string, string[]> = {};

  if (!input.status || !VALID_STATUSES.includes(input.status as CountryStatus)) {
    errors.status = [`Status must be one of: ${VALID_STATUSES.join(", ")}.`];
  }

  const tgChatIds = parseTgChatIds(input.tg_chat_ids);

  if (Object.keys(errors).length > 0) {
    logger.warn("Update country validation failed.", "handleUpdateCountry", "VALIDATE_COUNTRY", {
      errors,
      countryCode,
    });
    return { success: false, errors };
  }

  try {
    await upsertCountrySettings(db, {
      countryCode,
      status: input.status as CountryStatus,
      settings: { tg_chat_ids: tgChatIds },
    });

    logger.info(
      "Updated country settings.",
      "handleUpdateCountry",
      "UPDATE_COUNTRY",
      { countryCode },
    );

    return { success: true };
  } catch (error: unknown) {
    const countriesError = toAdminCountriesError(error, "Failed to update country.", {
      operation: "handleUpdateCountry",
      countryCode,
    });

    logger.error(
      "Failed to update country.",
      "handleUpdateCountry",
      "UPDATE_COUNTRY",
      { code: countriesError.code, cause: countriesError.details?.cause ?? countriesError.message },
    );

    throw countriesError;
  }
}

// START_CONTRACT: handleDeleteCountry
//   PURPOSE: Delete a country settings row if it has no linked site sources.
//   INPUTS: { db: NodePgDatabase, logger: Logger, countryCode: string }
//   OUTPUTS: { Promise<{ success: boolean; error?: string }> }
//   SIDE_EFFECTS: [DELETE from country_settings; emits structured logs]
//   LINKS: [M-ADMIN-COUNTRIES, M-DB, M-LOGGER]
// END_CONTRACT: handleDeleteCountry
export async function handleDeleteCountry(
  db: NodePgDatabase,
  logger: Logger,
  countryCode: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Check for linked site sources
    const sourceCheck = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM site_sources WHERE country_code = ${countryCode}`,
    );
    const sourceCount = Number((sourceCheck.rows ?? sourceCheck)[0]?.cnt ?? 0);

    if (sourceCount > 0) {
      logger.warn(
        "Cannot delete country with linked sources.",
        "handleDeleteCountry",
        "DELETE_COUNTRY",
        { countryCode, sourceCount },
      );
      return {
        success: false,
        error: `Cannot delete country "${countryCode}" — it has ${sourceCount} linked site source(s). Remove them first.`,
      };
    }

    await deleteCountrySettings(db, countryCode);

    logger.info(
      "Deleted country settings.",
      "handleDeleteCountry",
      "DELETE_COUNTRY",
      { countryCode },
    );

    return { success: true };
  } catch (error: unknown) {
    const countriesError = toAdminCountriesError(error, "Failed to delete country.", {
      operation: "handleDeleteCountry",
      countryCode,
    });

    logger.error(
      "Failed to delete country.",
      "handleDeleteCountry",
      "DELETE_COUNTRY",
      { code: countriesError.code, cause: countriesError.details?.cause ?? countriesError.message },
    );

    throw countriesError;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseTgChatIds(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function formatDate(date: Date | null): string {
  if (date === null) return "--";
  return date.toISOString().replace("T", " ").slice(0, 19);
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function CountriesPageStyles(): string {
  return (
    <style>{`
      .badge { display:inline-block; font-size:0.78rem; font-weight:600; padding:0.15rem 0.55rem; border-radius:999px; }
      .badge-active { background:#dcfce7; color:#166534; }
      .badge-draft { background:#f1f5f9; color:#475569; }
      .badge-coming_soon { background:#dbeafe; color:#1e40af; }
      .badge-maintenance { background:#fefce8; color:#854d0e; }
      .btn { display:inline-block; font-size:0.82rem; font-weight:600; padding:0.35rem 0.7rem; border-radius:0.4rem; border:1px solid transparent; cursor:pointer; text-decoration:none; text-align:center; font-family:inherit; line-height:1.4; }
      .btn-accent { background:var(--accent); color:#fff; }
      .btn-accent:hover { opacity:0.9; }
      .btn-danger { background:var(--danger, #991b1b); color:#fff; }
      .btn-danger:hover { opacity:0.9; }
      .btn-outline { background:transparent; border-color:var(--line); color:var(--fg); }
      .btn-outline:hover { background:#f8fafc; }
      .btn-sm { font-size:0.75rem; padding:0.25rem 0.5rem; }
      .actions-cell { display:flex; gap:0.35rem; align-items:center; flex-wrap:nowrap; }
      .actions-cell form { margin:0; }
      .form-group { display:grid; gap:0.3rem; margin-bottom:0.85rem; }
      .form-group label { font-weight:600; font-size:0.88rem; }
      .form-group input, .form-group select, .form-group textarea { width:100%; padding:0.55rem 0.65rem; border:1px solid var(--line); border-radius:0.4rem; font:inherit; background:#fff; }
      .form-group input:focus, .form-group select:focus, .form-group textarea:focus { outline:2px solid var(--accent); outline-offset:1px; }
      .form-group input[readonly] { background:#f1f5f9; color:#64748b; cursor:not-allowed; }
      .form-group .hint { color:#64748b; font-size:0.82rem; }
      .field-error { color:var(--danger, #991b1b); font-size:0.82rem; }
      .form-actions { display:flex; gap:0.5rem; margin-top:0.5rem; }
      .chat-ids-cell { max-width:18rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.85rem; }
    `}</style>
  ) as string;
}

const STATUS_DISPLAY: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  coming_soon: "Coming Soon",
  maintenance: "Maintenance",
};

function CountryRowItem({ c }: { c: CountryRow }): string {
  const statusClass = `badge-${c.status}`;
  const statusLabel = STATUS_DISPLAY[c.status] ?? c.status;
  const code = Html.escapeHtml(c.country_code);
  const tgChatIds = Array.isArray(c.settings.tg_chat_ids)
    ? (c.settings.tg_chat_ids as string[]).join(", ")
    : "--";

  return (
    <tr>
      <td><code>{code}</code></td>
      <td><span class={`badge ${statusClass}`} safe>{statusLabel}</span></td>
      <td><span class="chat-ids-cell" title={Html.escapeHtml(tgChatIds)} safe>{tgChatIds}</span></td>
      <td>{String(c.source_count)}</td>
      <td>{formatDate(c.created_at)}</td>
      <td>{formatDate(c.updated_at)}</td>
      <td>
        <div class="actions-cell">
          <a href={`/admin/countries/${code}/edit`} class="btn btn-accent btn-sm">Edit</a>
          <form method="post" action={`/admin/countries/${code}/delete`} onsubmit={`return confirm('Delete country ${code}? This cannot be undone.')`}>
            <button type="submit" class="btn btn-danger btn-sm">Delete</button>
          </form>
        </div>
      </td>
    </tr>
  ) as string;
}

function FieldErrors({ errors, field }: { errors?: Record<string, string[]>; field: string }): string {
  if (!errors || !errors[field]) return "";
  return (<>{errors[field].map((msg) => <p class="field-error" safe>{msg}</p>)}</>) as string;
}

// START_CONTRACT: CountriesContent
//   PURPOSE: Render the main countries management page content with countries table and Add Country button.
//   INPUTS: { data: CountriesPageData - Page data model with countries array }
//   OUTPUTS: { string - HTML content fragment for the countries management page }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-COUNTRIES]
// END_CONTRACT: CountriesContent
export function CountriesContent(data: CountriesPageData): string {
  return (
    <>
      <CountriesPageStyles />
      <section id="countries-management" class="stack">
        <section class="card">
          <h2>Countries Management</h2>
          <p class="muted">Manage country destinations, their statuses, and per-country Telegram chat IDs.</p>
        </section>
        <section class="card table-wrap">
          <h3>{`Countries (${data.countries.length})`}</h3>
          <table class="diag-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Status</th>
                <th>TG Chat IDs</th>
                <th>Sources</th>
                <th>Created</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.countries.length > 0
                ? data.countries.map((c) => <CountryRowItem c={c} />)
                : <tr><td colspan="7" class="muted" style="text-align:center;">No countries configured.</td></tr>}
            </tbody>
          </table>
          <div style="margin-top:0.75rem;">
            <a href="/admin/countries/new" class="btn btn-accent">Add Country</a>
          </div>
        </section>
      </section>
    </>
  ) as string;
}

// START_CONTRACT: CountryForm
//   PURPOSE: Render create or edit form for a country with field validation error display.
//   INPUTS: { params: { mode: "create" | "edit", country?: CountryRow, errors?: Record<string, string[]> } }
//   OUTPUTS: { string - HTML content fragment for the country create/edit form }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-COUNTRIES]
// END_CONTRACT: CountryForm
export function CountryForm(params: {
  mode: "create" | "edit";
  country?: CountryRow;
  errors?: Record<string, string[]>;
}): string {
  const { mode, country, errors } = params;
  const isEdit = mode === "edit";
  const title = isEdit ? "Edit Country" : "Add New Country";
  const action = isEdit && country
    ? `/admin/countries/${Html.escapeHtml(country.country_code)}/edit`
    : "/admin/countries";

  const currentStatus = country?.status ?? "draft";
  const statusOptions = VALID_STATUSES.map((s) => {
    const selected = s === currentStatus;
    const label = STATUS_DISPLAY[s] ?? s;
    return <option value={s} selected={selected || undefined} safe>{label}</option>;
  });

  const tgChatIdsValue = country?.settings?.tg_chat_ids
    ? (country.settings.tg_chat_ids as string[]).join("\n")
    : "";

  return (
    <>
      <CountriesPageStyles />
      <section id="country-form" class="stack">
        <section class="card">
          <h2 safe>{title}</h2>
          {isEdit && country
            ? <p class="muted">Editing country <code safe>{country.country_code}</code>.</p>
            : <p class="muted">Add a new country destination with its configuration.</p>}
        </section>
        <section class="card">
          <form method="post" action={action}>
            <div class="form-group">
              <label for="country_code">Country Code</label>
              {isEdit
                ? <input type="text" id="country_code" name="country_code" value={Html.escapeHtml(country?.country_code ?? "")} readonly />
                : <input type="text" id="country_code" name="country_code" value="" required placeholder="e.g. jp, it, cn" pattern="^[a-z]{'{'}2{'}'}$" maxlength="2" />}
              <p class="hint">ISO 3166-1 alpha-2 code (2 lowercase letters).</p>
              <FieldErrors errors={errors} field="country_code" />
            </div>

            <div class="form-group">
              <label for="status">Status</label>
              <select id="status" name="status" required>
                {statusOptions}
              </select>
              <p class="hint">draft = hidden, active = live for tool calls, coming_soon = teaser, maintenance = temporarily down.</p>
              <FieldErrors errors={errors} field="status" />
            </div>

            <div class="form-group">
              <label for="tg_chat_ids">Telegram Chat IDs</label>
              <textarea id="tg_chat_ids" name="tg_chat_ids" rows="4" placeholder="One chat ID per line" safe>{tgChatIdsValue}</textarea>
              <p class="hint">One Telegram chat ID per line. Used by search_messages tool to filter upstream queries.</p>
              <FieldErrors errors={errors} field="tg_chat_ids" />
            </div>

            <div class="form-actions">
              <button type="submit" class="btn btn-accent">{isEdit ? "Save Changes" : "Create Country"}</button>
              <a href="/admin/countries" class="btn btn-outline">Cancel</a>
            </div>
          </form>
        </section>
      </section>
    </>
  ) as string;
}
