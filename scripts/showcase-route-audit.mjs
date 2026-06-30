import fs from 'node:fs/promises';
import path from 'node:path';
import * as ts from 'typescript';

const repoRoot = process.cwd();
const appRoot = path.join(repoRoot, 'app');
const registryRelativePath = 'lib/showcase/registry.ts';
const registryPath = path.join(repoRoot, registryRelativePath);
const args = new Set(process.argv.slice(2));

const EXCLUDED_ROUTES = new Map([
  ['/', 'showcase home is the module picker, not a module row'],
  ['/+html', 'expo-router document shell'],
  ['/+not-found', 'router safety net'],
  ['/tour/[module]', 'module tour shell generated from registry'],
  ['/more', 'tab navigation hub; S3 regenerates its rows from registry'],
  ['/order-status', 'legacy Stripe return redirect to /orders'],
  ['/prototype', 'legacy chat alias redirecting to /chat'],
  ['/staff-referral', 'legacy staff entry redirect to /sales-portal'],
  ['/r/[ref_code]', 'customer referral landing opened only from real sales-portal links'],
  ['/admin/conversations', 'live agent console (staff-only, no public demo fixture)'],
]);

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}

function stripQueryAndHash(value) {
  return value.split('?')[0].split('#')[0];
}

function unwrapExpression(node) {
  let current = node;

  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }

  return current;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return null;
}

function getProperty(objectNode, propertyName) {
  return objectNode.properties.find((property) => {
    if (!ts.isPropertyAssignment(property)) {
      return false;
    }

    return propertyNameText(property.name) === propertyName;
  });
}

function readStringProperty(objectNode, propertyName, sourceFile, violations, entryLabel) {
  const property = getProperty(objectNode, propertyName);

  if (!property) {
    violations.push(`${entryLabel}: missing registry property "${propertyName}"`);
    return null;
  }

  const value = unwrapExpression(property.initializer);

  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text;
  }

  violations.push(`${entryLabel}: property "${propertyName}" must be a string literal (${value.getText(sourceFile)})`);
  return null;
}

function readHrefProperty(objectNode, sourceFile, violations, entryLabel) {
  const property = getProperty(objectNode, 'href');

  if (!property) {
    violations.push(`${entryLabel}: missing registry property "href"`);
    return null;
  }

  const value = unwrapExpression(property.initializer);

  if (value.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }

  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text;
  }

  if (ts.isObjectLiteralExpression(value)) {
    const pathnameProperty = getProperty(value, 'pathname');
    const pathnameValue = pathnameProperty ? unwrapExpression(pathnameProperty.initializer) : null;

    if (pathnameValue && (ts.isStringLiteral(pathnameValue) || ts.isNoSubstitutionTemplateLiteral(pathnameValue))) {
      return pathnameValue.text;
    }
  }

  violations.push(`${entryLabel}: href must be null, a route string, or an object with a literal pathname (${value.getText(sourceFile)})`);
  return null;
}

