/**
 * PreviewQr
 *
 * Small React island that lives inside the unified preview window's
 * 📱 スマホ tab. Fetches the right URL for the LP (public /<slug> if
 * published, /preview/<token> otherwise) and renders a QR alongside
 * the iPhone mock so the operator can scan with a real device.
 *
 * Issuing / rotating the preview token uses the same endpoint as
 * the standalone QR modal did before — kept as a one-button flow.
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

export default function PreviewQr({ lpId, slug, isPublished }: Props) {
  // The preview window was opened from /admin/...; window.opener
  // points back at the editor. The URL the visitor would hit is
  // either the request origin (no custom domain) or lp.{domain}
  // (custom domain wired) — useAdminPublicOrigin makes that call.
  const origin = useAdminPublicOrigin();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isPublished) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
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
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lpId, isPublished]);

  async function issueToken() {
    setLoading(true);
    setError(null);
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const url = isPublished
    ? origin
      ? `${origin}/${slug}`
      : ''
    : origin && token
      ? `${origin}/preview/${token}`
      : '';

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
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 16,
        width: 240,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 12,
          fontWeight: 600,
          color: '#374151',
          alignSelf: 'flex-start',
        }}
      >
        {isPublished ? 'QR(公開URL)' : 'QR(プレビューURL)'}
      </p>

      {!isPublished && !token && !loading && (
        <button
          type="button"
          onClick={issueToken}
          style={{
            border: 0,
            background: '#2563eb',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          プレビューURLを発行
        </button>
      )}

      {loading && (
        <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>読み込み中...</p>
      )}

      {url && (
        <>
          <div
            style={{
              padding: 8,
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
            }}
          >
            <QRCodeSVG value={url} size={180} level="M" marginSize={0} />
          </div>

          <div style={{ width: '100%' }}>
            <input
              type="text"
              value={url}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '6px 8px',
                fontSize: 10,
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                background: '#f9fafb',
                color: '#374151',
              }}
            />
            <button
              type="button"
              onClick={copyUrl}
              style={{
                marginTop: 6,
                width: '100%',
                padding: '6px',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                background: copied ? '#ecfdf5' : '#f3f4f6',
                color: copied ? '#047857' : '#374151',
                fontSize: 11,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {copied ? '✓ コピー済み' : '📋 URL をコピー'}
            </button>
          </div>

          {!isPublished && (
            <button
              type="button"
              onClick={() => {
                if (
                  !window.confirm(
                    'プレビューURLを再発行しますか?\n以前のURLは無効になります。'
                  )
                )
                  return;
                void issueToken();
              }}
              style={{
                background: 'transparent',
                border: 0,
                color: '#6b7280',
                fontSize: 10,
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              プレビューURLを再発行
            </button>
          )}

          <p
            style={{
              margin: 0,
              fontSize: 10,
              color: '#6b7280',
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            スマホのカメラで読んで実機確認
          </p>
        </>
      )}

      {isLocalhost && url && (
        <p
          style={{
            margin: 0,
            fontSize: 10,
            color: '#92400e',
            background: '#fef3c7',
            border: '1px solid #fde68a',
            padding: '4px 6px',
            borderRadius: 4,
            lineHeight: 1.5,
          }}
        >
          ⚠ ローカルなので URL は localhost。<br />スマホからは通常見えません(本番デプロイ後は本物のドメインに変わります)
        </p>
      )}

      {error && (
        <p style={{ fontSize: 10, color: '#dc2626', margin: 0 }}>{error}</p>
      )}
    </div>
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
