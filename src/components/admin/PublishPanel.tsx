/**
 * PublishPanel
 *
 * Renders the LP's public URL prominently at the top of the edit
 * screen along with quick-copy and inline editing of the LP-level
 * settings (max width, custom domain).
 *
 * Visible behavior depends on status:
 * - published: shows the canonical /<slug> URL with a copy button
 * - other:     explains that the URL becomes active after publishing
 *
 * Settings (maxWidth, customDomain) are editable regardless of
 * status — they take effect when the LP is served.
 */

import { useEffect, useRef, useState } from 'react';
import { RESERVED_SLUGS, SLUG_PATTERN } from '../../lib/slugs';
import { LP_CONTENT_SAVED } from '../../lib/lp-events';
import { useAdminPublicOrigin } from '../../lib/admin-public-url';

interface Props {
  lpId: string;
  slug: string;
  isPublished: boolean;
  initialMaxWidth: number;
  /** ISO datetime of when the LP becomes visible. null = no schedule. */
  initialPublishAt: string | null;
  /** ISO datetime of when the LP stops being visible. null = no expiry. */
  initialUnpublishAt: string | null;
  /** Whether the LP currently has a password set. The actual password
   * is never sent to the client — we just need to know the on/off state. */
  initialPasswordProtected: boolean;
  /** True when the working copy has edits that have not yet been
   * pushed to the public URL via "公開を更新". Recomputed on focus. */
  initialHasPendingChanges: boolean;
  /** Per-LP body background color (hex) painted around the centred LP.
   *  null = use the default white. */
  initialBackgroundColor: string | null;
  /** Decoration around the centred LP body so it stands out from the
   *  surrounding background. null = no decoration. */
  initialFrameStyle: 'line' | 'shadow' | 'none' | null;
}

type FrameStyle = 'none' | 'line' | 'shadow';

type ApiError = { success: false; error: { code: string; message: string } };

