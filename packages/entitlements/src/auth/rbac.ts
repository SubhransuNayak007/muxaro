/**
 * @file rbac.ts
 * Role-Based Access Control (RBAC) permissions matrix and role hierarchies
 */

import type { UserRole, Permission, PlanTier } from '../types.js';
import { ForbiddenError } from '../errors.js';

/**
 * Numeric role levels for inheritance comparison
 */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  anonymous: 0,
  free: 10,
  pro: 20,
  admin: 100,
};

/**
 * Granular permissions granted to each specific role
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  anonymous: ['jobs:read', 'quota:read'],
  free: [
    'jobs:read',
    'quota:read',
    'jobs:create:video',
    'jobs:create:playlist',
    'jobs:create:merge',
    'jobs:create:audio',
    'jobs:cancel',
    'credits:read',
  ],
  pro: [
    'jobs:read',
    'quota:read',
    'jobs:create:video',
    'jobs:create:playlist',
    'jobs:create:merge',
    'jobs:create:audio',
    'jobs:cancel',
    'credits:read',
    'credits:purchase',
  ],
  admin: [
    'jobs:read',
    'quota:read',
    'jobs:create:video',
    'jobs:create:playlist',
    'jobs:create:merge',
    'jobs:create:audio',
    'jobs:cancel',
    'credits:read',
    'credits:purchase',
    'admin:metrics',
    'admin:override_quota',
    'admin:users:manage',
    'admin:ledger:view_all',
  ],
};

/**
 * Check if a role has the specified permission.
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions.includes(permission);
}

/**
 * Assert that a role has the specified permission, throwing ForbiddenError if not.
 */
export function requirePermission(role: UserRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new ForbiddenError(`Role '${role}' lacks permission '${permission}'`, {
      requiredPermission: permission,
      requiredRole: role,
    });
  }
}

/**
 * Check if user's role meets or exceeds a target role level.
 */
export function isRoleAtLeast(userRole: UserRole, minimumRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minimumRole];
}

/**
 * Assert that user's role meets or exceeds a target role level.
 */
export function requireRole(userRole: UserRole, minimumRole: UserRole): void {
  if (!isRoleAtLeast(userRole, minimumRole)) {
    throw new ForbiddenError(`Action requires at least '${minimumRole}' role; user has '${userRole}'`, {
      requiredRole: minimumRole,
    });
  }
}

/**
 * Map role to default plan tier.
 */
export function getDefaultTierForRole(role: UserRole): PlanTier {
  switch (role) {
    case 'admin':
      return 'enterprise';
    case 'pro':
      return 'pro';
    case 'free':
    case 'anonymous':
    default:
      return 'free';
  }
}
