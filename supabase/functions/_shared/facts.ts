import { insertRow, selectMany, selectOne, updateRows, upsertRow } from './db.ts';
import type { FactKeyRow, UserFactRow } from './types.ts';

export type ExtractedFactCandidate = {
  confidence: number;
  key: string;
  value: string;
};

export type NormalizedFact = {
  confidence: number;
  key: string;
  status: 'active' | 'candidate';
  value_num: number | null;
  value_text: string | null;
};

const thaiDigits: Record<string, string> = {
  '๐': '0',
  '๑': '1',
  '๒': '2',
  '๓': '3',
  '๔': '4',
  '๕': '5',
  '๖': '6',
  '๗': '7',
  '๘': '8',
  '๙': '9',
};

const factLabels: Record<string, string> = {
  age: 'อายุ',
  alcohol: 'แอลกอฮอล์',
  allergies: 'แพ้ยา/แพ้อาหาร',
  birth_year: 'ปีเกิด',
  chronic_conditions: 'โรคประจำตัว',
  exercise_freq: 'การออกกำลังกาย',
  family_history: 'ประวัติครอบครัว',
  health_concerns: 'กังวลเรื่องสุขภาพ',
  height_cm: 'ส่วนสูง',
  last_checkup: 'ตรวจล่าสุด',
  location_area: 'พื้นที่',
  medications: 'ยา',
  nickname: 'ชื่อเล่น',
  sex: 'เพศ',
  smoking: 'สูบบุหรี่',
  weight_kg: 'น้ำหนัก',
};

function normalizeThaiNumerals(value: string) {
  return value.replace(/[๐-๙]/g, (digit) => thaiDigits[digit] ?? digit);
}

function parseNumber(value: string) {
  const normalized = normalizeThaiNumerals(value).replace(/,/g, '');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);

  return match ? Number(match[0]) : null;
}

function normalizeYear(value: string) {
  const parsed = parseNumber(value);

  if (parsed === null || Number.isNaN(parsed)) {
    return null;
  }

  return parsed > 2400 ? parsed - 543 : parsed;
}

export function normalizeFactCandidates(candidates: ExtractedFactCandidate[], registry: FactKeyRow[]): NormalizedFact[] {
  const registryByKey = new Map(registry.map((row) => [row.key, row]));

  return candidates
    .map((candidate): NormalizedFact | null => {
      const registryRow = registryByKey.get(candidate.key);
      const confidence = Math.max(0, Math.min(1, candidate.confidence));

      if (!registryRow || confidence < 0.4) {
        return null;
      }

      const value = candidate.value.trim();

      if (!value) {
        return null;
      }

      if (registryRow.value_kind === 'number') {
        const parsed = candidate.key === 'birth_year' ? normalizeYear(value) : parseNumber(value);

        if (parsed === null || Number.isNaN(parsed)) {
          return null;
        }

        return {
          confidence,
          key: candidate.key,
          status: confidence >= 0.7 ? 'active' : 'candidate',
          value_num: parsed,
          value_text: null,
        };
      }

      return {
        confidence,
        key: candidate.key,
        status: confidence >= 0.7 ? 'active' : 'candidate',
        value_num: null,
        value_text: normalizeThaiNumerals(value),
      };
    })
    .filter((fact): fact is NormalizedFact => Boolean(fact));
}

function renderFactValue(fact: Pick<UserFactRow, 'key' | 'value_num' | 'value_text'>, registry?: FactKeyRow) {
  const rawValue = fact.value_text ?? (fact.value_num === null ? '' : `${fact.value_num}`);

  if (!rawValue) {
    return '';
  }

  if (fact.key === 'weight_kg') {
    return `${rawValue} กก.`;
  }

  if (fact.key === 'height_cm') {
    return `${rawValue} ซม.`;
  }

  if (registry?.unit && fact.key !== 'age' && fact.key !== 'birth_year') {
    return `${rawValue} ${registry.unit}`;
  }

  return rawValue;
}

