import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = process.cwd();
const appJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'app.json'), 'utf8'));
const { extractExpoPathFromURL } = require('expo-router/build/fork/extractPathFromURL');

const violations = [];

function assert(condition, message) {
  if (!condition) {
    violations.push(message);
  }
}

assert(appJson.expo?.scheme === 'mirahealth', 'app.json must keep the mirahealth custom scheme');
assert(fs.existsSync(path.join(repoRoot, 'app/r/[ref_code].tsx')), 'referral route app/r/[ref_code].tsx must exist');

const routeUrls = [
  'mirahealth://r/DRNK22',
  'mirahealth:///r/DRNK22',
  'https://care.example.test/r/DRNK22',
];

for (const url of routeUrls) {
  assert(extractExpoPathFromURL([], url) === 'r/DRNK22', `${url} must resolve to Expo Router path r/DRNK22`);
}

process.env.EXPO_PUBLIC_WEB_ORIGIN = 'https://care.example.test';
const appConfig = require(path.join(repoRoot, 'app.config.js')).expo;
const androidIntent = appConfig.android?.intentFilters?.find((filter) =>
  filter?.data?.some((entry) => entry.scheme === 'https' && entry.host === 'care.example.test' && entry.pathPrefix === '/r'),
);

assert(appConfig.ios?.associatedDomains?.includes('applinks:care.example.test'), 'app.config.js must map EXPO_PUBLIC_WEB_ORIGIN to iOS associated domains');
assert(androidIntent?.autoVerify === true, 'app.config.js must map EXPO_PUBLIC_WEB_ORIGIN to an autoVerify Android /r app link');

const aasa = fs.readFileSync(path.join(repoRoot, 'public/.well-known/apple-app-site-association'), 'utf8');
const assetLinks = fs.readFileSync(path.join(repoRoot, 'public/.well-known/assetlinks.json'), 'utf8');

assert(aasa.includes('<APPLE_TEAM_ID>.<IOS_BUNDLE_ID>'), 'AASA template must keep Apple placeholders');
assert(aasa.includes('/r/*'), 'AASA template must scope links to /r/*');
assert(assetLinks.includes('<ANDROID_PACKAGE>'), 'assetlinks template must keep Android package placeholder');
assert(assetLinks.includes('<ANDROID_SHA256_FINGERPRINT>'), 'assetlinks template must keep Android SHA-256 placeholder');

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(violation);
  }
  process.exit(1);
}

console.log(`referral-link-audit: PASS (${routeUrls.length} URL shapes checked, app-link templates present)`);
