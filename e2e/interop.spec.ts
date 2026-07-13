import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { STARTER_TABLE_COUNT } from './helpers';

const DIALECTS = [
  {
    kind: 'postgres',
    sql: 'CREATE TABLE invoices (id integer PRIMARY KEY, customer varchar(80) NOT NULL, total numeric);',
    table: 'invoices',
  },
  {
    kind: 'mysql',
    sql: 'CREATE TABLE shipments (id INT PRIMARY KEY, weight DECIMAL(10,2) NOT NULL);',
    table: 'shipments',
  },
  {
    kind: 'mssql',
    sql: 'CREATE TABLE payments (id INT PRIMARY KEY, amount DECIMAL(10,2) NOT NULL);',
    table: 'payments',
  },
  {
    kind: 'oracle',
    sql: 'CREATE TABLE refunds (id NUMBER PRIMARY KEY, amount NUMBER(10,2) NOT NULL);',
    table: 'refunds',
  },
] as const;

test('SQL import per dialect creates a NEW diagram each time, never overwriting (spec §10)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);

  for (const { kind, sql, table } of DIALECTS) {
    // exact: true — after the first import the diagram-rename button reads
    // "Imported ✎" (importSql/importDiagram's baseName fallback), which is
    // a substring match for a loose "Import" locator on later iterations.
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.locator('.dialog select').selectOption(kind);
    await page.locator('.dialog-text').fill(sql);
    await page.getByRole('button', { name: 'Import as new diagram' }).click();
    await expect(page.locator('.dialog')).toBeHidden(); // closed on success
    await expect(page.locator('.table-node')).toHaveCount(1); // the import is now current
    await expect(page.locator('.table-title').filter({ hasText: table })).toBeVisible();
  }

  // starter + one NEW diagram per dialect — nothing was overwritten
  await page.getByRole('button', { name: /diagrams/ }).click();
  await expect(page.locator('.diagram-list li')).toHaveCount(1 + DIALECTS.length);
});

test('every export format downloads (spec §10: "export each format")', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-node')).toHaveCount(STARTER_TABLE_COUNT);
  await expect(page.locator('.statusbar .status-ok')).toBeVisible(); // SQL items enable on clean parse

  // The menu closes after every item, so each export reopens it.
  const exportItem = async (item: string) => {
    await page.getByRole('button', { name: /export/ }).click();
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: item }).click();
    return event;
  };

  const dbml = await exportItem('DBML (.dbml)');
  expect(dbml.suggestedFilename()).toBe('Untitled.dbml');
  expect(readFileSync(await dbml.path(), 'utf8')).toContain('Table users');

  for (const { dialect, label } of [
    { dialect: 'postgres', label: 'SQL — PostgreSQL' },
    { dialect: 'mysql', label: 'SQL — MySQL' },
    { dialect: 'mssql', label: 'SQL — SQL Server' },
    { dialect: 'oracle', label: 'SQL — Oracle' },
  ] as const) {
    const sql = await exportItem(label); // the first one pays the lazy @dbml/core chunk load
    expect(sql.suggestedFilename()).toBe(`Untitled.${dialect}.sql`);
    expect(readFileSync(await sql.path(), 'utf8')).toContain('CREATE TABLE');
  }

  const svg = await exportItem('SVG (.svg)');
  expect(svg.suggestedFilename()).toBe('Untitled.svg');
  expect(readFileSync(await svg.path(), 'utf8')).toContain('<svg');

  const png = await exportItem('PNG (2x)'); // binary: download event + filename only
  expect(png.suggestedFilename()).toBe('Untitled.png');

  const proj = await exportItem('Project file (.json)');
  expect(proj.suggestedFilename()).toBe('Untitled.json');
  const project = JSON.parse(readFileSync(await proj.path(), 'utf8')) as {
    version: number;
    name: string;
    dbml: string;
    layout: Record<string, unknown>;
  };
  expect(project.version).toBe(1);
  expect(project.name).toBe('Untitled');
  expect(project.dbml).toContain('Table users');
  expect(Object.keys(project.layout)).toContain('public.users'); // positions captured
});
