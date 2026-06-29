import type { HrefObject } from 'expo-router';
import type { ImageSourcePropType } from 'react-native';

export const showcaseModuleIds = ['referral', 'admin', 'ai-chat'] as const;

export type ShowcaseModuleId = (typeof showcaseModuleIds)[number];
export type ShowcaseStatus = 'live' | 'planned';
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
  sortOrder: number;
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
      'à¹€à¸›à¸´à¸”à¹à¸„à¹‡à¸•à¸•à¸²à¸¥à¹‡à¸­à¸à¹€à¸žà¸·à¹ˆà¸­à¸”à¸¹à¸§à¹ˆà¸²à¹‚à¸£à¸‡à¸žà¸¢à¸²à¸šà¸²à¸¥à¹à¸à¹‰à¹à¸žà¹‡à¸à¹€à¸à¸ˆ à¸£à¸²à¸„à¸² à¸£à¸¹à¸›à¸ à¸²à¸ž à¹à¸¥à¸°à¸ªà¸–à¸²à¸™à¸°à¸‚à¸²à¸¢à¹„à¸”à¹‰à¹€à¸­à¸‡',
      'à¹€à¸›à¸´à¸”à¸„à¸´à¸§à¸­à¸­à¹€à¸”à¸­à¸£à¹Œà¹€à¸žà¸·à¹ˆà¸­à¸”à¸¹à¸‡à¸²à¸™à¸«à¸¥à¸±à¸‡à¸šà¹‰à¸²à¸™à¸«à¸¥à¸±à¸‡à¸¥à¸¹à¸à¸„à¹‰à¸²à¸Šà¸³à¸£à¸°à¹€à¸‡à¸´à¸™à¸«à¸£à¸·à¸­à¸ªà¹ˆà¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ˆà¸­à¸‡',
      'à¹€à¸›à¸´à¸”à¸ˆà¸±à¸”à¸à¸²à¸£à¸ªà¸²à¸‚à¸²à¹€à¸žà¸·à¹ˆà¸­à¸”à¸¹à¸§à¹ˆà¸²à¸ªà¸²à¸‚à¸²à¹à¸¥à¸°à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸•à¸´à¸”à¸•à¹ˆà¸­à¸–à¸¹à¸à¹ƒà¸Šà¹‰à¸£à¹ˆà¸§à¸¡à¸à¸±à¸šà¸«à¸™à¹‰à¸²à¸‚à¸²à¸¢à¸ˆà¸£à¸´à¸‡',
      'à¹€à¸›à¸´à¸” dashboard live à¹€à¸žà¸·à¹ˆà¸­à¸”à¸¹ KPI à¸ˆà¸²à¸ backend à¸‚à¸­à¸‡ tenant à¹€à¸”à¸µà¸¢à¸§à¸à¸±à¸™',
    ],
    story_th: 'à¸£à¸°à¸šà¸šà¸«à¸¥à¸±à¸‡à¸šà¹‰à¸²à¸™à¸ªà¸³à¸«à¸£à¸±à¸šà¸—à¸µà¸¡à¹‚à¸£à¸‡à¸žà¸¢à¸²à¸šà¸²à¸¥à¸—à¸µà¹ˆà¸•à¹‰à¸­à¸‡à¸”à¸¹à¹à¸¥à¸ªà¸´à¸™à¸„à¹‰à¸² à¸­à¸­à¹€à¸”à¸­à¸£à¹Œ à¸ªà¸²à¸‚à¸² à¹à¸¥à¸°à¸‡à¸²à¸™ referral à¹ƒà¸™à¸—à¸µà¹ˆà¹€à¸”à¸µà¸¢à¸§',
    title_en: 'Admin Panel',
    title_th: 'à¸£à¸°à¸šà¸šà¸«à¸¥à¸±à¸‡à¸šà¹‰à¸²à¸™',
  },
  'ai-chat': {
    accent: '#40C9A2',
    eyebrow_en: 'Customer commerce',
    id: 'ai-chat',
    script_th: [
      'เปิดคำสั่งซื้อของฉันเพื่อดูรายการออเดอร์และ timeline จาก backend จริง',
      'à¹€à¸›à¸´à¸”à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸”à¹à¸žà¹‡à¸à¹€à¸à¸ˆà¹€à¸žà¸·à¹ˆà¸­à¸”à¸¹à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ªà¸´à¸™à¸„à¹‰à¸²à¸ˆà¸²à¸ catalog à¸ˆà¸£à¸´à¸‡',
      'เปิด AI Commerce Chat เพื่อให้ลูกค้าคุย ซื้อสินค้า ส่งข้อมูลจอง และติดตามคำสั่งซื้อจริง',
    ],
    story_th: 'à¸£à¸°à¸šà¸š AI Chat à¹à¸¥à¸° commerce à¸ªà¸³à¸«à¸£à¸±à¸šà¸¥à¸¹à¸à¸„à¹‰à¸² à¸•à¸±à¹‰à¸‡à¹à¸•à¹ˆà¸”à¸¹à¹à¸žà¹‡à¸à¹€à¸à¸ˆ à¸ªà¸£à¹‰à¸²à¸‡à¸­à¸­à¹€à¸”à¸­à¸£à¹Œ à¹„à¸›à¸ˆà¸™à¸–à¸¶à¸‡à¸•à¸´à¸”à¸•à¸²à¸¡à¸ªà¸–à¸²à¸™à¸°',
    title_en: 'AI Chat Commerce',
    title_th: 'AI Chat à¸œà¸¹à¹‰à¸Šà¹ˆà¸§à¸¢à¸‚à¸²à¸¢à¹à¸¥à¸°à¸”à¸¹à¹à¸¥',
  },
  referral: {
    accent: '#E9B44C',
    eyebrow_en: 'Growth engine',
    id: 'referral',
    script_th: [
      'à¹€à¸›à¸´à¸” sales-portal à¹€à¸žà¸·à¹ˆà¸­à¹ƒà¸«à¹‰à¸—à¸µà¸¡à¸‚à¸²à¸¢à¸«à¸£à¸·à¸­à¸«à¸¡à¸­à¸ªà¸£à¹‰à¸²à¸‡ referral code à¸ˆà¸£à¸´à¸‡ à¹à¸¥à¹‰à¸§à¸„à¸±à¸”à¸¥à¸­à¸à¸¥à¸´à¸‡à¸à¹Œà¸«à¸£à¸·à¸­ QR à¹ƒà¸«à¹‰à¸¥à¸¹à¸à¸„à¹‰à¸²',
      'à¹€à¸›à¸´à¸” workspace à¸‚à¸­à¸‡ partner à¹€à¸žà¸·à¹ˆà¸­à¸ªà¸£à¹‰à¸²à¸‡à¸­à¸­à¹€à¸”à¸­à¸£à¹Œà¸Šà¹ˆà¸§à¸¢à¸¥à¸¹à¸à¸„à¹‰à¸²à¹à¸¥à¸°à¸”à¸¹à¸¢à¸­à¸” commission',
      'à¹€à¸›à¸´à¸”à¸«à¸™à¹‰à¸² admin referrers à¹€à¸žà¸·à¹ˆà¸­à¹ƒà¸«à¹‰à¹‚à¸£à¸‡à¸žà¸¢à¸²à¸šà¸²à¸¥à¹€à¸«à¹‡à¸™à¸à¸²à¸£à¸ˆà¸±à¸”à¸à¸²à¸£à¸žà¸²à¸£à¹Œà¸—à¹€à¸™à¸­à¸£à¹Œà¹à¸¥à¸° commission',
    ],
    story_th: 'à¸£à¸°à¸šà¸šà¹à¸™à¸°à¸™à¸³à¸¥à¸¹à¸à¸„à¹‰à¸²à¸ªà¸³à¸«à¸£à¸±à¸šà¸«à¸¡à¸­ à¸žà¸²à¸£à¹Œà¸—à¹€à¸™à¸­à¸£à¹Œ à¹à¸¥à¸°à¸—à¸µà¸¡à¹‚à¸£à¸‡à¸žà¸¢à¸²à¸šà¸²à¸¥à¸—à¸µà¹ˆà¸•à¹‰à¸­à¸‡à¸à¸²à¸£ track attribution à¸–à¸¶à¸‡à¸¢à¸­à¸”à¸‚à¸²à¸¢',
    title_en: 'Referral Program',
    title_th: 'à¹‚à¸›à¸£à¹à¸à¸£à¸¡à¹à¸™à¸°à¸™à¸³à¸¥à¸¹à¸à¸„à¹‰à¸²',
  },
};

