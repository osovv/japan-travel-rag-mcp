// FILE: src/portal/provisioning.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Coordinate first-login provisioning to guarantee tester MCP access entitlements are assigned automatically.
//   SCOPE: Invoke M-PORTAL-IDENTITY role assignment and produce deterministic provisioning result for portal callback flow.
//   DEPENDS: M-PORTAL-IDENTITY, M-LOGGER
//   LINKS: M-PORTAL-PROVISIONING, M-PORTAL-IDENTITY, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ProvisioningError - Typed provisioning failure with PROVISIONING_ERROR code.
//   ProvisioningResult - Result envelope for provisioning outcome.
//   provisionTesterAccess - Ensure identity-provider role/policy grants for MCP testing access are present.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation from development plan for M-PORTAL-PROVISIONING.
// END_CHANGE_SUMMARY

import type { Logger } from "../logger/index";
import type { PortalIdentityClient } from "./identity-client";

export class ProvisioningError extends Error {
  public readonly code = "PROVISIONING_ERROR" as const;
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ProvisioningError";
    this.details = details;
  }
}

export type ProvisioningResult = {
  provisioned: boolean;
  roleId: string;
  userId: string;
};

// START_CONTRACT: provisionTesterAccess
//   PURPOSE: Ensure identity-provider role/policy grants for MCP testing access are present for the given portal user.
//   INPUTS: { userId: string - Logto user ID from portal identity resolution, identityClient: PortalIdentityClient - Identity client from M-PORTAL-IDENTITY, logger: Logger - Structured logger }
//   OUTPUTS: { Promise<ProvisioningResult> - Whether provisioning succeeded with role and user IDs }
//   SIDE_EFFECTS: [Calls Logto Management API via identity client, writes structured logs]
//   LINKS: [M-PORTAL-PROVISIONING, M-PORTAL-IDENTITY, M-LOGGER]
// END_CONTRACT: provisionTesterAccess
export async function provisionTesterAccess(
  userId: string,
  identityClient: PortalIdentityClient,
  logger: Logger,
): Promise<ProvisioningResult> {
  // START_BLOCK_VALIDATE_USER_ID_FOR_PROVISIONING_M_PORTAL_PROVISIONING_001
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) {
    throw new ProvisioningError("userId must be a non-empty string for provisioning.", {
      field: "userId",
    });
  }
  // END_BLOCK_VALIDATE_USER_ID_FOR_PROVISIONING_M_PORTAL_PROVISIONING_001

  // START_BLOCK_INVOKE_IDENTITY_CLIENT_ROLE_ASSIGNMENT_M_PORTAL_PROVISIONING_002
  try {
    logger.info(
      "Starting MCP tester access provisioning.",
      "provisionTesterAccess",
      "INVOKE_IDENTITY_CLIENT_ROLE_ASSIGNMENT",
      { userId: trimmedUserId },
    );

    const roleResult = await identityClient.ensureMcpAccessRole(trimmedUserId);

    logger.info(
      "MCP tester access provisioning completed.",
      "provisionTesterAccess",
      "INVOKE_IDENTITY_CLIENT_ROLE_ASSIGNMENT",
      {
        userId: trimmedUserId,
        provisioned: roleResult.provisioned,
        roleId: roleResult.roleId,
      },
    );

    return {
      provisioned: roleResult.provisioned,
      roleId: roleResult.roleId,
      userId: trimmedUserId,
    };
  } catch (error: unknown) {
    if (error instanceof ProvisioningError) {
      throw error;
    }

    const cause = error instanceof Error ? error.message : String(error);
    throw new ProvisioningError("Failed to provision MCP tester access.", {
      userId: trimmedUserId,
      cause,
    });
  }
  // END_BLOCK_INVOKE_IDENTITY_CLIENT_ROLE_ASSIGNMENT_M_PORTAL_PROVISIONING_002
}
