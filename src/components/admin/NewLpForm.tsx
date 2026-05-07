/**
 * NewLpForm
 *
 * Form for creating a new LP. The slug becomes the public URL path,
 * so the field is given top billing with a live URL preview to make
 * the URL-shape obvious before the user commits.
 *
 * Validation mirrors POST /api/lps server-side rules but happens
 * client-first for fast feedback. The server is still the source of
 * truth (uniqueness, reserved words, etc.).
 */

import { useState } from 'react';
import {
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
} from '../../lib/slugs';
import { useAdminPublicOrigin } from '../../lib/admin-public-url';

const SLUG_MIN = SLUG_MIN_LENGTH;
const SLUG_MAX = SLUG_MAX_LENGTH;

type ApiError = { success: false; error: { code: string; message: string } };

export default function NewLpForm() {
  const [slug, setSlug] = useState('');
  const origin = useAdminPublicOrigin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirror the server's normalization so the preview matches what's
  // actually saved.
  const normalized = slug.trim().toLowerCase();
  const slugError = clientValidate(normalized);

  const previewUrl = normalized
    ? `${origin}/${normalized}`
    : `${origin}/<URLの一部>`;

  async function submit() {
    if (busy) return;
    setError(null);

    if (slugError) {
      setError(slugError);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/lps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: normalized }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, '作成失敗'));
      }
      const json = (await res.json()) as {
        success: true;
        data: { id: string };
      };
      window.location.href = `/admin/lps/${json.data.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submit();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-gray-700">
            URL末尾(slug)
            <span className="ml-1 text-red-600">*</span>
          </span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="例:my-lp / coaching / 2026-spring"
            // The browser blocks submit before our React handler runs,
            // so the operator gets immediate feedback if the field is
            // empty or has an invalid character.
            required
            minLength={SLUG_MIN}
            maxLength={SLUG_MAX}
            // Pattern mirrors src/lib/slugs.ts:SLUG_PATTERN. The `pattern`
            // attribute anchors implicitly so omit the ^ / $.
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            title="半角英数字とハイフンのみ(先頭・末尾はハイフン不可)"
            autoFocus
            className="px-3 py-2 border border-gray-300 rounded text-base focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </label>
        <p className="text-xs text-gray-500 mt-1.5">
          半角英数字とハイフン(-)のみ・後から編集画面で変更可能
        </p>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded p-3">
        <p className="text-xs font-medium text-gray-600 mb-1">
          公開後のURL(プレビュー)
        </p>
        <code className="block text-sm font-mono text-gray-800 break-all">
          {previewUrl}
        </code>
      </div>

      {(slugError || error) && (
        <div className="px-3 py-2 rounded bg-red-50 border border-red-200 text-sm text-red-700">
          {error ?? slugError}
        </div>
      )}

      <div className="flex items-center gap-2 justify-end">
        <a
          href="/admin"
          className="px-4 py-2 text-sm font-medium rounded text-gray-700 hover:bg-gray-100"
        >
          キャンセル
        </a>
        <button
          type="submit"
          disabled={busy || !!slugError || normalized.length === 0}
          className="px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? '作成中...' : 'LP を作成'}
        </button>
      </div>
    </form>
  );
}

function clientValidate(slug: string): string | null {
  if (slug.length === 0) return null; // empty -> no error yet
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX)
    return `${SLUG_MIN}〜${SLUG_MAX}文字で入力してください`;
  if (!SLUG_PATTERN.test(slug))
    return '半角英数字とハイフンのみ使えます(先頭・末尾はハイフン不可)';
  if (RESERVED_SLUGS.has(slug))
    return `「${slug}」は予約語のため使えません`;
  return null;
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}
