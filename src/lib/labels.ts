/**
 * Japanese display labels for enum-like values stored in the DB.
 *
 * Kept separate from the schema so the DB can hold stable English
 * tokens (`published`, `owner`, ...) while every admin-facing
 * surface renders the same Japanese phrasing.
 */

export type LpStatus =
  | 'draft'
  | 'published'
  | 'preview'
  | 'archived'
  | 'trash';

export type UserRole = 'owner' | 'editor';

export const STATUS_LABELS: Record<
  LpStatus,
  { label: string; classes: string }
> = {
  draft: { label: '下書き', classes: 'bg-gray-200 text-gray-700' },
  published: { label: '公開中', classes: 'bg-emerald-100 text-emerald-800' },
  preview: { label: 'プレビュー', classes: 'bg-blue-100 text-blue-800' },
  archived: { label: 'アーカイブ', classes: 'bg-yellow-100 text-yellow-800' },
  trash: { label: 'ゴミ箱', classes: 'bg-red-100 text-red-700' },
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'オーナー',
  editor: '編集者',
};

export function statusInfo(status: string): { label: string; classes: string } {
  return (
    STATUS_LABELS[status as LpStatus] ?? {
      label: status,
      classes: 'bg-gray-200 text-gray-700',
    }
  );
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as UserRole] ?? role;
}
