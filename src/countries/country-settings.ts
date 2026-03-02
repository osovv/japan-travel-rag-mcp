// FILE: src/countries/country-settings.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Manage country_settings table CRUD and provide in-memory cache of active countries for tool schema construction and runtime routing.
//   SCOPE: Repository functions for get/list/upsert country settings and startup cache builder.
//   DEPENDS: M-DB, M-DB-SCHEMA, M-LOGGER
//   LINKS: M-COUNTRY-SETTINGS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   CountryStatus - String union: 'draft' | 'active' | 'coming_soon' | 'maintenance'.
//   CountrySettings - Country config record type.
//   CountryCache - In-memory Map<string, CountrySettings> for fast runtime lookups.
//   CountrySettingsError - Typed error with COUNTRY_SETTINGS_ERROR code.
//   getCountrySettings - Get single country by code; returns null if not found.
//   getAllCountrySettings - List all countries regardless of status.
//   deleteCountrySettings - Delete a country settings row by country code.
//   getCountriesByStatus - List countries filtered by status.
//   upsertCountrySettings - Create or update country settings row.
//   buildCountryCache - Load active countries into Map for startup.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation for M-COUNTRY-SETTINGS (Phase 13, Step 1).
// END_CHANGE_SUMMARY

import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "../logger/index";
import { countrySettingsTable } from "../db/schema";

// START_BLOCK_DEFINE_TYPES_M_COUNTRY_SETTINGS_001
export type CountryStatus = "draft" | "active" | "coming_soon" | "maintenance";