function findShowcaseEntriesArray(sourceFile) {
  let entriesArray = null;

  function visit(node) {
    if (entriesArray) {
      return;
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'showcaseEntries' && node.initializer) {
      const initializer = unwrapExpression(node.initializer);

      if (ts.isArrayLiteralExpression(initializer)) {
        entriesArray = initializer;
        return;
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return entriesArray;
}

async function readRegistryEntries() {
  const registrySource = await fs.readFile(registryPath, 'utf8');
  const sourceFile = ts.createSourceFile(registryRelativePath, registrySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const entriesArray = findShowcaseEntriesArray(sourceFile);
  const violations = [];
  const entries = [];

  if (!entriesArray) {
    return {
      entries,
      registrySource,
      violations: [`${registryRelativePath}: unable to locate exported showcaseEntries array`],
    };
  }

  entriesArray.elements.forEach((element, index) => {
    const entryNode = unwrapExpression(element);
    const entryLabel = `${registryRelativePath}:showcaseEntries[${index}]`;

    if (!ts.isObjectLiteralExpression(entryNode)) {
      violations.push(`${entryLabel}: entry must be an object literal`);
      return;
    }

    const id = readStringProperty(entryNode, 'id', sourceFile, violations, entryLabel) ?? `entry-${index}`;
    const routePath = readStringProperty(entryNode, 'path', sourceFile, violations, id);
    const status = readStringProperty(entryNode, 'status', sourceFile, violations, id);
    const href = readHrefProperty(entryNode, sourceFile, violations, id);

    if (routePath && !routePath.startsWith('/')) {
      violations.push(`${id}: path must start with "/" (${routePath})`);
    }

    if (href && !href.startsWith('/')) {
      violations.push(`${id}: href must start with "/" (${href})`);
    }

    entries.push({
      href,
      id,
      path: routePath,
      status,
    });
  });

  if (args.has('--inject-missing-registry-route')) {
    entries.push({
      href: '/__showcase_missing_route__',
      id: '__audit_missing_registry_route__',
      path: '/__showcase_missing_route__',
      status: 'live',
    });
  }

  return { entries, registrySource, violations };
}

async function walkFiles(dir) {
  const dirEntries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of dirEntries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.tsx')) {
      files.push(fullPath);
    }
  }

  return files;
}

function routeFromAppFile(relativePath) {
  const withoutPrefix = normalizePath(relativePath).replace(/^app\//, '').replace(/\.tsx$/, '');
  const segments = withoutPrefix.split('/');
  const leaf = segments.at(-1);

  if (!leaf || leaf.startsWith('_')) {
    return null;
  }

  const routeSegments = segments.filter((segment) => !/^\(.+\)$/.test(segment));

  if (routeSegments.at(-1) === 'index') {
    routeSegments.pop();
  }

  return routeSegments.length === 0 ? '/' : `/${routeSegments.join('/')}`;
}

async function collectRealRoutes() {
  const files = await walkFiles(appRoot);
  const routes = new Map();

  for (const filePath of files) {
    const relativePath = normalizePath(path.relative(repoRoot, filePath));
    const route = routeFromAppFile(relativePath);

    if (route) {
      routes.set(route, relativePath);
    }
  }

  if (args.has('--inject-unregistered-route')) {
    routes.set('/__showcase_unregistered_route__', '<injected route>');
  }

  return routes;
}

function splitRoute(route) {
  return stripQueryAndHash(route).replace(/^\//, '').split('/').filter(Boolean);
}

function segmentMatches(templateSegment, routeSegment) {
  return /^\[\[?\.{0,3}[A-Za-z0-9_]+\]?\]$/.test(templateSegment) || templateSegment === routeSegment;
}

function routeTemplateMatches(templateRoute, targetRoute) {
  const templateSegments = splitRoute(templateRoute);
  const targetSegments = splitRoute(targetRoute);

  if (templateSegments.length !== targetSegments.length) {
    return false;
  }

  return templateSegments.every((segment, index) => segmentMatches(segment, targetSegments[index]));
}

function resolveRoute(target, realRoutes) {
  if (!target) {
    return null;
  }

  const cleanTarget = stripQueryAndHash(target);

  if (realRoutes.has(cleanTarget)) {
    return cleanTarget;
  }

  return [...realRoutes.keys()].find((route) => routeTemplateMatches(route, cleanTarget)) ?? null;
}

async function runAudit() {
  const [{ entries, violations: registryViolations }, realRoutes] = await Promise.all([readRegistryEntries(), collectRealRoutes()]);
  const violations = [...registryViolations];
  const registeredRoutes = new Set();

  for (const entry of entries) {
    if (!entry.path || !entry.status) {
      continue;
    }

    if (entry.status === 'planned') {
      if (entry.href !== null) {
        violations.push(`${entry.id}: planned entries must use href null`);
      }

      continue;
    }

    if (!entry.href) {
      violations.push(`${entry.id}: ${entry.status} entries must provide a href`);
      continue;
    }

    const hrefRoute = resolveRoute(entry.href, realRoutes);
    const pathRoute = resolveRoute(entry.path, realRoutes);

    if (!hrefRoute) {
      violations.push(`${entry.id}: href "${entry.href}" does not resolve to an app route`);
    }

    if (!pathRoute) {
      violations.push(`${entry.id}: path "${entry.path}" does not resolve to an app route`);
    }

    if (hrefRoute && pathRoute && hrefRoute !== pathRoute) {
      violations.push(`${entry.id}: href "${entry.href}" resolves to ${hrefRoute}, but path "${entry.path}" resolves to ${pathRoute}`);
    }

    if (hrefRoute) {
      registeredRoutes.add(hrefRoute);
    }

    if (pathRoute) {
      registeredRoutes.add(pathRoute);
    }

  }

  for (const [route, relativePath] of [...realRoutes.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (registeredRoutes.has(route) || EXCLUDED_ROUTES.has(route)) {
      continue;
    }

    violations.push(`${relativePath}: real route "${route}" is not registered in showcaseEntries or EXCLUDED_ROUTES`);
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(violation);
    }

    process.exit(1);
  }

  console.log(`showcase-route-audit: PASS (${entries.length} registry entries, ${realRoutes.size} app routes, ${EXCLUDED_ROUTES.size} excluded routes)`);
}

await runAudit();
