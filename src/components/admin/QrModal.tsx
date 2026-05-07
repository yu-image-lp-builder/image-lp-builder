/**
 * QrModal
 *
 * Header button + modal that shows a QR code for whichever URL is
 * currently appropriate for the LP:
 *
 * - status === 'published'  -> public URL `/<slug>` (anyone can see)
 * - other statuses          -> preview URL `/preview/<token>`
 *                              (anyone with the unguessable URL)
 *
 * Preview tokens are issued / rotated / revoked via
 * /api/lps/:id/preview-token. The token is treated as the
 * credential, so rotating it expires any previously shared link.
 *
 * The modal also explains that during local development the URL is
 * localhost (only reachable from the same machine / LAN); the real
 * URL appears once the LP is deployed to Cloudflare with a custom
 * domain.
 */

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useAdminPublicOrigin } from '../../lib/admin-public-url';

interface Props {
  lpId: string;
  slug: string;
  isPublished: boolean;
}

type ApiError = { success: false; error: { code: string; message: string } };

export default function QrModal({ lpId, slug, isPublished }: Props) {
  const [open, setOpen] = useState(false);
  const origin = useAdminPublicOrigin();
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Load the current preview token whenever the modal opens for a
  // non-published LP.
  useEffect(() => {
    if (!open || isPublished) return;
    let cancelled = false;
    setTokenLoading(true);
    setTokenError(null);
    void fetch(`/api/lps/${lpId}/preview-token`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
        const json = (await res.json()) as {
          success: true;
          data: { token: string | null };
        };
        if (!cancelled) setToken(json.data.token);
      })
      .catch((err) => {
        if (!cancelled) setTokenError(err.message);
      })
      .finally(() => {
        if (!cancelled) setTokenLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isPublished, lpId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  async function issueToken() {
    setTokenLoading(true);
    setTokenError(null);
    try {
      const res = await fetch(`/api/lps/${lpId}/preview-token`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(await readApiError(res, '発行失敗'));
      const json = (await res.json()) as {
        success: true;
        data: { token: string | null };
      };
      setToken(json.data.token);
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : String(err));
    } finally {
      setTokenLoading(false);
    }
  }

  async function rotateToken() {
    if (!confirm('プレビューURLを再発行しますか?\n以前のURLは無効になります。')) {
      return;
    }
    await issueToken(); // POST overwrites
  }

  const publicUrl = origin && isPublished ? `${origin}/${slug}` : '';
  const previewUrl =
    origin && !isPublished && token ? `${origin}/preview/${token}` : '';
  const url = isPublished ? publicUrl : previewUrl;
  const isLocalhost =
    origin.includes('://localhost') || origin.includes('://127.');

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
        title="QRコードを表示(実機で確認)"
      >
        <QrIcon className="w-4 h-4" />
        QR
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="QRコード"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-lg max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h2 className="inline-flex items-center gap-1.5 text-base font-semibold text-gray-900">
                <QrIcon className="w-5 h-5" />
                {isPublished ? 'QR(公開URL)' : 'QR(プレビューURL)'}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-2 py-1 text-sm rounded hover:bg-gray-100"
                aria-label="閉じる"
              >
                ×
              </button>
            </header>

            <div className="p-6 space-y-4">
              {!isPublished && (
                <div className="text-xs px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-800">
                  下書き状態です。下のプレビューURLを知っている人だけが見られます(公開ボタンを押すまで `/{slug}` は404)。
                </div>
              )}

              {isLocalhost && (
                <div className="text-xs px-3 py-2 rounded bg-blue-50 border border-blue-200 text-blue-800">
                  ⚠ ローカル開発中なので URL は <code className="font-mono">localhost</code>。<br />スマホからは(同一WiFiでもPCのIP指定が必要で)通常見えません。<br />本番デプロイ後は Cloudflare ドメイン or 独自ドメインに変わります。
                </div>
              )}

              {!isPublished && tokenLoading && !token && (
                <p className="text-xs text-gray-500 text-center">読み込み中...</p>
              )}

              {!isPublished && !tokenLoading && !token && (
                <div className="text-center space-y-2">
                  <p className="text-sm text-gray-700">
                    まだプレビューURLが発行されていません
                  </p>
                  <button
                    type="button"
                    onClick={issueToken}
                    disabled={tokenLoading}
                    className="px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    プレビューURLを発行
                  </button>
                </div>
              )}

              {url && (
                <>
                  <div className="flex justify-center">
                    <div className="p-4 bg-white border border-gray-200 rounded">
                      <QRCodeSVG
                        value={url}
                        size={220}
                        level="M"
                        marginSize={0}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-600">
                      {isPublished ? '公開URL' : 'プレビューURL(限定共有)'}
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={url}
                        readOnly
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                        className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded text-xs font-mono bg-gray-50"
                      />
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
                    </div>
                  </div>

                  {!isPublished && (
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={rotateToken}
                        disabled={tokenLoading}
                        className="text-xs text-gray-600 hover:text-gray-900 underline disabled:opacity-50"
                      >
                        プレビューURLを再発行(以前のURLは無効になります)
                      </button>
                    </div>
                  )}

                  <p className="text-xs text-gray-500 text-center">
                    スマホのカメラでQRを読み取って実機で確認できます
                  </p>
                </>
              )}

              {tokenError && (
                <p className="text-xs text-red-600 text-center">{tokenError}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}

function QrIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z"
      />
    </svg>
  );
}
