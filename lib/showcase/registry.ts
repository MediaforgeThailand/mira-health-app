import type { HrefObject } from 'expo-router';
import type { ImageSourcePropType } from 'react-native';

export const showcaseModuleIds = ['referral', 'admin', 'ai-chat', 'health'] as const;

export type ShowcaseModuleId = (typeof showcaseModuleIds)[number];
export type ShowcaseStatus = 'live' | 'mockup' | 'concept' | 'planned';
export type ShowcaseAuth = 'none' | 'customer' | 'admin';
export type ShowcaseHref = string | HrefObject;

export type ShowcaseEntry = {
  id: string;
  module: ShowcaseModuleId;
  label_th: string;
  label_en: string;
  path: string;
  href: ShowcaseHref | null;
  description_th: string;
  status: ShowcaseStatus;
  auth: ShowcaseAuth;
  poster: ImageSourcePropType | null;
  demoOrder: number;
  sharedWithModule?: ShowcaseModuleId;
};

export type ShowcaseModuleMeta = {
  accent: string;
  eyebrow_en: string;
  id: ShowcaseModuleId;
  script_th: string[];
  story_th: string;
  title_en: string;
  title_th: string;
};

export const showcaseModuleMeta: Record<ShowcaseModuleId, ShowcaseModuleMeta> = {
  admin: {
    accent: '#3F8EFC',
    eyebrow_en: 'Operations console',
    id: 'admin',
    script_th: [
      'เปิดแค็ตตาล็อกเพื่อดูว่าโรงพยาบาลแก้แพ็กเกจ ราคา รูปภาพ และสถานะขายได้เอง',
      'เปิดคิวออเดอร์เพื่อดูงานหลังบ้านหลังลูกค้าชำระเงินหรือส่งข้อมูลจอง',
      'เปิดจัดการสาขาเพื่อดูว่าสาขาและข้อมูลติดต่อถูกใช้ร่วมกับหน้าขายจริง',
      'ชี้ให้เห็นหน้า dashboard ที่ยังรอสร้างเป็น mockup ในเฟสถัดไป',
    ],
    story_th: 'ระบบหลังบ้านสำหรับทีมโรงพยาบาลที่ต้องดูแลสินค้า ออเดอร์ สาขา และงาน referral ในที่เดียว',
    title_en: 'Admin Panel',
    title_th: 'ระบบหลังบ้าน',
  },
  'ai-chat': {
    accent: '#40C9A2',
    eyebrow_en: 'Customer commerce',
    id: 'ai-chat',
    script_th: [
      'เปิดคำสั่งซื้อของฉันเพื่อดูรายการออเดอร์และ timeline ได้ทันทีด้วยข้อมูลตัวอย่าง',
      'เปิดรายละเอียดแพ็กเกจเพื่อดูข้อมูลสินค้าจาก catalog จริง',
      'เปิด prototype หรือ LINE preview เฉพาะตอนต้องขายภาพอนาคตของประสบการณ์แชท',
    ],
    story_th: 'ระบบหน้าลูกค้าสำหรับดูคำสั่งซื้อ รายละเอียดแพ็กเกจ และต้นแบบประสบการณ์แชทในอนาคต',
    title_en: 'Orders And Packages',
    title_th: 'คำสั่งซื้อและแพ็กเกจ',
  },
  health: {
    accent: '#F26D6D',
    eyebrow_en: 'Health intelligence',
    id: 'health',
    script_th: [
      'เปิด dashboard สุขภาพเพื่อดูภาพรวมได้ทันทีด้วย fixture และสลับเป็นข้อมูลจริงเมื่อมี session',
      'เปิดผลตรวจเพื่อโชว์ lab markers และแถวที่ให้ user ยืนยันข้อมูล',
      'เปิด wearable เพื่อดูสัญญาณสุขภาพรายวัน',
      'เปิด profile เพื่อโชว์ consent, memory และ export controls',
    ],
    story_th: 'แดชบอร์ดสุขภาพสำหรับลูกค้าที่รวมผลแลบ wearable และ health memory ที่ยืนยันแล้ว',
    title_en: 'Health Dashboard',
    title_th: 'แดชบอร์ดสุขภาพ',
  },
  referral: {
    accent: '#E9B44C',
    eyebrow_en: 'Growth engine',
    id: 'referral',
    script_th: [
      'เปิดลิงก์ referral เพื่อโชว์ว่าระบบบันทึก code ก่อนส่งลูกค้าเข้าหน้ารวม',
      'เปิด workspace ของ partner เพื่อสร้างออเดอร์ช่วยลูกค้าและดูยอด commission',
      'เปิดหน้า admin referrers เพื่อให้โรงพยาบาลเห็นการจัดการพาร์ทเนอร์และ commission',
    ],
    story_th: 'ระบบแนะนำลูกค้าสำหรับหมอ พาร์ทเนอร์ และทีมโรงพยาบาลที่ต้องการ track attribution ถึงยอดขาย',
    title_en: 'Referral Program',
    title_th: 'โปรแกรมแนะนำลูกค้า',
  },
};

