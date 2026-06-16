import type {
  BranchSummary,
  HospitalProduct,
  ProductCategoryOption,
  TenantMemberContext,
} from '@/lib/marketplace/hospitalProducts';
import type { HealthDashboardData, LabReportWithResults } from '@/lib/health/v2HealthDashboard';
import type { StoredAgentMemory, StoredHealthFact, HealthMemoryStatus } from '@/lib/health/healthDataVault';
import type {
  ChatMessageRow,
  CommissionEntryRow,
  CustomerRow,
  OrderRow,
  OrderStatusInfo,
  ReferrerRow,
  TenantSummary,
  UserFactRow,
  WearableMetricRow,
} from '@/lib/types/api';

export const showcaseDemoTenant: TenantSummary = {
  display_name: 'MiraCare Demo Hospital',
  id: 'demo-tenant',
  logo_url: null,
  slug: 'mira-demo',
};

export const showcaseDemoTenantContext: TenantMemberContext = {
  ...showcaseDemoTenant,
  role: 'tenant_admin',
};

export const showcaseDemoBranches: BranchSummary[] = [
  {
    active: true,
    address: 'ชั้น 5 อาคาร Wellness Tower',
    district: 'วัฒนา',
    id: 'demo-branch-asoke',
    imageUrl: null,
    mapUrl: 'https://maps.example.com/miracare-asoke',
    name: 'สาขาอโศก',
    phone: '02-123-4567',
    sort: 1,
  },
  {
    active: true,
    address: 'โซน Health Plaza',
    district: 'ปทุมวัน',
    id: 'demo-branch-siam',
    imageUrl: null,
    mapUrl: 'https://maps.example.com/miracare-siam',
    name: 'สาขาสยาม',
    phone: '02-555-0199',
    sort: 2,
  },
];

export const showcaseDemoCategories: ProductCategoryOption[] = [
  { active: true, icon: null, imageUrl: null, key: 'checkup', labelTh: 'ตรวจสุขภาพ', sort: 1 },
  { active: true, icon: null, imageUrl: null, key: 'advanced', labelTh: 'ตรวจเชิงลึก', sort: 2 },
  { active: true, icon: null, imageUrl: null, key: 'vaccine', labelTh: 'วัคซีน', sort: 3 },
];

export const showcaseDemoProducts: HospitalProduct[] = [
  {
    branchIds: ['demo-branch-asoke', 'demo-branch-siam'],
    branches: showcaseDemoBranches,
    catalogKey: 'chk-basic-plus',
    category: 'checkup',
    commissionRate: 0.03,
    createdAt: '2026-06-01T09:00:00.000Z',
    description: 'แพ็กเกจตรวจสุขภาพพื้นฐานพร้อมน้ำตาล ไขมัน ตับ ไต และ CBC สำหรับลูกค้าที่อยากเริ่มตรวจประจำปี',
    hospitalAddress: 'อโศก / สยาม',
    hospitalName: 'MiraCare Demo Hospital',
    id: 'demo-product-basic-plus',
    includes: ['CBC', 'FBS', 'Lipid profile', 'Liver function', 'Kidney function'],
    imageUrl: null,
    priceAmount: 2990,
    ragEmbeddingStatus: 'embedded',
    ragStatus: 'published',
    requiresAppointment: true,
    reviewStatus: 'approved',
    status: 'active',
    tags: ['ตรวจสุขภาพ', 'น้ำตาล', 'ไขมัน'],
    tenantId: 'demo-tenant',
    title: 'ตรวจสุขภาพ Basic Plus',
  },
  {
    branchIds: ['demo-branch-asoke'],
    branches: [showcaseDemoBranches[0]],
    catalogKey: 'vaccine-flu',
    category: 'vaccine',
    commissionRate: 0.03,
    createdAt: '2026-06-02T09:00:00.000Z',
    description: 'วัคซีนไข้หวัดใหญ่สำหรับลูกค้าที่ต้องการนัดฉีดเร็วและรับคำแนะนำก่อนเข้ารับบริการ',
    hospitalAddress: 'สาขาอโศก',
    hospitalName: 'MiraCare Demo Hospital',
    id: 'demo-product-flu',
    includes: ['Doctor screening', 'Influenza vaccine'],
    imageUrl: null,
    priceAmount: 890,
    ragEmbeddingStatus: 'embedded',
    ragStatus: 'published',
    requiresAppointment: true,
    reviewStatus: 'approved',
    status: 'active',
    tags: ['วัคซีน', 'ไข้หวัดใหญ่'],
    tenantId: 'demo-tenant',
    title: 'วัคซีนไข้หวัดใหญ่',
  },
];