export default function PublishPanel({
  lpId,
  slug: initialSlug,
  isPublished,
  initialMaxWidth,
  initialPublishAt,
  initialUnpublishAt,
  initialPasswordProtected,
  initialHasPendingChanges,
  initialBackgroundColor,
  initialFrameStyle,
}: Props) {
  const DEFAULT_BG = '#ffffff';
  const origin = useAdminPublicOrigin();
  const [hasPending, setHasPending] = useState(initialHasPendingChanges);
  const [republishing, setRepublishing] = useState(false);
  // 「公開を更新」のフローティング表示用。インライン版バナーが viewport
  // から外れた時(= 編集者が下にスクロールしている時)だけ右上に出す。
  const inlineBannerRef = useRef<HTMLDivElement | null>(null);
  const [inlineBannerVisible, setInlineBannerVisible] = useState(true);
  // パスワード保護・公開スケジュールはオプション扱い。LP 編集画面の
  // ファーストビューを軽くするため、何も設定されていなければ畳む。
  const hasSchedule = Boolean(initialPublishAt || initialUnpublishAt);
  const [detailsOpen, setDetailsOpen] = useState(
    initialPasswordProtected || hasSchedule
  );
  const [slug, setSlug] = useState(initialSlug);
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState(initialSlug);
  const [savingSlug, setSavingSlug] = useState(false);
  const [maxWidth, setMaxWidth] = useState(initialMaxWidth);
  const [savingMaxWidth, setSavingMaxWidth] = useState(false);
  const [bgColor, setBgColor] = useState(initialBackgroundColor ?? DEFAULT_BG);
  const [savingBg, setSavingBg] = useState(false);
  const [savedInitialBg, setSavedInitialBg] = useState(initialBackgroundColor);
  const [frameStyle, setFrameStyle] = useState<FrameStyle>(
    (initialFrameStyle as FrameStyle | null) ?? 'none'
  );
  const [savingFrame, setSavingFrame] = useState(false);
  const [copied, setCopied] = useState(false);
  const [publishAt, setPublishAt] = useState<string>(
    toLocalInput(initialPublishAt)
  );
  const [unpublishAt, setUnpublishAt] = useState<string>(
    toLocalInput(initialUnpublishAt)
  );
  const [savingSchedule, setSavingSchedule] = useState<
    'publish' | 'unpublish' | null
  >(null);
  const [passwordProtected, setPasswordProtected] = useState(
    initialPasswordProtected
  );
  const [passwordDraft, setPasswordDraft] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Saves elsewhere on the page (CTA edits, section reorders, image
  // swaps) flip the LP into a "pending" state we don't observe from
  // here. Refetch when:
  //   - another island fires `lp:contentSaved` after a successful PUT
  //     (covers the in-page save → close-modal flow)
  //   - the tab regains focus (covers external mutations like a curl
  //     PUT or the LP being edited from a second window)
  useEffect(() => {
    if (!isPublished) return;
    let cancelled = false;
    async function refresh() {
      try {
        const res = await fetch(`/api/lps/${lpId}`);
        if (!res.ok) return;
        const json = (await res.json()) as {
          success: true;
          data: { hasPendingChanges?: boolean };
        };
        if (!cancelled && typeof json.data?.hasPendingChanges === 'boolean') {
          setHasPending(json.data.hasPendingChanges);
        }
      } catch {
        // ignore — stale badge is recoverable, alerting isn't worth it.
      }
    }
    function onFocus() {
      void refresh();
    }
    function onContentSaved() {
      void refresh();
    }
    window.addEventListener('focus', onFocus);
    window.addEventListener(LP_CONTENT_SAVED, onContentSaved);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(LP_CONTENT_SAVED, onContentSaved);
    };
  }, [isPublished, lpId]);

  // インライン版バナーの可視性を IntersectionObserver で監視。見えなく
  // なったら右上のフローティング版を出す。"-56px" は sticky header の
  // 高さぶんで、ヘッダーに被って見えてないものは "見えてない" 扱いに
  // しないと、ヘッダーの裏に隠れた瞬間にフローティングが出てこない。
  useEffect(() => {
    const el = inlineBannerRef.current;
    if (!el || !hasPending) {
      setInlineBannerVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInlineBannerVisible(entry.isIntersecting),
      { rootMargin: '-56px 0px 0px 0px', threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasPending]);

  async function republish() {
    if (republishing) return;
    setRepublishing(true);
    try {
      const res = await fetch(`/api/lps/${lpId}/republish`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(await readApiError(res, '公開更新失敗'));
      setHasPending(false);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRepublishing(false);
    }
  }

  const publicUrl = origin ? `${origin}/${slug}` : `/${slug}`;

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  async function patch(body: object, onDone: () => void) {
    try {
      const res = await fetch(`/api/lps/${lpId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readApiError(res, '更新失敗'));
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      onDone();
    }
  }

  async function commitMaxWidth() {
    if (maxWidth === initialMaxWidth) return;
    setSavingMaxWidth(true);
    await patch({ maxWidth }, () => setSavingMaxWidth(false));
  }

  async function commitBgColor(next: string | null) {
    const normalized = next ? next.trim().toLowerCase() : null;
    if (normalized === savedInitialBg) return;
    if (normalized && !/^#[0-9a-f]{6}$/.test(normalized)) return;
    setSavingBg(true);
    await patch({ backgroundColor: normalized }, () => setSavingBg(false));
    setSavedInitialBg(normalized);
  }

  async function commitFrameStyle(next: FrameStyle) {
    setFrameStyle(next);
    setSavingFrame(true);
    // 'none' goes to the API as null so the column reads NULL when no
    // decoration is wanted — keeps the schema's "absence" cleaner.
    await patch({ frameStyle: next === 'none' ? null : next }, () =>
      setSavingFrame(false)
    );
  }

  function slugErrorFor(value: string): string | null {
    if (value.length === 0) return 'URL末尾を入力してください';
    if (value.length > 100) return '100文字以下にしてください';
    if (!SLUG_PATTERN.test(value))
      return '半角英数字とハイフンのみ使えます(先頭・末尾はハイフン不可)';
    if (RESERVED_SLUGS.has(value))
      return `「${value}」は予約語のため使えません`;
    return null;
  }

  async function commitSlug() {
    const next = slugDraft.trim().toLowerCase();
    if (next === slug) {
      setEditingSlug(false);
      return;
    }
    const err = slugErrorFor(next);
    if (err) {
      alert(err);
      return;
    }
    if (
      isPublished &&
      !confirm(
        `公開URLを「/${next}」に変更しますか?\n\n以前のURL「/${slug}」は404になります。SNSなどに共有済みのリンクが切れるので、共有先の更新が必要です。`
      )
    ) {
      return;
    }
    setSavingSlug(true);
    try {
      const res = await fetch(`/api/lps/${lpId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: next }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '更新失敗'));
      setSlug(next);
      setEditingSlug(false);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingSlug(false);
    }
  }

  function startEditSlug() {
    setSlugDraft(slug);
    setEditingSlug(true);
  }

  function cancelEditSlug() {
    setEditingSlug(false);
    setSlugDraft(slug);
  }

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 mb-6">
      {isPublished && hasPending && (
        <div
          ref={inlineBannerRef}
          className="mb-4 flex items-center justify-between gap-3 flex-wrap rounded border border-amber-300 bg-amber-50 px-3 py-2"
        >
          <div className="text-sm text-amber-900 min-w-0">
            <span className="font-semibold">未反映の変更があります。</span>
            <span className="ml-1 text-xs text-amber-800">
              「公開を更新」を押すまで、編集内容は公開URLに反映されません。
            </span>
          </div>
          <button
            type="button"
            onClick={republish}
            disabled={republishing}
            className="shrink-0 px-3 py-1.5 text-sm font-medium rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {republishing ? '更新中...' : '公開を更新'}
          </button>
        </div>
      )}

      {isPublished && hasPending && !inlineBannerVisible && (
        // ヘッダー直下のフローティング通知。インラインのバナーが viewport
        // から消えた時だけ出す。クリックで同じ republish() を叩く。
        <div
          className="fixed left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 rounded-full border border-amber-300 bg-amber-50/95 backdrop-blur px-4 py-2 shadow-lg"
          style={{ top: '64px' }}
          role="status"
        >
          <span className="text-sm font-semibold text-amber-900">
            未反映の変更があります
          </span>
          <button
            type="button"
            onClick={republish}
            disabled={republishing}
            className="shrink-0 px-3 py-1 text-xs font-medium rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {republishing ? '更新中...' : '公開を更新'}
          </button>
        </div>
      )}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-gray-700">公開URL</h2>
            {!editingSlug && (
              <button
                type="button"
                onClick={startEditSlug}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
              >
                URL末尾を変更
              </button>
            )}
          </div>

          {editingSlug ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1 flex-wrap">
                <code className="text-xs font-mono text-gray-500">
                  {origin}/
                </code>
                <input
                  type="text"
                  value={slugDraft}
                  onChange={(e) => setSlugDraft(e.target.value)}
                  autoFocus
                  maxLength={100}
                  className="flex-1 min-w-[120px] px-2 py-1 border border-gray-300 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <button
                  type="button"
                  onClick={commitSlug}
                  disabled={savingSlug}
                  className="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingSlug ? '保存中...' : '保存'}
                </button>
                <button
                  type="button"
                  onClick={cancelEditSlug}
                  disabled={savingSlug}
                  className="px-2 py-1 text-xs rounded text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  キャンセル
                </button>
              </div>
              {isPublished && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  ⚠ 公開後の変更は、以前のURLが即404になります(リダイレクトは未対応)。<br />共有済みのリンク更新が必要です。
                </p>
              )}
            </div>
          ) : isPublished ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 px-2 py-1.5 text-xs font-mono bg-gray-50 border border-gray-200 rounded truncate">
                {publicUrl}
              </code>
              <button
                type="button"
                onClick={copyUrl}
                className={`px-3 py-1.5 text-xs font-medium rounded shrink-0 ${
                  copied
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                }`}
              >
                {copied ? '✓ コピー済み' : '📋 コピー'}
              </button>
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-xs font-medium rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                ↗ 開く
              </a>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-700 mr-2">
                未公開
              </span>
              「公開する」ボタンを押すと <code className="font-mono text-xs">{`/${slug}`}</code> がアクセス可能になります
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-medium text-gray-600">
            LP最大幅(px)
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={maxWidth}
              onChange={(e) => setMaxWidth(Number(e.target.value) || 0)}
              onBlur={commitMaxWidth}
              min={320}
              max={1920}
              className="min-w-0 flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            {savingMaxWidth && (
              <span className="text-xs text-gray-400">保存中...</span>
            )}
          </div>
          <span className="text-[11px] text-gray-500">
            画像LPの推奨は 750px。広い数値だと画像が拡大、狭いと両端に余白
          </span>
        </label>

        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-medium text-gray-600">
            背景色(LP両脇の余白)
          </span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              onBlur={() => commitBgColor(bgColor)}
              className="w-10 h-9 rounded border border-gray-300 shrink-0"
            />
            <input
              type="text"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              onBlur={() => commitBgColor(bgColor)}
              placeholder="#ffffff"
              className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            {savedInitialBg && (
              <button
                type="button"
                onClick={() => {
                  setBgColor(DEFAULT_BG);
                  void commitBgColor(null);
                }}
                disabled={savingBg}
                className="px-2 py-1 text-xs rounded text-gray-600 hover:bg-gray-100 border border-gray-300 disabled:opacity-50 shrink-0"
              >
                既定に戻す
              </button>
            )}
            {savingBg && (
              <span className="text-xs text-gray-400">保存中...</span>
            )}
          </div>
          <span className="text-[11px] text-gray-500">
            PCで見たとき LP の左右に出る余白の色。スマホでは影響しません
          </span>
        </label>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-gray-600 flex items-center gap-2">
            コンテンツ装飾
            {savingFrame && (
              <span className="text-xs text-gray-400">保存中...</span>
            )}
          </span>
          <div className="flex flex-wrap gap-3 text-sm">
            {(
              [
                { value: 'none', label: 'なし' },
                { value: 'line', label: 'ライン' },
                { value: 'shadow', label: 'ドロップシャドウ' },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className="inline-flex items-center gap-1.5 cursor-pointer"
              >
                <input
                  type="radio"
                  name="frameStyle"
                  value={opt.value}
                  checked={frameStyle === opt.value}
                  onChange={() => void commitFrameStyle(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
          <span className="text-[11px] text-gray-500">
            背景色とのコントラストを付けて LP 本体を浮かび上がらせる装飾。スマホでは LP が画面いっぱいなので影響しません
          </span>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100">
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
          aria-expanded={detailsOpen}
        >
          <span>{detailsOpen ? '▼' : '▶'}</span>
          <span>詳細(パスワード保護・公開スケジュール)</span>
          {passwordProtected && (
            <span className="text-[11px] uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
              パスワード有効
            </span>
          )}
          {hasSchedule && (
            <span className="text-[11px] uppercase tracking-wider text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
              スケジュールあり
            </span>
          )}
        </button>
      </div>

      {detailsOpen && (
        <>
      <div className="mt-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">
            パスワード保護
            {passwordProtected && (
              <span className="ml-2 text-[11px] uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                有効
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            設定すると訪問者にパスワード入力を求めます。
            正しいパスワードを入れた人だけ LP を見られます
          </p>
          {!passwordProtected && (
            <p className="text-xs text-gray-500 mt-0.5">
              設定後は確認できません。共有する前に控えてください
            </p>
          )}
          {passwordProtected && (
            <p className="text-xs text-gray-500 mt-0.5">
              変更や忘れた時は一度解除してから入力し直してください
            </p>
          )}
        </div>
        {/*
          Single-action UI: when no password is set, the operator types
          one and saves; when a password is set, only the "解除" button
          shows. To change a forgotten or stale password the flow is
          always "解除 → 入力 → 設定", which keeps the editor honest
          about the SHA-256 storage (we can't show the current value
          back) and removes the ambiguous "変更" path.
        */}
        {!passwordProtected ? (
          <div className="flex gap-2 max-w-md">
            <input
              type="password"
              value={passwordDraft}
              onChange={(e) => setPasswordDraft(e.target.value)}
              placeholder="4〜16文字、半角英数字・記号"
              minLength={4}
              maxLength={16}
              pattern="[\x21-\x7e]+"
              className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button
              type="button"
              disabled={
                passwordDraft.length < 4 ||
                passwordDraft.length > 16 ||
                !/^[\x21-\x7e]+$/.test(passwordDraft) ||
                savingPassword
              }
              onClick={async () => {
                setSavingPassword(true);
                await patch({ password: passwordDraft }, () =>
                  setSavingPassword(false)
                );
                setPasswordProtected(true);
                setPasswordDraft('');
              }}
              className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingPassword ? '設定中...' : '設定'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 max-w-md text-sm">
            <span className="text-gray-700">
              パスワード保護中です
            </span>
            <button
              type="button"
              disabled={savingPassword}
              onClick={async () => {
                if (
                  !confirm(
                    'パスワード保護を解除しますか?以後はパスワード無しで誰でも見られます。'
                  )
                ) {
                  return;
                }
                setSavingPassword(true);
                await patch({ password: null }, () => setSavingPassword(false));
                setPasswordProtected(false);
                setPasswordDraft('');
              }}
              className="px-3 py-1.5 text-sm rounded bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 disabled:opacity-50"
            >
              {savingPassword ? '解除中...' : '解除'}
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">
            公開スケジュール
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            指定日時に自動で公開・自動で非公開にできます。空欄なら手動公開がそのまま続きます
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600 flex items-center gap-2">
              公開開始日時(任意)
              {savingSchedule === 'publish' && (
                <span className="text-xs text-gray-400">保存中...</span>
              )}
            </span>
            <div className="flex gap-1">
              <input
                type="datetime-local"
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)}
                onBlur={async () => {
                  const next = fromLocalInput(publishAt);
                  if (next === initialPublishAt) return;
                  setSavingSchedule('publish');
                  await patch({ publishAt: next }, () =>
                    setSavingSchedule(null)
                  );
                }}
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              {publishAt && (
                <button
                  type="button"
                  onClick={async () => {
                    setPublishAt('');
                    setSavingSchedule('publish');
                    await patch({ publishAt: null }, () =>
                      setSavingSchedule(null)
                    );
                  }}
                  className="px-2 text-xs text-gray-600 hover:bg-gray-100 rounded border border-gray-300"
                >
                  クリア
                </button>
              )}
            </div>
            <span className="text-[11px] text-gray-500">
              この日時より前のアクセスは 404 になります
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600 flex items-center gap-2">
              公開停止日時(任意)
              {savingSchedule === 'unpublish' && (
                <span className="text-xs text-gray-400">保存中...</span>
              )}
            </span>
            <div className="flex gap-1">
              <input
                type="datetime-local"
                value={unpublishAt}
                onChange={(e) => setUnpublishAt(e.target.value)}
                onBlur={async () => {
                  const next = fromLocalInput(unpublishAt);
                  if (next === initialUnpublishAt) return;
                  setSavingSchedule('unpublish');
                  await patch({ unpublishAt: next }, () =>
                    setSavingSchedule(null)
                  );
                }}
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              {unpublishAt && (
                <button
                  type="button"
                  onClick={async () => {
                    setUnpublishAt('');
                    setSavingSchedule('unpublish');
                    await patch({ unpublishAt: null }, () =>
                      setSavingSchedule(null)
                    );
                  }}
                  className="px-2 text-xs text-gray-600 hover:bg-gray-100 rounded border border-gray-300"
                >
                  クリア
                </button>
              )}
            </div>
            <span className="text-[11px] text-gray-500">
              この日時以降のアクセスは 404 になります
            </span>
          </label>
        </div>
      </div>
        </>
      )}
    </section>
  );
}

/**
 * Convert an ISO datetime to the value `<input type="datetime-local">`
 * expects (YYYY-MM-DDTHH:MM, in the browser's local timezone). Empty
 * string for null / unparseable.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value); // browser interprets as local time
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}