export const showcaseEntries: readonly ShowcaseEntry[] = [
  {
    auth: 'none',
    demoOrder: 0,
    description_th: 'ศูนย์รวมงานแอดมินสำหรับเปิดไปจัดการสินค้า คิวคำสั่งซื้อ และงานหลังบ้านหลักของโรงพยาบาล.',
    href: '/admin-panel',
    id: 'admin-operations-hub',
    label_en: 'Admin Operations Hub',
    label_th: 'ศูนย์รวมแอดมิน',
    module: 'admin',
    path: '/admin-panel',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 1,
    description_th: 'หน้านี้บันทึก referral code ลงเครื่องลูกค้า เพื่อผูก attribution กับการซื้อที่เข้าเงื่อนไข.',
    href: { pathname: '/r/[ref_code]', params: { ref_code: 'DRNK22' } },
    id: 'referral-public-entry',
    label_en: 'Referral Link Entry',
    label_th: 'ลิงก์แนะนำลูกค้า',
    module: 'referral',
    path: '/r/DRNK22',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 2,
    description_th: 'พื้นที่ partner เปิดดูตัวอย่างได้ทันทีโดยไม่ต้องล็อกอิน ใช้เลือกแพ็กเกจ กรอกข้อมูลผู้ซื้อ สร้างออเดอร์เดโม และดู commission.',
    href: '/partner',
    id: 'referral-partner-workspace',
    label_en: 'Partner Referral Workspace',
    label_th: 'พื้นที่พาร์ทเนอร์',
    module: 'referral',
    path: '/partner',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 3,
    description_th: 'หน้าแอดมินที่เปิดดู referrer และ commission ตัวอย่างได้ทันที; ถ้ามีสิทธิ์แอดมินจึงแก้ข้อมูลจริงได้.',
    href: '/admin/referrers',
    id: 'referral-admin-referrers',
    label_en: 'Referrers And Commissions',
    label_th: 'จัดการผู้แนะนำและค่าคอมมิชชัน',
    module: 'referral',
    path: '/admin/referrers',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 4,
    description_th: 'พื้นที่ขายของทีมโรงพยาบาลสำหรับดูสินค้า สร้างลิงก์ referral และติดตาม commission ใน flow เดียว.',
    href: '/sales-portal',
    id: 'referral-sales-portal',
    label_en: 'Sales Portal',
    label_th: 'พอร์ทัลทีมขาย',
    module: 'referral',
    path: '/sales-portal',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 1,
    description_th: 'หน้าแอดมินที่เปิดดู catalog ตัวอย่างได้ทันที; ถ้ามีสิทธิ์แอดมินจึงอ่านและบันทึกสินค้าโรงพยาบาลจริง.',
    href: '/admin/catalog',
    id: 'admin-catalog',
    label_en: 'Product Catalog Admin',
    label_th: 'จัดการแค็ตตาล็อก',
    module: 'admin',
    path: '/admin/catalog',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 2,
    description_th: 'คิวออเดอร์แอดมินที่เปิดดูออเดอร์ตัวอย่างได้ทันที; ถ้ามีสิทธิ์แอดมินจึงอ่านคำสั่งซื้อจริงและเรียก action หลังบ้าน.',
    href: '/admin/orders',
    id: 'admin-orders',
    label_en: 'Orders Queue',
    label_th: 'คิวคำสั่งซื้อ',
    module: 'admin',
    path: '/admin/orders',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 3,
    description_th: 'หน้าแอดมินที่เปิดดูสาขาตัวอย่างได้ทันที; ถ้ามีสิทธิ์แอดมินจึงอ่านและบันทึกสาขาจริงของ tenant.',
    href: '/admin/branches',
    id: 'admin-branches',
    label_en: 'Branch Management',
    label_th: 'จัดการสาขา',
    module: 'admin',
    path: '/admin/branches',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 4,
    description_th: 'หน้าเดียวกับระบบ Referral เปิดดูข้อมูลตัวอย่างได้ทันที และจัดการ referrer/commission จริงเมื่อมีสิทธิ์.',
    href: '/admin/referrers',
    id: 'admin-referrers-shared',
    label_en: 'Shared Referrer Admin',
    label_th: 'พาร์ทเนอร์และค่าคอมมิชชัน',
    module: 'admin',
    path: '/admin/referrers',
    poster: null,
    sharedWithModule: 'referral',
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 5,
    description_th: 'ยังไม่มี route ใน build นี้; เฟส mockup จะทำภาพรวม KPI ออเดอร์ ยอดขาย และแพ็กเกจขายดี.',
    href: null,
    id: 'admin-dashboard-planned',
    label_en: 'Admin KPI Dashboard',
    label_th: 'ภาพรวมร้าน',
    module: 'admin',
    path: '/admin/dashboard',
    poster: null,
    status: 'planned',
  },
  {
    auth: 'none',
    demoOrder: 1,
    description_th: 'ทางลัดคำสั่งซื้อเดิมที่ส่งลูกค้าไปยังส่วนสถานะคำสั่งซื้อในหน้าโปรไฟล์.',
    href: '/orders',
    id: 'ai-chat-orders',
    label_en: 'Order Status Shortcut',
    label_th: 'ทางลัดสถานะคำสั่งซื้อ',
    module: 'ai-chat',
    path: '/orders',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 2,
    description_th: 'หน้าอ่านรายละเอียดแพ็กเกจจาก catalog จริงตาม productId หรือ catalogKey.',
    href: '/package-detail',
    id: 'ai-chat-package-detail',
    label_en: 'Package Detail',
    label_th: 'รายละเอียดแพ็กเกจ',
    module: 'ai-chat',
    path: '/package-detail',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 3,
    description_th: 'ต้นแบบภาพแชทที่รันในเครื่องเพื่อขาย direction ของ UI เท่านั้น ไม่ได้ต่อ backend production.',
    href: '/prototype',
    id: 'ai-chat-prototype',
    label_en: 'Chat Design Concept',
    label_th: 'ต้นแบบหน้าตาแชท',
    module: 'ai-chat',
    path: '/prototype',
    poster: null,
    status: 'concept',
  },
  {
    auth: 'none',
    demoOrder: 4,
    description_th: 'ยังไม่มี route ใน build นี้; เฟส mockup จะทำหน้าจอ concept ของ LINE OA ที่สะท้อน flow แชทเดียวกัน.',
    href: null,
    id: 'ai-chat-line-preview-planned',
    label_en: 'LINE OA Preview',
    label_th: 'ตัวอย่าง LINE OA',
    module: 'ai-chat',
    path: '/showcase/line-preview',
    poster: null,
    status: 'planned',
  },
  {
    auth: 'none',
    demoOrder: 1,
    description_th: 'แดชบอร์ดสุขภาพใน tab shell ที่เปิดดู fixture ได้ทันที; ถ้ามี session จึงโหลดผลแลบ wearable และ health facts จาก Supabase.',
    href: '/health',
    id: 'health-overview-tab',
    label_en: 'Health Dashboard',
    label_th: 'แดชบอร์ดสุขภาพ',
    module: 'health',
    path: '/health',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 2,
    description_th: 'route เดี่ยวของ overview สุขภาพชุดเดียวกับ /health เปิดดู fixture ได้ทันทีนอก tab shell.',
    href: '/body-overview',
    id: 'health-body-overview',
    label_en: 'Health overview without tab shell',
    label_th: 'ภาพรวมสุขภาพแบบหน้าเดี่ยว',
    module: 'health',
    path: '/body-overview',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 3,
    description_th: 'หน้าผลตรวจที่เปิดดู lab fixture ได้ทันที; ถ้ามีข้อมูลจริงจึงแสดง lab reports และแถวตรวจทานค่าความมั่นใจต่ำ.',
    href: '/health-check-results',
    id: 'health-lab-results',
    label_en: 'Health Check Results',
    label_th: 'ผลตรวจสุขภาพ',
    module: 'health',
    path: '/health-check-results',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 4,
    description_th: 'หน้า wearable ที่เปิดดูสัญญาณตัวอย่างได้ทันที และใช้ dashboard loader เดียวกันเมื่อมีข้อมูลจริง.',
    href: '/wearable-health',
    id: 'health-wearable',
    label_en: 'Wearable Health',
    label_th: 'ข้อมูล wearable',
    module: 'health',
    path: '/wearable-health',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    demoOrder: 5,
    description_th: 'ยังไม่มี route ใน build นี้; เฟส mockup จะทำ UI อัปโหลดผลแลบก่อนต่อ lab-ingest และ lab-confirm.',
    href: null,
    id: 'health-lab-upload-planned',
    label_en: 'Lab Upload',
    label_th: 'อัปโหลดผลแลบ',
    module: 'health',
    path: '/health/lab-upload',
    poster: null,
    status: 'planned',
  },
  {
    auth: 'none',
    demoOrder: 6,
    description_th: 'หน้า profile สำหรับสถานะคำสั่งซื้อ, consent, memory, export และข้อมูลตัวอย่าง; ถ้ามี session จะอ่านข้อมูลจริงของลูกค้า.',
    href: '/user-profile',
    id: 'health-user-profile',
    label_en: 'User Profile And Orders',
    label_th: 'โปรไฟล์และสถานะคำสั่งซื้อ',
    module: 'health',
    path: '/user-profile',
    poster: null,
    status: 'live',
  },
];

