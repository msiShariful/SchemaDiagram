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