// Beauty-clinic demo set — lets sales show the same back office speaking a
// different vertical's language via /admin/catalog?tour=admin&vertical=beauty_clinic.
export const showcaseBeautyDemoCategories: ProductCategoryOption[] = [
  { active: true, icon: '✨', imageUrl: null, key: 'facial', labelTh: 'ทรีตเมนต์ผิวหน้า', sort: 1 },
  { active: true, icon: '🔆', imageUrl: null, key: 'laser', labelTh: 'เลเซอร์/ผิวพรรณ', sort: 2 },
  { active: true, icon: '💉', imageUrl: null, key: 'injection', labelTh: 'ฉีด/ฟิลเลอร์', sort: 3 },
];

export const showcaseBeautyDemoProducts: HospitalProduct[] = [
  {
    branchIds: ['demo-branch-asoke', 'demo-branch-siam'],
    branches: showcaseDemoBranches,
    catalogKey: 'facial-hydra-glow',
    category: 'facial',
    commissionRate: 0.05,
    createdAt: '2026-06-01T09:00:00.000Z',
    description: 'คอร์สทรีตเมนต์ผิวหน้า Hydra Glow เติมความชุ่มชื้นและฟื้นฟูผิวหมองคล้ำ พร้อมประเมินสภาพผิวก่อนทำ',
    hospitalAddress: 'อโศก / สยาม',
    hospitalName: 'MiraCare Beauty Clinic',
    id: 'demo-product-hydra-glow',
    includes: ['ประเมินสภาพผิว', 'มาส์กไฮยา', 'นวดหน้า', 'ลงเซรั่ม'],
    imageUrl: null,
    priceAmount: 1990,
    ragEmbeddingStatus: 'embedded',
    ragStatus: 'published',
    requiresAppointment: true,
    reviewStatus: 'approved',
    status: 'active',
    tags: ['ผิวหน้า', 'ความชุ่มชื้น'],
    tenantId: 'demo-tenant',
    title: 'ทรีตเมนต์ผิวหน้า Hydra Glow',
  },
  {
    branchIds: ['demo-branch-asoke'],
    branches: [showcaseDemoBranches[0]],
    catalogKey: 'laser-underarm-6',
    category: 'laser',
    commissionRate: 0.05,
    createdAt: '2026-06-02T09:00:00.000Z',
    description: 'คอร์สเลเซอร์กำจัดขนรักแร้ 6 ครั้ง ลดปัญหาขนคุดและรอยดำ พร้อมปรึกษาก่อนเริ่มคอร์ส',
    hospitalAddress: 'สาขาอโศก',
    hospitalName: 'MiraCare Beauty Clinic',
    id: 'demo-product-laser-underarm',
    includes: ['ปรึกษาแพทย์ผิวหนัง', 'เลเซอร์กำจัดขน 6 ครั้ง'],
    imageUrl: null,
    priceAmount: 4500,
    ragEmbeddingStatus: 'embedded',
    ragStatus: 'published',
    requiresAppointment: true,
    reviewStatus: 'approved',
    status: 'active',
    tags: ['เลเซอร์', 'กำจัดขน'],
    tenantId: 'demo-tenant',
    title: 'เลเซอร์กำจัดขนรักแร้ 6 ครั้ง',
  },
];

export function demoCatalogForVertical(vertical: string): {
  branches: BranchSummary[];
  categories: ProductCategoryOption[];
  products: HospitalProduct[];
} {
  if (vertical === 'beauty_clinic') {
    return { branches: showcaseDemoBranches, categories: showcaseBeautyDemoCategories, products: showcaseBeautyDemoProducts };
  }

  return { branches: showcaseDemoBranches, categories: showcaseDemoCategories, products: showcaseDemoProducts };
}

