import { assertTenant, rest, selectMany, updateRows, upsertRow } from './db.ts';
import { HttpError, z } from './http.ts';
import type { AdminMemberRow, AdminMembersRequest, AdminMembersResponse, AdminMemberRole, TenantRow } from './types.ts';

type RuntimeDeno = {
  env: {
    get: (key: string) => string | undefined;
  };
};

export type TenantMemberRecord = {
  auth_user_id: string;
  role: AdminMemberRole;
  tenant_id: string;
};

type ProfileNameRecord = {
  display_name: string | null;
  id: string;
};

export type AuthAdminUser = {
  email: string | null;
  id: string;
  name: string | null;
};

export type AdminMembersContext = {
  authUserId: string;
  tenant: TenantRow;
};

export type AdminMembersDeps = {
  findAuthUserByEmail: (email: string) => Promise<AuthAdminUser | null>;
  getAuthUsersById: (authUserIds: string[]) => Promise<Map<string, AuthAdminUser>>;
  getProfileNamesById: (authUserIds: string[]) => Promise<Map<string, string>>;
  listTenantMembers: (tenantId: string) => Promise<TenantMemberRecord[]>;
  removeTenantMember: (tenantId: string, authUserId: string) => Promise<void>;
  updateTenantMemberRole: (tenantId: string, authUserId: string, role: AdminAssignableMemberRole) => Promise<TenantMemberRecord | null>;
  upsertTenantMember: (tenantId: string, authUserId: string, role: AdminAssignableMemberRole) => Promise<TenantMemberRecord>;
};

const tenantSlugSchema = z.string().trim().min(2).max(64).regex(/^[a-z0-9-]+$/);

export const adminAssignableMemberRoles = ['tenant_staff', 'tenant_admin'] as const;
export type AdminAssignableMemberRole = (typeof adminAssignableMemberRoles)[number];

export const adminMembersRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('list'),
    tenant_slug: tenantSlugSchema,
  }),
  z.object({
    action: z.literal('add'),
    email: z.string().trim().email().max(320),
    role: z.enum(adminAssignableMemberRoles),
    tenant_slug: tenantSlugSchema,
  }),
  z.object({
    action: z.literal('set_role'),
    auth_user_id: z.string().uuid(),
    role: z.enum(adminAssignableMemberRoles),
    tenant_slug: tenantSlugSchema,
  }),
  z.object({
    action: z.literal('remove'),
    auth_user_id: z.string().uuid(),
    tenant_slug: tenantSlugSchema,
  }),
]) satisfies z.ZodType<AdminMembersRequest>;

function readEnv(key: string) {
  const runtime = globalThis as typeof globalThis & { Deno?: RuntimeDeno };

  return runtime.Deno?.env.get(key);
}

function authAdminConfig() {
  const supabaseUrl = readEnv('SUPABASE_URL');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new HttpError('UPSTREAM', 'Missing Supabase service configuration.', 500);
  }

  return {
    serviceRoleKey,
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
  };
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function authAdminFetch(path: string) {
  const { serviceRoleKey, supabaseUrl } = authAdminConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/${path.replace(/^\//, '')}`, {
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
  });
  const payload = await parseResponse(response);

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'message' in payload && typeof (payload as { message?: unknown }).message === 'string'
        ? (payload as { message: string }).message
        : `Supabase Auth Admin request failed with ${response.status}.`;

    throw new HttpError('UPSTREAM', detail, response.status);
  }

  return payload;
}

function parseAuthAdminUser(value: unknown): AuthAdminUser | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== 'string') {
    return null;
  }

  const metadata = record.user_metadata && typeof record.user_metadata === 'object' && !Array.isArray(record.user_metadata)
    ? record.user_metadata as Record<string, unknown>
    : {};
  const displayName =
    typeof metadata.display_name === 'string'
      ? metadata.display_name
      : typeof metadata.full_name === 'string'
        ? metadata.full_name
        : typeof metadata.name === 'string'
          ? metadata.name
          : null;

  return {
    email: typeof record.email === 'string' ? record.email : null,
    id: record.id,
    name: displayName,
  };
}

function parseAuthAdminUsers(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload.map(parseAuthAdminUser).filter((user): user is AuthAdminUser => Boolean(user));
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const users = (payload as { users?: unknown }).users;

  if (!Array.isArray(users)) {
    return [];
  }

  return users.map(parseAuthAdminUser).filter((user): user is AuthAdminUser => Boolean(user));
}

async function getAuthUserById(authUserId: string) {
  let payload: unknown;

  try {
    payload = await authAdminFetch(`admin/users/${encodeURIComponent(authUserId)}`);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return null;
    }

    throw error;
  }

  return parseAuthAdminUser(payload);
}

async function findAuthUserByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const perPage = 1000;

  for (let page = 1; page <= 10; page += 1) {
    const payload = await authAdminFetch(`admin/users?page=${page}&per_page=${perPage}`);
    const users = parseAuthAdminUsers(payload);
    const found = users.find((user) => user.email?.toLowerCase() === normalizedEmail);

    if (found) {
      return found;
    }

    if (users.length < perPage) {
      return null;
    }
  }

  return null;
}

async function getAuthUsersById(authUserIds: string[]) {
  const users = new Map<string, AuthAdminUser>();

  await Promise.all(authUserIds.map(async (authUserId) => {
    const user = await getAuthUserById(authUserId);

    if (user) {
      users.set(user.id, user);
    }
  }));

  return users;
}

async function getProfileNamesById(authUserIds: string[]) {
  const names = new Map<string, string>();

  if (authUserIds.length === 0) {
    return names;
  }

  const rows = await selectMany<ProfileNameRecord>('profiles', {
    id: `in.(${authUserIds.join(',')})`,
    select: 'id,display_name',
  });

  for (const row of rows) {
    if (row.display_name) {
      names.set(row.id, row.display_name);
    }
  }

  return names;
}