export type CountrySettings = {
  countryCode: string;
  status: CountryStatus;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type CountryCache = Map<string, CountrySettings>;
// END_BLOCK_DEFINE_TYPES_M_COUNTRY_SETTINGS_001

// START_BLOCK_DEFINE_ERROR_CLASS_M_COUNTRY_SETTINGS_002
export class CountrySettingsError extends Error {
  public readonly code = "COUNTRY_SETTINGS_ERROR" as const;

  public constructor(message: string) {
    super(message);
    this.name = "CountrySettingsError";
  }
}
// END_BLOCK_DEFINE_ERROR_CLASS_M_COUNTRY_SETTINGS_002

// START_CONTRACT: getCountrySettings
//   PURPOSE: Get single country settings by country code; returns null if not found.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, countryCode: string - ISO country code }
//   OUTPUTS: { Promise<CountrySettings | null> }
//   SIDE_EFFECTS: [Reads from country_settings table]
//   LINKS: [M-COUNTRY-SETTINGS, M-DB]
// END_CONTRACT: getCountrySettings
export async function getCountrySettings(
  db: NodePgDatabase,
  countryCode: string,
): Promise<CountrySettings | null> {
  // START_BLOCK_GET_COUNTRY_SETTINGS_M_COUNTRY_SETTINGS_003
  try {
    const rows = await db
      .select()
      .from(countrySettingsTable)
      .where(eq(countrySettingsTable.countryCode, countryCode));

    const row = rows[0];
    if (!row) return null;

    return {
      countryCode: row.countryCode,
      status: row.status as CountryStatus,
      settings: (row.settings ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  } catch (error: unknown) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new CountrySettingsError(`Failed to get country settings for ${countryCode}: ${cause}`);
  }
  // END_BLOCK_GET_COUNTRY_SETTINGS_M_COUNTRY_SETTINGS_003
}

// START_CONTRACT: getAllCountrySettings
//   PURPOSE: List all countries regardless of status, ordered by country_code.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle }
//   OUTPUTS: { Promise<CountrySettings[]> }
//   SIDE_EFFECTS: [Reads from country_settings table]
//   LINKS: [M-COUNTRY-SETTINGS, M-DB]
// END_CONTRACT: getAllCountrySettings
export async function getAllCountrySettings(
  db: NodePgDatabase,
): Promise<CountrySettings[]> {
  // START_BLOCK_GET_ALL_COUNTRY_SETTINGS_M_COUNTRY_SETTINGS_007
  try {
    const rows = await db
      .select()
      .from(countrySettingsTable)
      .orderBy(countrySettingsTable.countryCode);

    return rows.map((row) => ({
      countryCode: row.countryCode,
      status: row.status as CountryStatus,
      settings: (row.settings ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  } catch (error: unknown) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new CountrySettingsError(`Failed to get all country settings: ${cause}`);
  }
  // END_BLOCK_GET_ALL_COUNTRY_SETTINGS_M_COUNTRY_SETTINGS_007
}

// START_CONTRACT: deleteCountrySettings
//   PURPOSE: Delete a country settings row by country code.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, countryCode: string - ISO country code to delete }
//   OUTPUTS: { Promise<void> }
//   SIDE_EFFECTS: [Deletes from country_settings table]
//   LINKS: [M-COUNTRY-SETTINGS, M-DB]
// END_CONTRACT: deleteCountrySettings
export async function deleteCountrySettings(
  db: NodePgDatabase,
  countryCode: string,
): Promise<void> {
  // START_BLOCK_DELETE_COUNTRY_SETTINGS_M_COUNTRY_SETTINGS_008
  try {
    await db
      .delete(countrySettingsTable)
      .where(eq(countrySettingsTable.countryCode, countryCode));
  } catch (error: unknown) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new CountrySettingsError(`Failed to delete country settings for ${countryCode}: ${cause}`);
  }
  // END_BLOCK_DELETE_COUNTRY_SETTINGS_M_COUNTRY_SETTINGS_008
}

// START_CONTRACT: getCountriesByStatus
//   PURPOSE: List all countries filtered by a given status.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, status: CountryStatus - Status to filter by }
//   OUTPUTS: { Promise<CountrySettings[]> }
//   SIDE_EFFECTS: [Reads from country_settings table]
//   LINKS: [M-COUNTRY-SETTINGS, M-DB]
// END_CONTRACT: getCountriesByStatus
export async function getCountriesByStatus(
  db: NodePgDatabase,
  status: CountryStatus,
): Promise<CountrySettings[]> {
  // START_BLOCK_GET_COUNTRIES_BY_STATUS_M_COUNTRY_SETTINGS_004
  try {
    const rows = await db
      .select()
      .from(countrySettingsTable)
      .where(eq(countrySettingsTable.status, status));

    return rows.map((row) => ({
      countryCode: row.countryCode,
      status: row.status as CountryStatus,
      settings: (row.settings ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  } catch (error: unknown) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new CountrySettingsError(`Failed to get countries by status ${status}: ${cause}`);
  }
  // END_BLOCK_GET_COUNTRIES_BY_STATUS_M_COUNTRY_SETTINGS_004
}

// START_CONTRACT: upsertCountrySettings
//   PURPOSE: Create or update a country settings row using ON CONFLICT upsert.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, data: { countryCode: string, status: CountryStatus, settings: Record<string, unknown> } }
//   OUTPUTS: { Promise<void> }
//   SIDE_EFFECTS: [Writes to country_settings table]
//   LINKS: [M-COUNTRY-SETTINGS, M-DB]
// END_CONTRACT: upsertCountrySettings
export async function upsertCountrySettings(
  db: NodePgDatabase,
  data: { countryCode: string; status: CountryStatus; settings: Record<string, unknown> },
): Promise<void> {
  // START_BLOCK_UPSERT_COUNTRY_SETTINGS_M_COUNTRY_SETTINGS_005
  try {
    await db
      .insert(countrySettingsTable)
      .values({
        countryCode: data.countryCode,
        status: data.status,
        settings: data.settings,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: countrySettingsTable.countryCode,
        set: {
          status: data.status,
          settings: data.settings,
          updatedAt: new Date(),
        },
      });
  } catch (error: unknown) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new CountrySettingsError(`Failed to upsert country settings for ${data.countryCode}: ${cause}`);
  }
  // END_BLOCK_UPSERT_COUNTRY_SETTINGS_M_COUNTRY_SETTINGS_005
}

// START_CONTRACT: buildCountryCache
//   PURPOSE: Load all active countries into an in-memory Map for fast runtime lookups at startup.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, logger: Logger - Module logger }
//   OUTPUTS: { Promise<CountryCache> - Map of countryCode to CountrySettings }
//   SIDE_EFFECTS: [Reads from country_settings table, logs cache build status]
//   LINKS: [M-COUNTRY-SETTINGS, M-DB, M-LOGGER]
// END_CONTRACT: buildCountryCache
export async function buildCountryCache(
  db: NodePgDatabase,
  logger: Logger,
): Promise<CountryCache> {
  // START_BLOCK_BUILD_COUNTRY_CACHE_M_COUNTRY_SETTINGS_006
  try {
    const activeCountries = await getCountriesByStatus(db, "active");
    const cache: CountryCache = new Map();
    for (const country of activeCountries) {
      cache.set(country.countryCode, country);
    }
    logger.info(
      `Country cache built with ${cache.size} active countries: [${Array.from(cache.keys()).join(", ")}]`,
      "buildCountryCache",
      "BUILD_COUNTRY_CACHE",
    );
    return cache;
  } catch (error: unknown) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new CountrySettingsError(`Failed to build country cache: ${cause}`);
  }
  // END_BLOCK_BUILD_COUNTRY_CACHE_M_COUNTRY_SETTINGS_006
}
