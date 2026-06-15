import { insertRow, selectOne } from './db.ts';
import { HttpError, z } from './http.ts';
import type { ReferralSelfProvisionRequest, ReferralSelfProvisionResponse, ReferrerRow, TenantRow } from './types.ts';

export type TenantMemberRecord = {
  role: string;
};

type ProfileRecord = {
  display_name: string | null;
};

export type ReferralSelfProvisionContext = {
  authEmail: string | null;
  authUserId: string;
  tenant: TenantRow;
};

export type ReferralSelfProvisionDeps = {
  insertReferrer: (tenantId: string, authUserId: string, name: string) => Promise<ReferrerRow>;
  loadExistingReferrer: (tenantId: string, authUserId: string) => Promise<ReferrerRow | null>;
  loadMember: (tenantId: string, authUserId: string) => Promise<TenantMemberRecord | null>;
  loadProfileName: (authUserId: string) => Promise<string | null>;
};

const tenantSlugSchema = z.string().trim().min(2).max(64).regex(/^[a-z0-9-]+$/);

export const referralSelfProvisionRequestSchema = z.object({
  tenant_slug: tenantSlugSchema,
}) satisfies z.ZodType<ReferralSelfProvisionRequest>;

export function deriveSelfProvisionName(profileName: string | null, authEmail: string | null) {
  const compactProfileName = profileName?.replace(/\s+/g, ' ').trim();

  if (compactProfileName) {
    return compactProfileName;
  }

  const emailHandle = authEmail?.split('@')[0]?.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();

  return emailHandle || 'Staff referrer';
}

function toResponse(referrer: ReferrerRow, created: boolean): ReferralSelfProvisionResponse {
  return {
    created,
    ref_code: referrer.ref_code,
    referrer_id: referrer.id,
  };
}

export async function handleReferralSelfProvision(
  _request: ReferralSelfProvisionRequest,
  context: ReferralSelfProvisionContext,
  deps: ReferralSelfProvisionDeps,
): Promise<ReferralSelfProvisionResponse> {
  const member = await deps.loadMember(context.tenant.id, context.authUserId);

  if (!member) {
    throw new HttpError('VALIDATION', 'Only tenant members can create their own referral code.', 403);
  }

  const existing = await deps.loadExistingReferrer(context.tenant.id, context.authUserId);

  if (existing) {
    return toResponse(existing, false);
  }

  const profileName = await deps.loadProfileName(context.authUserId);
  const name = deriveSelfProvisionName(profileName, context.authEmail);
  const referrer = await deps.insertReferrer(context.tenant.id, context.authUserId, name);

  return toResponse(referrer, true);
}

async function loadMember(tenantId: string, authUserId: string) {
  return selectOne<TenantMemberRecord>('tenant_members', {
    auth_user_id: `eq.${authUserId}`,
    select: 'role',
    tenant_id: `eq.${tenantId}`,
  });
}

async function loadExistingReferrer(tenantId: string, authUserId: string) {
  return selectOne<ReferrerRow>('referrers', {
    auth_user_id: `eq.${authUserId}`,
    order: 'created_at.asc',
    select: 'id,tenant_id,ref_code,name,type,phone,auth_user_id,commission_scheme,active,created_at',
    tenant_id: `eq.${tenantId}`,
  });
}

async function loadProfileName(authUserId: string) {
  const profile = await selectOne<ProfileRecord>('profiles', {
    id: `eq.${authUserId}`,
    select: 'display_name',
  });

  return profile?.display_name ?? null;
}

async function insertReferrer(tenantId: string, authUserId: string, name: string) {
  return insertRow<ReferrerRow>('referrers', {
    active: true,
    auth_user_id: authUserId,
    name,
    tenant_id: tenantId,
    type: 'staff',
  }, {
    select: 'id,tenant_id,ref_code,name,type,phone,auth_user_id,commission_scheme,active,created_at',
  });
}

export const referralSelfProvisionDeps: ReferralSelfProvisionDeps = {
  insertReferrer,
  loadExistingReferrer,
  loadMember,
  loadProfileName,
};
