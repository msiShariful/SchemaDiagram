import { nanoid } from 'nanoid';
import type { DiagramRecord } from './store';

export const STARTER_DBML = `Table users {
  id integer [pk, increment]
  username varchar [not null, unique]
  role user_role [not null, default: 'member']
  created_at timestamp [default: \`now()\`]
}

Table posts {
  id integer [pk, increment]
  user_id integer [not null]
  title varchar [not null]
  body text [note: 'markdown supported']
  status post_status
  created_at timestamp
}

Table comments {
  id integer [pk, increment]
  post_id integer [not null]
  user_id integer [not null]
  body text
}

Enum user_role {
  admin
  member
}

Enum post_status {
  draft
  published
  archived
}

Ref: posts.user_id > users.id
Ref: comments.post_id > posts.id
Ref: comments.user_id > users.id
`;

export function createStarterDiagram(): DiagramRecord {
  const now = Date.now();
  return {
    id: nanoid(),
    name: 'Untitled',
    dbml: STARTER_DBML,
    positions: {},
    viewport: { x: 40, y: 40, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  };
}

/** "New Sample Diagram" (Plan 7): a rich e-commerce schema exercising every
 *  canvas feature — enums, groups, notes, header colors, and one ref of each
 *  shape (one-to-many, one-to-one, named+on-delete, composite, inline self-
 *  ref). Parse-verified against the installed @dbml/core 8.3.1. */
export const SAMPLE_DBML = `// E-commerce sample — exercises enums, groups, notes, header colors,
// and every ref shape the canvas can render.

Table customers [headerColor: #2196f3] {
  id integer [pk, increment]
  email varchar [not null, unique]
  full_name varchar [not null]
  tier customer_tier [not null, default: 'standard']
  created_at timestamp [default: \`now()\`]
}

Table customer_profiles [headerColor: #2196f3] {
  customer_id integer [pk]
  bio text [note: 'shown on public reviews']
  marketing_opt_in boolean [default: false]
}

Table products [headerColor: #4caf50] {
  id integer [pk, increment]
  sku varchar [not null, unique]
  name varchar [not null]
  price_cents integer [not null, note: 'always in the shop currency']
  status product_status [not null, default: 'draft']
}

Table categories [headerColor: #4caf50] {
  id integer [pk, increment]
  name varchar [not null]
  parent_id integer [ref: > categories.id, note: 'self-reference: subcategories']
}

Table product_categories [headerColor: #4caf50] {
  product_id integer [not null]
  category_id integer [not null]
  Note: 'join table: a product sits in many categories'
}

Table orders [headerColor: #ff9800] {
  id integer [pk, increment]
  customer_id integer [not null]
  status order_status [not null, default: 'cart']
  region varchar [not null]
  ordinal integer [not null, note: 'per-region order number']
  placed_at timestamp
}

Table order_items [headerColor: #ff9800] {
  order_id integer [not null]
  product_id integer [not null]
  quantity integer [not null, default: 1]
  unit_price_cents integer [not null]
}

Table shipments [headerColor: #9c27b0] {
  id integer [pk, increment]
  order_region varchar [not null]
  order_ordinal integer [not null]
  carrier varchar
  shipped_at timestamp
}

Enum customer_tier {
  standard
  gold
  platinum
}

Enum product_status {
  draft
  live
  retired
}

Enum order_status {
  cart
  placed
  paid
  shipped
  cancelled
}

TableGroup customers_grp [color: #2196f3] {
  customers
  customer_profiles
}

TableGroup catalog [color: #4caf50] {
  products
  categories
  product_categories
}

TableGroup fulfillment [color: #ff9800] {
  orders
  order_items
  shipments
}

Note onboarding {
  'Drag a field handle onto another field to draw a new ref.'
}

Ref: customer_profiles.customer_id - customers.id
Ref: orders.customer_id > customers.id
Ref order_lines: order_items.order_id > orders.id [delete: cascade]
Ref: order_items.product_id > products.id
Ref: product_categories.product_id > products.id
Ref: product_categories.category_id > categories.id
Ref: shipments.(order_region, order_ordinal) > orders.(region, ordinal)
`;