export const showcaseDemoOrders: OrderStatusInfo[] = [
  {
    amount_baht: 2990,
    booking_at: null,
    branch_name: 'สาขาอโศก',
    created_at: '2026-06-13T04:10:00.000Z',
    id: 'demo-order-confirmed',
    product_name: 'ตรวจสุขภาพ Basic Plus',
    status: 'confirmed',
  },
  {
    amount_baht: 2990,
    booking_at: '2026-06-18T03:00:00.000Z',
    branch_name: 'สาขาอโศก',
    created_at: '2026-06-12T03:20:00.000Z',
    id: 'demo-order-submitted',
    product_name: 'ตรวจสุขภาพ Basic Plus',
    status: 'submitted',
  },
  {
    amount_baht: 890,
    booking_at: '2026-06-20T04:30:00.000Z',
    branch_name: 'สาขาสยาม',
    created_at: '2026-06-11T08:10:00.000Z',
    id: 'demo-order-booked',
    product_name: 'วัคซีนไข้หวัดใหญ่',
    status: 'booked',
  },
  {
    amount_baht: 2990,
    booking_at: '2026-06-08T03:00:00.000Z',
    branch_name: 'สาขาอโศก',
    created_at: '2026-06-07T03:20:00.000Z',
    id: 'demo-order-done',
    product_name: 'ตรวจสุขภาพ Basic Plus',
    status: 'done',
  },
  {
    amount_baht: 890,
    booking_at: null,
    branch_name: 'สาขาสยาม',
    created_at: '2026-06-05T08:10:00.000Z',
    id: 'demo-order-cancelled',
    product_name: 'วัคซีนไข้หวัดใหญ่',
    status: 'cancelled',
  },
];

export type ShowcaseDemoAdminOrder = OrderRow & {
  branches?: { address: string | null; district: string | null; name: string } | null;
  customers?: { nickname: string | null; phone: string | null } | null;
  products?: { catalog_key: string; category: string; image_url: string | null; name: string; price_baht: number } | null;
  referrers?: { name: string; ref_code: string } | null;
};

export const showcaseDemoAdminOrders: ShowcaseDemoAdminOrder[] = [
  {
    admin_note: 'โทรยืนยันสลิปแล้ว รอเลือกเวลานัด',
    amount_baht: 2990,
    booking_at: null,
    branch_id: 'demo-branch-asoke',
    branches: { address: 'ชั้น 5 อาคาร Wellness Tower', district: 'วัฒนา', name: 'สาขาอโศก' },
    buyer_age: 35,
    buyer_name: 'คุณบอส',
    buyer_phone: '0891234567',
    channel: 'chat_app',
    commission_scheme_snapshot: { default: 10, mode: 'percent' },
    created_at: '2026-06-12T03:20:00.000Z',
    customer_id: 'demo-customer',
    customers: { nickname: 'บอส', phone: '0891234567' },
    id: 'demo-order-submitted',
    paid_at: '2026-06-12T03:35:00.000Z',
    payment_provider: 'promptpay',
    preferred_branch: 'อโศก',
    preferred_date: '2026-06-18',
    preferred_date_end: '2026-06-20',
    preferred_time_window: 'ช่วงเช้า 09:00 - 12:00',
    product_id: 'demo-product-basic-plus',
    products: { catalog_key: 'chk-basic-plus', category: 'checkup', image_url: null, name: 'ตรวจสุขภาพ Basic Plus', price_baht: 2990 },
    qty: 1,
    referrer_id: 'demo-referrer-nok',
    referrers: { name: 'พญ. นก', ref_code: 'DRNOK2' },
    session_id: 'demo-session',
    slip_url: null,
    status: 'submitted',
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    stripe_payment_status: null,
    tenant_id: 'demo-tenant',
    updated_at: '2026-06-12T03:40:00.000Z',
  },
  {
    admin_note: 'จองคิวเรียบร้อย',
    amount_baht: 890,
    booking_at: '2026-06-20T04:30:00.000Z',
    branch_id: 'demo-branch-siam',
    branches: { address: 'โซน Health Plaza', district: 'ปทุมวัน', name: 'สาขาสยาม' },
    buyer_age: 42,
    buyer_name: 'คุณเมย์',
    buyer_phone: '0869876543',
    channel: 'referrer',
    commission_scheme_snapshot: { default: 120, mode: 'flat_baht' },
    created_at: '2026-06-11T08:10:00.000Z',
    customer_id: 'demo-customer-may',
    customers: { nickname: 'เมย์', phone: '0869876543' },
    id: 'demo-order-booked',
    paid_at: '2026-06-11T08:22:00.000Z',
    payment_provider: 'promptpay',
    preferred_branch: 'สยาม',
    preferred_date: '2026-06-20',
    preferred_date_end: '2026-06-20',
    preferred_time_window: 'ช่วงบ่าย 13:00 - 17:00',
    product_id: 'demo-product-flu',
    products: { catalog_key: 'vaccine-flu', category: 'vaccine', image_url: null, name: 'วัคซีนไข้หวัดใหญ่', price_baht: 890 },
    qty: 1,
    referrer_id: 'demo-referrer-nok',
    referrers: { name: 'พญ. นก', ref_code: 'DRNOK2' },
    session_id: 'demo-session-may',
    slip_url: null,
    status: 'booked',
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    stripe_payment_status: null,
    tenant_id: 'demo-tenant',
    updated_at: '2026-06-11T08:40:00.000Z',
  },
];