export const showcaseEntries: readonly ShowcaseEntry[] = [
  {
    auth: 'customer',
    sortOrder: 1,
    description_th: 'Real AI Sales Chat route. Uses the shared chat engine, product catalog, and order backend.',
    href: '/chat',
    id: 'ai-chat-live',
    label_en: 'AI Commerce Chat',
    label_th: 'AI Commerce Chat',
    module: 'ai-chat',
    path: '/chat',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 0,
    description_th: 'à¸¨à¸¹à¸™à¸¢à¹Œà¸£à¸§à¸¡à¸‡à¸²à¸™à¹à¸­à¸”à¸¡à¸´à¸™à¸ªà¸³à¸«à¸£à¸±à¸šà¹€à¸›à¸´à¸”à¹„à¸›à¸ˆà¸±à¸”à¸à¸²à¸£à¸ªà¸´à¸™à¸„à¹‰à¸² à¸„à¸´à¸§à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¸‹à¸·à¹‰à¸­ à¹à¸¥à¸°à¸‡à¸²à¸™à¸«à¸¥à¸±à¸‡à¸šà¹‰à¸²à¸™à¸«à¸¥à¸±à¸à¸‚à¸­à¸‡à¹‚à¸£à¸‡à¸žà¸¢à¸²à¸šà¸²à¸¥.',
    href: '/admin-panel',
    id: 'admin-operations-hub',
    label_en: 'Admin Operations Hub',
    label_th: 'à¸¨à¸¹à¸™à¸¢à¹Œà¸£à¸§à¸¡à¹à¸­à¸”à¸¡à¸´à¸™',
    module: 'admin',
    path: '/admin-panel',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 0,
    description_th: 'à¸«à¸™à¹‰à¸²à¹€à¸‚à¹‰à¸²à¸ªà¸¹à¹ˆà¸£à¸°à¸šà¸šà¸ªà¸³à¸«à¸£à¸±à¸šà¸—à¸µà¸¡à¸‡à¸²à¸™ Admin Panel à¸•à¸£à¸§à¸ˆà¸ªà¸´à¸—à¸˜à¸´à¹Œà¸ˆà¸²à¸ tenant_members à¸à¹ˆà¸­à¸™à¹€à¸‚à¹‰à¸²à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ˆà¸£à¸´à¸‡.',
    href: { pathname: '/login', params: { mode: 'admin', redirect: '/admin-panel' } },
    id: 'admin-login',
    label_en: 'Admin Login',
    label_th: 'à¹€à¸‚à¹‰à¸²à¸ªà¸¹à¹ˆà¸£à¸°à¸šà¸šà¸—à¸µà¸¡à¸‡à¸²à¸™',
    module: 'admin',
    path: '/login',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 0,
    description_th: 'à¸«à¸™à¹‰à¸²à¹€à¸‚à¹‰à¸²à¸ªà¸¹à¹ˆà¸£à¸°à¸šà¸šà¸ªà¸³à¸«à¸£à¸±à¸šà¸à¸¥à¸¸à¹ˆà¸¡ Referral à¹ƒà¸Šà¹‰ ref code à¸—à¸µà¹ˆ admin à¸ªà¸£à¹‰à¸²à¸‡à¹ƒà¸«à¹‰à¹€à¸žà¸·à¹ˆà¸­ claim à¹‚à¸›à¸£à¹„à¸Ÿà¸¥à¹Œà¸œà¸¹à¹‰à¹à¸™à¸°à¸™à¸³.',
    href: { pathname: '/login', params: { mode: 'referral', redirect: '/partner' } },
    id: 'referral-login',
    label_en: 'Referral Login',
    label_th: 'à¹€à¸‚à¹‰à¸²à¸ªà¸¹à¹ˆà¸£à¸°à¸šà¸š Referral',
    module: 'referral',
    path: '/login',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 2,
    description_th: 'à¸žà¸·à¹‰à¸™à¸—à¸µà¹ˆ partner à¹€à¸›à¸´à¸”à¸”à¸¹à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡à¹„à¸”à¹‰à¸—à¸±à¸™à¸—à¸µà¹‚à¸”à¸¢à¹„à¸¡à¹ˆà¸•à¹‰à¸­à¸‡à¸¥à¹‡à¸­à¸à¸­à¸´à¸™ à¹ƒà¸Šà¹‰à¹€à¸¥à¸·à¸­à¸à¹à¸žà¹‡à¸à¹€à¸à¸ˆ à¸à¸£à¸­à¸à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸œà¸¹à¹‰à¸‹à¸·à¹‰à¸­ à¸ªà¸£à¹‰à¸²à¸‡à¸­à¸­à¹€à¸”à¸­à¸£à¹Œà¹€à¸”à¹‚à¸¡ à¹à¸¥à¸°à¸”à¸¹ commission.',
    href: '/partner',
    id: 'referral-partner-workspace',
    label_en: 'Partner Referral Workspace',
    label_th: 'à¸žà¸·à¹‰à¸™à¸—à¸µà¹ˆà¸žà¸²à¸£à¹Œà¸—à¹€à¸™à¸­à¸£à¹Œ',
    module: 'referral',
    path: '/partner',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 3,
    description_th: 'à¸«à¸™à¹‰à¸²à¹à¸­à¸”à¸¡à¸´à¸™à¸—à¸µà¹ˆà¹€à¸›à¸´à¸”à¸”à¸¹ referrer à¹à¸¥à¸° commission à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡à¹„à¸”à¹‰à¸—à¸±à¸™à¸—à¸µ; à¸–à¹‰à¸²à¸¡à¸µà¸ªà¸´à¸—à¸˜à¸´à¹Œà¹à¸­à¸”à¸¡à¸´à¸™à¸ˆà¸¶à¸‡à¹à¸à¹‰à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ˆà¸£à¸´à¸‡à¹„à¸”à¹‰.',
    href: '/admin/referrers',
    id: 'referral-admin-referrers',
    label_en: 'Referrers And Commissions',
    label_th: 'à¸ˆà¸±à¸”à¸à¸²à¸£à¸œà¸¹à¹‰à¹à¸™à¸°à¸™à¸³à¹à¸¥à¸°à¸„à¹ˆà¸²à¸„à¸­à¸¡à¸¡à¸´à¸Šà¸Šà¸±à¸™',
    module: 'referral',
    path: '/admin/referrers',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 1,
    description_th: 'à¸žà¸·à¹‰à¸™à¸—à¸µà¹ˆà¸‚à¸²à¸¢à¸‚à¸­à¸‡à¸—à¸µà¸¡à¹‚à¸£à¸‡à¸žà¸¢à¸²à¸šà¸²à¸¥à¸ªà¸³à¸«à¸£à¸±à¸šà¸”à¸¹à¸ªà¸´à¸™à¸„à¹‰à¸² à¸ªà¸£à¹‰à¸²à¸‡à¸¥à¸´à¸‡à¸à¹Œ referral à¹à¸¥à¸°à¸•à¸´à¸”à¸•à¸²à¸¡ commission à¹ƒà¸™ flow à¹€à¸”à¸µà¸¢à¸§.',
    href: '/sales-portal',
    id: 'referral-sales-portal',
    label_en: 'Sales Portal',
    label_th: 'à¸žà¸­à¸£à¹Œà¸—à¸±à¸¥à¸—à¸µà¸¡à¸‚à¸²à¸¢',
    module: 'referral',
    path: '/sales-portal',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 1,
    description_th: 'à¸«à¸™à¹‰à¸²à¹à¸­à¸”à¸¡à¸´à¸™à¸—à¸µà¹ˆà¹€à¸›à¸´à¸”à¸”à¸¹ catalog à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡à¹„à¸”à¹‰à¸—à¸±à¸™à¸—à¸µ; à¸–à¹‰à¸²à¸¡à¸µà¸ªà¸´à¸—à¸˜à¸´à¹Œà¹à¸­à¸”à¸¡à¸´à¸™à¸ˆà¸¶à¸‡à¸­à¹ˆà¸²à¸™à¹à¸¥à¸°à¸šà¸±à¸™à¸—à¸¶à¸à¸ªà¸´à¸™à¸„à¹‰à¸²à¹‚à¸£à¸‡à¸žà¸¢à¸²à¸šà¸²à¸¥à¸ˆà¸£à¸´à¸‡.',
    href: '/admin/catalog',
    id: 'admin-catalog',
    label_en: 'Product Catalog Admin',
    label_th: 'à¸ˆà¸±à¸”à¸à¸²à¸£à¹à¸„à¹‡à¸•à¸•à¸²à¸¥à¹‡à¸­à¸',
    module: 'admin',
    path: '/admin/catalog',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 2,
    description_th: 'à¸„à¸´à¸§à¸­à¸­à¹€à¸”à¸­à¸£à¹Œà¹à¸­à¸”à¸¡à¸´à¸™à¸—à¸µà¹ˆà¹€à¸›à¸´à¸”à¸”à¸¹à¸­à¸­à¹€à¸”à¸­à¸£à¹Œà¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡à¹„à¸”à¹‰à¸—à¸±à¸™à¸—à¸µ; à¸–à¹‰à¸²à¸¡à¸µà¸ªà¸´à¸—à¸˜à¸´à¹Œà¹à¸­à¸”à¸¡à¸´à¸™à¸ˆà¸¶à¸‡à¸­à¹ˆà¸²à¸™à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¸‹à¸·à¹‰à¸­à¸ˆà¸£à¸´à¸‡à¹à¸¥à¸°à¹€à¸£à¸µà¸¢à¸ action à¸«à¸¥à¸±à¸‡à¸šà¹‰à¸²à¸™.',
    href: '/admin/orders',
    id: 'admin-orders',
    label_en: 'Orders Queue',
    label_th: 'à¸„à¸´à¸§à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¸‹à¸·à¹‰à¸­',
    module: 'admin',
    path: '/admin/orders',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 3,
    description_th: 'à¸«à¸™à¹‰à¸²à¹à¸­à¸”à¸¡à¸´à¸™à¸—à¸µà¹ˆà¹€à¸›à¸´à¸”à¸”à¸¹à¸ªà¸²à¸‚à¸²à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡à¹„à¸”à¹‰à¸—à¸±à¸™à¸—à¸µ; à¸–à¹‰à¸²à¸¡à¸µà¸ªà¸´à¸—à¸˜à¸´à¹Œà¹à¸­à¸”à¸¡à¸´à¸™à¸ˆà¸¶à¸‡à¸­à¹ˆà¸²à¸™à¹à¸¥à¸°à¸šà¸±à¸™à¸—à¸¶à¸à¸ªà¸²à¸‚à¸²à¸ˆà¸£à¸´à¸‡à¸‚à¸­à¸‡ tenant.',
    href: '/admin/branches',
    id: 'admin-branches',
    label_en: 'Branch Management',
    label_th: 'à¸ˆà¸±à¸”à¸à¸²à¸£à¸ªà¸²à¸‚à¸²',
    module: 'admin',
    path: '/admin/branches',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 4,
    description_th: 'à¸«à¸™à¹‰à¸²à¹€à¸”à¸µà¸¢à¸§à¸à¸±à¸šà¸£à¸°à¸šà¸š Referral à¹€à¸›à¸´à¸”à¸”à¸¹à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸•à¸±à¸§à¸­à¸¢à¹ˆà¸²à¸‡à¹„à¸”à¹‰à¸—à¸±à¸™à¸—à¸µ à¹à¸¥à¸°à¸ˆà¸±à¸”à¸à¸²à¸£ referrer/commission à¸ˆà¸£à¸´à¸‡à¹€à¸¡à¸·à¹ˆà¸­à¸¡à¸µà¸ªà¸´à¸—à¸˜à¸´à¹Œ.',
    href: '/admin/referrers',
    id: 'admin-referrers-shared',
    label_en: 'Shared Referrer Admin',
    label_th: 'à¸žà¸²à¸£à¹Œà¸—à¹€à¸™à¸­à¸£à¹Œà¹à¸¥à¸°à¸„à¹ˆà¸²à¸„à¸­à¸¡à¸¡à¸´à¸Šà¸Šà¸±à¸™',
    module: 'admin',
    path: '/admin/referrers',
    poster: null,
    sharedWithModule: 'referral',
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 5,
    description_th: 'à¸«à¸™à¹‰à¸² live dashboard à¸ªà¸³à¸«à¸£à¸±à¸šà¸ à¸²à¸žà¸£à¸§à¸¡ KPI à¸­à¸­à¹€à¸”à¸­à¸£à¹Œ à¸¢à¸­à¸”à¸‚à¸²à¸¢ à¸ªà¸´à¸™à¸„à¹‰à¸² à¸ªà¸²à¸‚à¸² à¹à¸¥à¸° referral à¸ˆà¸²à¸ backend à¸‚à¸­à¸‡ tenant.',
    href: '/admin/dashboard',
    id: 'admin-dashboard',
    label_en: 'Admin KPI Dashboard',
    label_th: 'à¸ à¸²à¸žà¸£à¸§à¸¡à¸£à¹‰à¸²à¸™',
    module: 'admin',
    path: '/admin/dashboard',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 1,
    description_th: 'Customer login for AI Chat history and orders.',
    href: { pathname: '/login', params: { mode: 'chat', redirect: '/chat' } },
    id: 'ai-chat-login',
    label_en: 'Chat AI Login',
    label_th: 'à¹€à¸‚à¹‰à¸²à¸ªà¸¹à¹ˆà¸£à¸°à¸šà¸šà¸¥à¸¹à¸à¸„à¹‰à¸²',
    module: 'ai-chat',
    path: '/login',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 2,
    description_th: 'Real customer order status page. Reads from backend with no mock fallback.',
    href: '/orders',
    id: 'ai-chat-orders',
    label_en: 'My Orders',
    label_th: 'à¸„à¸³à¸ªà¸±à¹ˆà¸‡à¸‹à¸·à¹‰à¸­à¸‚à¸­à¸‡à¸‰à¸±à¸™',
    module: 'ai-chat',
    path: '/orders',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 3,
    description_th: 'à¸«à¸™à¹‰à¸²à¸­à¹ˆà¸²à¸™à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸”à¹à¸žà¹‡à¸à¹€à¸à¸ˆà¸ˆà¸²à¸ catalog à¸ˆà¸£à¸´à¸‡à¸•à¸²à¸¡ productId à¸«à¸£à¸·à¸­ catalogKey.',
    href: '/package-detail',
    id: 'ai-chat-package-detail',
    label_en: 'Package Detail',
    label_th: 'à¸£à¸²à¸¢à¸¥à¸°à¹€à¸­à¸µà¸¢à¸”à¹à¸žà¹‡à¸à¹€à¸à¸ˆ',
    module: 'ai-chat',
    path: '/package-detail',
    poster: null,
    status: 'live',
  },
  {
    auth: 'none',
    sortOrder: 4,
    description_th: 'หน้าติดตาม checkout ที่อ่าน catalog จริงและส่งต่อไปยังรายการคำสั่งซื้อของลูกค้า.',
    href: '/checkout',
    id: 'ai-chat-checkout',
    label_en: 'Checkout Follow Up',
    label_th: 'ติดตามการสั่งซื้อ',
    module: 'ai-chat',
    path: '/checkout',
    poster: null,
    status: 'live',
  },
];

const legacyModuleAliases: Partial<Record<string, ShowcaseModuleId>> = {};

const statusBadgeLabels: Record<ShowcaseStatus, string> = {
  live: 'LIVE',
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
    .sort((left, right) => left.sortOrder - right.sortOrder || left.label_th.localeCompare(right.label_th, 'th'));
}

function toPage(entry: ShowcaseEntry): ShowcasePage | null {
  const href = entry.href;

  if (href === null) {
    return null;
  }

  return {
    auth: entry.auth,
    badge: statusBadgeLabels[entry.status],
    sortOrder: entry.sortOrder,
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