function isAdminRole(role: AdminMemberRole) {
  return role === 'superadmin' || role === 'tenant_admin';
}

function sortMemberRows(a: AdminMemberRow, b: AdminMemberRow) {
  const roleRank: Record<AdminMemberRole, number> = {
    superadmin: 0,
    tenant_admin: 1,
    tenant_staff: 2,
  };

  return roleRank[a.role] - roleRank[b.role] || (a.name ?? a.email ?? a.auth_user_id).localeCompare(b.name ?? b.email ?? b.auth_user_id);
}

export function requireAdminMembership(members: TenantMemberRecord[], authUserId: string) {
  const membership = members.find((member) => member.auth_user_id === authUserId);

  if (!membership || !isAdminRole(membership.role)) {
    throw new HttpError('VALIDATION', 'Only tenant admins can manage members for this tenant.', 403);
  }

  return membership;
}

function assertTargetExists(members: TenantMemberRecord[], authUserId: string) {
  const target = members.find((member) => member.auth_user_id === authUserId);

  if (!target) {
    throw new HttpError('NOT_FOUND', 'Tenant member not found.', 404);
  }

  return target;
}

export function assertCanReduceAdmin(members: TenantMemberRecord[], target: TenantMemberRecord) {
  if (!isAdminRole(target.role)) {
    return;
  }

  const adminCount = members.filter((member) => isAdminRole(member.role)).length;

  if (adminCount <= 1) {
    throw new HttpError('LAST_ADMIN', 'This tenant must keep at least one admin.', 409);
  }
}

async function buildMembersResponse(deps: AdminMembersDeps, tenantId: string): Promise<AdminMembersResponse> {
  const members = await deps.listTenantMembers(tenantId);
  const authUserIds = members.map((member) => member.auth_user_id);
  const [authUsers, profileNames] = await Promise.all([
    deps.getAuthUsersById(authUserIds),
    deps.getProfileNamesById(authUserIds),
  ]);
  const rows = members.map<AdminMemberRow>((member) => {
    const authUser = authUsers.get(member.auth_user_id) ?? null;

    return {
      auth_user_id: member.auth_user_id,
      email: authUser?.email ?? null,
      name: profileNames.get(member.auth_user_id) ?? authUser?.name ?? null,
      role: member.role,
    };
  }).sort(sortMemberRows);

  return { members: rows };
}

export async function handleAdminMembersRequest(
  request: AdminMembersRequest,
  context: AdminMembersContext,
  deps: AdminMembersDeps,
): Promise<AdminMembersResponse> {
  const members = await deps.listTenantMembers(context.tenant.id);

  requireAdminMembership(members, context.authUserId);

  if (request.action === 'list') {
    return buildMembersResponse(deps, context.tenant.id);
  }

  if (request.action === 'add') {
    const user = await deps.findAuthUserByEmail(request.email);

    if (!user) {
      throw new HttpError('USER_NOT_FOUND', 'User must sign up before they can be added to this tenant.', 404);
    }

    await deps.upsertTenantMember(context.tenant.id, user.id, request.role);

    return buildMembersResponse(deps, context.tenant.id);
  }

  if (request.action === 'set_role') {
    const target = assertTargetExists(members, request.auth_user_id);

    if (target.role !== request.role && isAdminRole(target.role) && !isAdminRole(request.role)) {
      assertCanReduceAdmin(members, target);
    }

    await deps.updateTenantMemberRole(context.tenant.id, request.auth_user_id, request.role);

    return buildMembersResponse(deps, context.tenant.id);
  }

  const target = assertTargetExists(members, request.auth_user_id);

  assertCanReduceAdmin(members, target);
  await deps.removeTenantMember(context.tenant.id, request.auth_user_id);

  return {
    ...(await buildMembersResponse(deps, context.tenant.id)),
    removed_auth_user_id: request.auth_user_id,
  };
}

async function listTenantMembers(tenantId: string) {
  return selectMany<TenantMemberRecord>('tenant_members', {
    order: 'role.asc',
    select: 'tenant_id,auth_user_id,role',
    tenant_id: `eq.${tenantId}`,
  });
}

async function upsertTenantMember(tenantId: string, authUserId: string, role: AdminAssignableMemberRole) {
  return upsertRow<TenantMemberRecord>(
    'tenant_members',
    {
      auth_user_id: authUserId,
      role,
      tenant_id: tenantId,
    },
    'tenant_id,auth_user_id',
    {
      select: 'tenant_id,auth_user_id,role',
    },
  );
}

async function updateTenantMemberRole(tenantId: string, authUserId: string, role: AdminAssignableMemberRole) {
  const rows = await updateRows<TenantMemberRecord>('tenant_members', {
    role,
  }, {
    auth_user_id: `eq.${authUserId}`,
    select: 'tenant_id,auth_user_id,role',
    tenant_id: `eq.${tenantId}`,
  });

  return rows[0] ?? null;
}

async function removeTenantMember(tenantId: string, authUserId: string) {
  await rest<null>(`tenant_members?tenant_id=eq.${encodeURIComponent(tenantId)}&auth_user_id=eq.${encodeURIComponent(authUserId)}`, {
    method: 'DELETE',
  });
}

export const adminMembersDeps: AdminMembersDeps = {
  findAuthUserByEmail,
  getAuthUsersById,
  getProfileNamesById,
  listTenantMembers,
  removeTenantMember,
  updateTenantMemberRole,
  upsertTenantMember,
};

export async function loadAdminMembersContext(tenantSlug: string, authUserId: string): Promise<AdminMembersContext> {
  return {
    authUserId,
    tenant: await assertTenant(tenantSlug),
  };
}