export const showcaseDemoTranscript: ChatMessageRow[] = [
  {
    cards: null,
    client_msg_id: 'demo-client-1',
    content: 'อยากตรวจสุขภาพครับ ช่วงนี้กังวลเรื่องน้ำตาล',
    created_at: '2026-06-12T03:12:00.000Z',
    id: 'demo-message-user',
    marker_product_ids: [],
    openai_response_id: null,
    role: 'user',
    session_id: 'demo-session',
  },
  {
    cards: null,
    client_msg_id: null,
    content: 'แนะนำ Basic Plus เพราะมี FBS และไขมัน เหมาะกับการเริ่มดูความเสี่ยงน้ำตาลค่ะ',
    created_at: '2026-06-12T03:13:00.000Z',
    id: 'demo-message-assistant',
    marker_product_ids: ['chk-basic-plus'],
    openai_response_id: null,
    role: 'assistant',
    session_id: 'demo-session',
  },
];

export const showcaseDemoReferrers: ReferrerRow[] = [
  {
    active: true,
    auth_user_id: null,
    commission_scheme: { by_category: { vaccine: 120 }, default: 10, mode: 'percent' },
    created_at: '2026-06-01T09:00:00.000Z',
    id: 'demo-referrer-nok',
    name: 'พญ. นก',
    phone: '0812345678',
    ref_code: 'DRNOK2',
    tenant_id: 'demo-tenant',
    type: 'doctor',
  },
];

export type ShowcaseDemoCommission = CommissionEntryRow & {
  orders?: { amount_baht: number; products?: { name: string } | null } | null;
  referrers?: { name: string; ref_code: string } | null;
};

export const showcaseDemoCommissions: ShowcaseDemoCommission[] = [
  {
    amount_baht: 299,
    created_at: '2026-06-12T03:40:00.000Z',
    id: 'demo-commission-1',
    order_id: 'demo-order-submitted',
    orders: { amount_baht: 2990, products: { name: 'ตรวจสุขภาพ Basic Plus' } },
    referrer_id: 'demo-referrer-nok',
    referrers: { name: 'พญ. นก', ref_code: 'DRNOK2' },
    scheme_snapshot: { default: 10, mode: 'percent' },
    status: 'pending',
    tenant_id: 'demo-tenant',
  },
];

const demoCustomer: CustomerRow = {
  auth_user_id: null,
  created_at: '2026-06-01T09:00:00.000Z',
  id: 'demo-customer',
  line_user_id: null,
  nickname: 'บอส',
  phone: '0891234567',
  referred_at: '2026-06-12T03:00:00.000Z',
  referred_by: 'demo-referrer-nok',
  tenant_id: 'demo-tenant',
};

const demoFacts: UserFactRow[] = [
  {
    confidence: 0.96,
    created_at: '2026-06-12T03:30:00.000Z',
    customer_id: 'demo-customer',
    id: 'demo-fact-weight',
    key: 'weight_kg',
    source: 'user_confirmation',
    source_ref: null,
    status: 'active',
    superseded_by: null,
    tenant_id: 'demo-tenant',
    value_num: 72,
    value_text: null,
  },
  {
    confidence: 0.94,
    created_at: '2026-06-12T03:30:00.000Z',
    customer_id: 'demo-customer',
    id: 'demo-fact-fbs',
    key: 'FBS',
    source: 'lab_import',
    source_ref: 'demo-report',
    status: 'active',
    superseded_by: null,
    tenant_id: 'demo-tenant',
    value_num: 104,
    value_text: null,
  },
];