export function renderFactsThai(activeFacts: UserFactRow[], candidateFacts: UserFactRow[], registry: FactKeyRow[] = []) {
  const registryByKey = new Map(registry.map((row) => [row.key, row]));
  const parts = activeFacts
    .map((fact) => {
      const value = renderFactValue(fact, registryByKey.get(fact.key));

      return value ? `${factLabels[fact.key] ?? fact.key}: ${value}` : null;
    })
    .filter((part): part is string => Boolean(part));
  const candidateLine = candidateFacts.slice(0, 2)
    .map((fact) => {
      const value = renderFactValue(fact, registryByKey.get(fact.key));

      return value ? `${factLabels[fact.key] ?? fact.key} ~${value}` : null;
    })
    .filter((part): part is string => Boolean(part));

  return {
    activeLine: parts.join(' / '),
    candidateLine: candidateLine.length ? `ข้อมูลที่ควรยืนยันแบบเนียนๆ: ${candidateLine.join(', ')}` : '',
  };
}

export async function loadFactRegistry() {
  return selectMany<FactKeyRow>('fact_keys', {
    order: 'key.asc',
    select: 'key,value_kind,unit',
  });
}

export async function insertFactsIdempotent({
  customerId,
  facts,
  source = 'chat_extraction',
  sourceRef,
  tenantId,
}: {
  customerId: string;
  facts: NormalizedFact[];
  source?: UserFactRow['source'];
  sourceRef: string;
  tenantId: string;
}) {
  const inserted: UserFactRow[] = [];

  for (const fact of facts) {
    const row = await upsertRow<UserFactRow>(
      'user_facts',
      {
        confidence: fact.confidence,
        customer_id: customerId,
        key: fact.key,
        source,
        source_ref: sourceRef,
        status: fact.status,
        tenant_id: tenantId,
        value_num: fact.value_num,
        value_text: fact.value_text,
      },
      'customer_id,key,source,source_ref',
      {
        select:
          'id,tenant_id,customer_id,key,value_text,value_num,confidence,status,source,source_ref,superseded_by,created_at',
      },
    );

    inserted.push(row);

    if (row.status === 'active') {
      await updateRows<UserFactRow>(
        'user_facts',
        {
          status: 'superseded',
          superseded_by: row.id,
        },
        {
          customer_id: `eq.${customerId}`,
          id: `neq.${row.id}`,
          key: `eq.${row.key}`,
          select:
            'id,tenant_id,customer_id,key,value_text,value_num,confidence,status,source,source_ref,superseded_by,created_at',
          status: 'eq.active',
          tenant_id: `eq.${tenantId}`,
        },
      );
    }

    if (row.key === 'nickname' && row.value_text) {
      await updateRows(
        'customers',
        { nickname: row.value_text },
        {
          id: `eq.${customerId}`,
          select: 'id',
          tenant_id: `eq.${tenantId}`,
        },
      );
    }
  }

  return inserted;
}

export async function recordFormAgeFact({
  age,
  customerId,
  orderId,
  tenantId,
}: {
  age: number;
  customerId: string;
  orderId: string;
  tenantId: string;
}) {
  const latestConsent = await selectOne<{ granted: boolean }>('consents', {
    customer_id: `eq.${customerId}`,
    kind: 'eq.health_data_collection',
    order: 'created_at.desc',
    select: 'granted',
    tenant_id: `eq.${tenantId}`,
  });

  if (!latestConsent?.granted) {
    return null;
  }

  const rows = await insertFactsIdempotent({
    customerId,
    facts: [
      {
        confidence: 1,
        key: 'age',
        status: 'active',
        value_num: age,
        value_text: null,
      },
    ],
    source: 'user_form',
    sourceRef: orderId,
    tenantId,
  });

  return rows[0] ?? null;
}

export async function insertSystemNotice(sessionId: string, content: string) {
  return insertRow('chat_messages', {
    content,
    role: 'system_notice',
    session_id: sessionId,
  });
}
