import { handleAdminMembersRequest } from '../adminMembers.ts';
import { HttpError } from '../http.ts';
import type { AdminMembersDeps, AuthAdminUser, TenantMemberRecord } from '../adminMembers.ts';
import type { AdminMemberAssignableRole, AdminMembersRequest, TenantRow } from '../types.ts';

declare const Deno: {
  test: (name: string, fn: () => void | Promise<void>) => void;
};

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertHttpError(fn: () => Promise<unknown>, code: string, status: number) {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof HttpError)) {
      throw new Error('Expected HttpError.');
    }

    assertEquals(error.code, code);
    assertEquals(error.status, status);
    return;
  }

  throw new Error('Expected request to fail.');
}

const tenant: TenantRow = {
  attribution_window_days: 30,
  display_name: 'Mira Hospital',
  features: {},
  id: 'tenant-1',
  logo_url: null,
  promptpay_id: null,
  slug: 'mira',
};

function createDeps(initialMembers: TenantMemberRecord[] = []) {
  const members = new Map<string, TenantMemberRecord>();
  const authUsers = new Map<string, AuthAdminUser>([
    ['admin-1', { email: 'admin@example.com', id: 'admin-1', name: 'Admin One' }],
    ['staff-1', { email: 'staff@example.com', id: 'staff-1', name: 'Staff One' }],
    ['doctor-1', { email: 'doctor@example.com', id: 'doctor-1', name: 'Doctor One' }],
  ]);
  const profileNames = new Map<string, string>([
    ['admin-1', 'Admin Profile'],
    ['doctor-1', 'Doctor Profile'],
  ]);

  for (const member of initialMembers) {
    members.set(member.auth_user_id, { ...member });
  }

  const deps: AdminMembersDeps = {
    findAuthUserByEmail: async (email: string) => {
      const normalized = email.toLowerCase();

      return [...authUsers.values()].find((user) => user.email?.toLowerCase() === normalized) ?? null;
    },
    getAuthUsersById: async (authUserIds: string[]) => {
      const found = new Map<string, AuthAdminUser>();

      for (const authUserId of authUserIds) {
        const user = authUsers.get(authUserId);

        if (user) {
          found.set(authUserId, user);
        }
      }

      return found;
    },
    getProfileNamesById: async (authUserIds: string[]) => {
      const found = new Map<string, string>();

      for (const authUserId of authUserIds) {
        const name = profileNames.get(authUserId);

        if (name) {
          found.set(authUserId, name);
        }
      }

      return found;
    },
    listTenantMembers: async () => [...members.values()].map((member) => ({ ...member })),
    removeTenantMember: async (_tenantId: string, authUserId: string) => {
      members.delete(authUserId);
    },
    updateTenantMemberRole: async (_tenantId: string, authUserId: string, role: AdminMemberAssignableRole) => {
      const member = members.get(authUserId);

      if (!member) {
        return null;
      }

      const updated = { ...member, role };
      members.set(authUserId, updated);

      return updated;
    },
    upsertTenantMember: async (tenantId: string, authUserId: string, role: AdminMemberAssignableRole) => {
      const updated = {
        auth_user_id: authUserId,
        role,
        tenant_id: tenantId,
      };

      members.set(authUserId, updated);

      return updated;
    },
  };

  return {
    deps,
    members,
  };
}

function member(authUserId: string, role: TenantMemberRecord['role']): TenantMemberRecord {
  return {
    auth_user_id: authUserId,
    role,
    tenant_id: tenant.id,
  };
}

async function run(request: AdminMembersRequest, authUserId: string, deps: AdminMembersDeps) {
  return handleAdminMembersRequest(request, { authUserId, tenant }, deps);
}

Deno.test('admin-members rejects non-admin tenant members', async () => {
  const { deps } = createDeps([member('staff-1', 'tenant_staff')]);

  await assertHttpError(
    () => run({ action: 'list', tenant_slug: tenant.slug }, 'staff-1', deps),
    'VALIDATION',
    403,
  );
});

Deno.test('admin-members add by email is idempotent and returns enriched rows', async () => {
  const { deps, members } = createDeps([member('admin-1', 'tenant_admin')]);
  const request: AdminMembersRequest = {
    action: 'add',
    email: 'doctor@example.com',
    role: 'tenant_staff',
    tenant_slug: tenant.slug,
  };

  const first = await run(request, 'admin-1', deps);
  const second = await run(request, 'admin-1', deps);

  assertEquals(members.size, 2);
  assertEquals(first.members.length, 2);
  assertEquals(second.members.length, 2);
  assert(second.members.some((row) => row.email === 'doctor@example.com' && row.name === 'Doctor Profile'), 'expected enriched doctor row');
});

Deno.test('admin-members add returns 404 when email has no signed-up auth user', async () => {
  const { deps } = createDeps([member('admin-1', 'tenant_admin')]);

  await assertHttpError(
    () => run({
      action: 'add',
      email: 'missing@example.com',
      role: 'tenant_staff',
      tenant_slug: tenant.slug,
    }, 'admin-1', deps),
    'USER_NOT_FOUND',
    404,
  );
});

Deno.test('admin-members blocks removing or demoting the last admin', async () => {
  const { deps } = createDeps([member('admin-1', 'tenant_admin'), member('staff-1', 'tenant_staff')]);

  await assertHttpError(
    () => run({ action: 'remove', auth_user_id: 'admin-1', tenant_slug: tenant.slug }, 'admin-1', deps),
    'LAST_ADMIN',
    409,
  );
  await assertHttpError(
    () => run({ action: 'set_role', auth_user_id: 'admin-1', role: 'tenant_staff', tenant_slug: tenant.slug }, 'admin-1', deps),
    'LAST_ADMIN',
    409,
  );
});

Deno.test('admin-members allows removing an admin when another admin remains', async () => {
  const { deps, members } = createDeps([
    member('admin-1', 'tenant_admin'),
    member('doctor-1', 'tenant_admin'),
  ]);

  const response = await run({ action: 'remove', auth_user_id: 'doctor-1', tenant_slug: tenant.slug }, 'admin-1', deps);

  assertEquals(response.removed_auth_user_id, 'doctor-1');
  assertEquals(members.has('doctor-1'), false);
  assertEquals(response.members.length, 1);
});