const demoLabReport: LabReportWithResults = {
  ai_summary_th: 'ค่าน้ำตาลอดอาหารสูงกว่าช่วงอ้างอิงเล็กน้อย ควรติดตามร่วมกับแพทย์และดูแนวโน้มครั้งถัดไป',
  collected_date: '2026-06-10',
  created_at: '2026-06-11T02:00:00.000Z',
  customer_id: 'demo-customer',
  id: 'demo-report',
  lab_results: [
    {
      confidence: 0.95,
      confirmed: true,
      id: 'demo-result-fbs',
      ref_high: 99,
      ref_low: 70,
      report_id: 'demo-report',
      test_code: 'FBS',
      test_name_raw: 'Fasting blood sugar',
      unit: 'mg/dL',
      value: 104,
    },
    {
      confidence: 0.72,
      confirmed: false,
      id: 'demo-result-chol',
      ref_high: 200,
      ref_low: null,
      report_id: 'demo-report',
      test_code: 'CHOL',
      test_name_raw: 'Total cholesterol',
      unit: 'mg/dL',
      value: 212,
    },
  ],
  status: 'needs_confirmation',
  storage_path: 'demo/lab-report.pdf',
  tenant_id: 'demo-tenant',
};

const demoWearableMetrics: WearableMetricRow[] = [
  { customer_id: 'demo-customer', day: '2026-06-09', id: 'demo-steps-1', metric: 'steps', source: 'apple_export', tenant_id: 'demo-tenant', value: 6840 },
  { customer_id: 'demo-customer', day: '2026-06-10', id: 'demo-steps-2', metric: 'steps', source: 'apple_export', tenant_id: 'demo-tenant', value: 8320 },
  { customer_id: 'demo-customer', day: '2026-06-11', id: 'demo-steps-3', metric: 'steps', source: 'apple_export', tenant_id: 'demo-tenant', value: 7600 },
  { customer_id: 'demo-customer', day: '2026-06-11', id: 'demo-sleep-1', metric: 'sleep_minutes', source: 'apple_export', tenant_id: 'demo-tenant', value: 405 },
  { customer_id: 'demo-customer', day: '2026-06-11', id: 'demo-hr-1', metric: 'avg_hr', source: 'apple_export', tenant_id: 'demo-tenant', value: 74 },
];

export const showcaseDemoHealthData: HealthDashboardData = {
  customer: demoCustomer,
  facts: demoFacts,
  labReports: [demoLabReport],
  wearableMetrics: demoWearableMetrics,
};

export const showcaseDemoStoredFacts: StoredHealthFact[] = [
  {
    confidence: 0.96,
    createdAt: '2026-06-12T03:30:00.000Z',
    factType: 'vital',
    id: 'demo-stored-weight',
    label: 'น้ำหนัก',
    status: 'confirmed',
    unit: 'kg',
    updatedAt: '2026-06-12T03:30:00.000Z',
    value: '72',
  },
  {
    confidence: 0.94,
    createdAt: '2026-06-12T03:30:00.000Z',
    factType: 'condition',
    id: 'demo-stored-concern',
    label: 'สิ่งที่กังวล',
    status: 'confirmed',
    updatedAt: '2026-06-12T03:30:00.000Z',
    value: 'น้ำตาลในเลือด',
  },
];

export const showcaseDemoAgentMemory: StoredAgentMemory[] = [
  {
    confidence: 0.92,
    createdAt: '2026-06-12T03:20:00.000Z',
    id: 'demo-memory-area',
    memoryType: 'preferred_area',
    observedAt: '2026-06-12T03:20:00.000Z',
    source: 'chat',
    status: 'active',
    summary: 'สะดวกเข้ารับบริการแถวอโศกหรือสยาม',
    value: 'อโศก, สยาม',
  },
];

export const showcaseDemoHealthMemoryStatus: HealthMemoryStatus = {
  consentGranted: true,
  reason: 'ready',
  userId: 'demo-user',
};