const legacyModuleAliases: Partial<Record<string, ShowcaseModuleId>> = {
  'health-dashboard': 'health',
};

const statusBadgeLabels: Record<ShowcaseStatus, string> = {
  concept: 'CONCEPT',
  live: 'LIVE',
  mockup: 'MOCKUP',
  planned: 'PLANNED',
};

export type ShowcasePage = ShowcaseEntry & {
  badge: string;
  description: string;
  href: ShowcaseHref;
  label: string;
};

export type ShowcaseModule = ShowcaseModuleMeta & {
  body: string;
  eyebrow: string;
  pages: ShowcasePage[];
  title: string;
};

export function resolveShowcaseModuleId(id: string | string[] | undefined) {
  const rawId = Array.isArray(id) ? id[0] : id;

  if (!rawId) {
    return null;
  }

  if (showcaseModuleIds.includes(rawId as ShowcaseModuleId)) {
    return rawId as ShowcaseModuleId;
  }

  return legacyModuleAliases[rawId] ?? null;
}

export function getShowcaseEntriesForModule(moduleId: ShowcaseModuleId, includePlanned = true) {
  return showcaseEntries
    .filter((entry) => entry.module === moduleId && (includePlanned || entry.status !== 'planned'))
    .slice()
    .sort((left, right) => left.demoOrder - right.demoOrder || left.label_th.localeCompare(right.label_th, 'th'));
}

function toPage(entry: ShowcaseEntry): ShowcasePage | null {
  const href = entry.href;

  if (href === null) {
    return null;
  }

  return {
    auth: entry.auth,
    badge: statusBadgeLabels[entry.status],
    demoOrder: entry.demoOrder,
    description: entry.description_th,
    description_th: entry.description_th,
    href,
    id: entry.id,
    label: entry.label_th,
    label_en: entry.label_en,
    label_th: entry.label_th,
    module: entry.module,
    path: entry.path,
    poster: entry.poster,
    sharedWithModule: entry.sharedWithModule,
    status: entry.status,
  };
}

export const showcaseModules: ShowcaseModule[] = showcaseModuleIds.map((id) => {
  const meta = showcaseModuleMeta[id];
  const pages = getShowcaseEntriesForModule(id, false).map(toPage).filter((entry): entry is ShowcasePage => Boolean(entry));

  return {
    ...meta,
    body: meta.story_th,
    eyebrow: meta.eyebrow_en,
    pages,
    title: meta.title_th,
  };
});

export function findShowcaseModule(id: string | string[] | undefined) {
  const moduleId = resolveShowcaseModuleId(id);

  return moduleId ? showcaseModules.find((item) => item.id === moduleId) ?? null : null;
}
