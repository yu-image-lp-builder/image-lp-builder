/**
 * TrashSection
 *
 * Collapsible trash bin shown beneath the LP grid on /admin. Lists
 * soft-deleted LPs newest-first and exposes two actions per row:
 *
 *   - 復元 (restore)   → moves the LP back to draft
 *   - 完全削除 (purge) → drops the row from D1, irreversibly
 *
 * Purge confirms with the user via a typed-slug check so a stray
 * click can't wipe a real LP.
 */

import { useEffect, useState } from 'react';

interface TrashedLp {
  id: string;
  slug: string;
  trashed_at: string | null;
  updated_at: string;
}

type ApiError = { success: false; error: { code: string; message: string } };

export default function TrashSection() {
  const [items, setItems] = useState<TrashedLp[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await fetch('/api/lps/trash');
      if (!res.ok) throw new Error(await readApiError(res, 'ゴミ箱取得失敗'));
      const json = (await res.json()) as {
        success: true;
        data: { pages: TrashedLp[] };
      };
      setItems(json.data.pages);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function restore(item: TrashedLp) {
    if (busyId) return;
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/lps/${item.id}/restore`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(await readApiError(res, '復元失敗'));
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      // Reload the page so the LP shows up in the main grid above.
      window.location.reload();
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function purge(item: TrashedLp) {
    if (busyId) return;
    const typed = window.prompt(
      `本当に LP「${item.slug}」を完全に削除しますか?\n\n` +
        `この操作は取り消せません。確認のため、下のフォームに LP の URL 末尾(${item.slug})を入力してください:`
    );
    if (typed === null) return; // user hit Cancel
    if (typed.trim() !== item.slug) {
      alert('入力が一致しなかったので、削除を中止しました。');
      return;
    }
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/lps/${item.id}/purge`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await readApiError(res, '削除失敗'));
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return null; // don't show the section while we're checking

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 mt-8">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 text-left"
      >
        <div className="flex items-center gap-2">
          <span>🗑️</span>
          <h2 className="text-sm font-semibold text-gray-700">
            ゴミ箱
            <span className="ml-2 text-xs font-normal text-gray-500">
              {items.length} 件
            </span>
          </h2>
        </div>
        <span className="text-gray-400 text-sm">
          {collapsed ? '▼ 開く' : '▲ 閉じる'}
        </span>
      </button>

      {!collapsed && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-4">
          {items.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              ゴミ箱は空です。削除した LP はここに 7 日間保管されます。
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-200">
                  <th className="text-left py-2 font-medium">URL末尾</th>
                  <th className="text-left py-2 font-medium">削除日</th>
                  <th className="text-right py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100">
                    <td className="py-2 font-mono text-gray-800">
                      /{item.slug}
                    </td>
                    <td className="py-2 text-xs text-gray-500">
                      {item.trashed_at ?? '—'}
                    </td>
                    <td className="py-2 text-right space-x-3">
                      <button
                        type="button"
                        onClick={() => restore(item)}
                        disabled={busyId !== null}
                        className="text-xs text-blue-700 hover:underline disabled:opacity-50"
                      >
                        {busyId === item.id ? '...' : '復元'}
                      </button>
                      <button
                        type="button"
                        onClick={() => purge(item)}
                        disabled={busyId !== null}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        完全削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
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
