/**
 * LpActions
 *
 * State-transition buttons for an LP shown in the admin edit screen.
 * Renders different controls depending on current status.
 *
 * On any successful action the page reloads — simpler than threading
 * state down from server-rendered data, and matches the rest of the
 * admin which is server-rendered Astro with islands of interactivity.
 */

import { useState } from 'react';
import { checkPublishReadiness, type CheckIssue } from '../../lib/publish-check';
import type { PageContent } from '../../lib/content';
import PrePublishModal from './PrePublishModal';

interface LpRef {
  id: string;
  slug: string;
  status: string;
}

const dismissKey = (lpId: string) => `lp-publish-check-dismissed:${lpId}`;

interface Props {
  lp: LpRef;
}

type ApiError = {
  success: false;
  error: { code: string; message: string };
};

export default function LpActions({ lp }: Props) {
  const [busy, setBusy] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [checkIssues, setCheckIssues] = useState<CheckIssue[] | null>(null);
  const [publishing, setPublishing] = useState(false);

  async function duplicate() {
    if (busy || duplicating) return;
    const suggested = `${lp.slug}-copy`;
    const input = prompt(
      'コピー先の URL末尾(slug)を入力してください。\n' +
        'セクション・ボタン配置・色などはそのままコピーされます。\n' +
        'メタ情報・公開設定・パスワード・UTM リンクはリセットされます。',
      suggested
    );
    if (input === null) return; // user cancelled
    const next = input.trim().toLowerCase();
    if (next.length === 0) return;

    setDuplicating(true);
    try {
      const res = await fetch(`/api/lps/${lp.id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: next }),
      });
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const data = (await res.json()) as ApiError;
          if (data?.error?.message) message = data.error.message;
        } catch {
          // body wasn't JSON
        }
        alert(message);
        return;
      }
      const json = (await res.json()) as {
        success: true;
        data: { id: string };
      };
      window.location.assign(`/admin/lps/${json.data.id}`);
    } catch (err) {
      alert(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDuplicating(false);
    }
  }

  async function startPublishFlow() {
    if (busy) return;
    // Dismissed for this LP — skip the check, publish immediately.
    try {
      if (window.localStorage.getItem(dismissKey(lp.id)) === '1') {
        await call('/publish');
        return;
      }
    } catch {
      // localStorage might be blocked; fall through to the modal.
    }

    setBusy(true);
    try {
      const [lpRes, trackingRes] = await Promise.all([
        fetch(`/api/lps/${lp.id}`),
        fetch('/api/tracking-tags'),
      ]);
      if (!lpRes.ok) throw new Error('LP取得に失敗しました');
      const lpJson = (await lpRes.json()) as {
        success: true;
        data: {
          content: PageContent;
          password_hash: string | null;
          publish_at: string | null;
          unpublish_at: string | null;
        };
      };
      let trackingConfigured = false;
      if (trackingRes.ok) {
        const tj = (await trackingRes.json()) as {
          success: true;
          data: {
            gtm_id?: string | null;
            ga4_id?: string | null;
            clarity_id?: string | null;
            meta_pixel_id?: string | null;
            custom_head?: string | null;
          };
        };
        trackingConfigured = Boolean(
          tj.data.gtm_id ||
            tj.data.ga4_id ||
            tj.data.clarity_id ||
            tj.data.meta_pixel_id ||
            (tj.data.custom_head && tj.data.custom_head.trim().length > 0)
        );
      }
      const issues = checkPublishReadiness({
        content: lpJson.data.content,
        page: {
          password_hash: lpJson.data.password_hash,
          publish_at: lpJson.data.publish_at,
          unpublish_at: lpJson.data.unpublish_at,
        },
        trackingConfigured,
      });
      setCheckIssues(issues);
    } catch (err) {
      alert(
        `公開前チェックに失敗しました: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmPublish(dismissForFuture: boolean) {
    if (publishing) return;
    setPublishing(true);
    try {
      if (dismissForFuture) {
        try {
          window.localStorage.setItem(dismissKey(lp.id), '1');
        } catch {
          // ignore
        }
      }
      await call('/publish');
    } finally {
      setPublishing(false);
    }
  }

  async function call(path: string, method: 'POST' | 'DELETE' = 'POST') {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/lps/${lp.id}${path}`, { method });
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const data = (await res.json()) as ApiError;
          if (data?.error?.message) message = data.error.message;
        } catch {
          // body wasn't JSON; keep the generic message
        }
        alert(message);
        return;
      }
      window.location.reload();
    } catch (err) {
      alert(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const isPublished = lp.status === 'published';
  const isTrash = lp.status === 'trash';

  return (
    <>
    <div className="flex gap-2 flex-wrap">
      {isTrash ? (
        <span className="px-3 py-2 text-sm text-gray-500">
          ゴミ箱に入っています(復元機能は今後実装)
        </span>
      ) : (
        <>
          {isPublished ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => call('/unpublish')}
              className="px-3 py-2 text-sm font-medium rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
            >
              下書きに戻す
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={startPublishFlow}
              className="px-3 py-2 text-sm font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              公開する
            </button>
          )}

          <button
            type="button"
            disabled={busy || duplicating}
            onClick={duplicate}
            className="px-3 py-2 text-sm font-medium rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {duplicating ? '複製中...' : '📋 複製'}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (confirm('このLPをゴミ箱に入れますか?\n7日後に自動削除されます。')) {
                call('', 'DELETE');
              }
            }}
            className="px-3 py-2 text-sm font-medium rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            ゴミ箱に入れる
          </button>
        </>
      )}
    </div>
    {checkIssues !== null && (
      <PrePublishModal
        lpId={lp.id}
        issues={checkIssues}
        publishing={publishing}
        onConfirm={confirmPublish}
        onClose={() => setCheckIssues(null)}
      />
    )}
    </>
  );
}
