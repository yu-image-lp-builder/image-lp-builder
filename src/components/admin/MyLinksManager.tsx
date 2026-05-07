/**
 * MyLinksManager
 *
 * Admin UI for the MyLink CRUD endpoints. Users register destinations
 * (LINE URLs, contact emails, phone numbers, etc.) once, then
 * reference them from any CTA. Updating a MyLink updates every CTA
 * that points at it on the next page render.
 */

import { useEffect, useState } from 'react';

interface MyLink {
  id: string;
  label: string;
  url: string;
  created_at: string;
  updated_at: string;
}

type ApiError = { success: false; error: { code: string; message: string } };

// Friendly client-side URL check. Mirrors the allow-list in
// src/lib/url.ts:validateUrlScheme but returns a Japanese message
// suited to inline form display. Server-side check is still the
// source of truth.
function clientUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'URL を入力してください';
  if (trimmed.startsWith('//')) return 'URL の先頭が // で始まる形式は使えません';
  if (trimmed.startsWith('/')) return null; // same-origin relative path
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:', 'tel:', 'mailto:'].includes(parsed.protocol)) {
      return 'http:// / https:// / tel: / mailto: のいずれかで入力してください';
    }
    return null;
  } catch {
    return 'http:// や https:// で始まる URL を入力してください';
  }
}

export default function MyLinksManager() {
  const [items, setItems] = useState<MyLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newUrl, setNewUrl] = useState('');

  useEffect(() => {
    void loadList();
  }, []);

  async function loadList() {
    try {
      const res = await fetch('/api/my-links');
      if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
      const json = (await res.json()) as {
        success: true;
        data: { myLinks: MyLink[] };
      };
      setItems(json.data.myLinks);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function createNew() {
    if (busy) return;
    if (!newLabel.trim()) {
      alert('ラベルを入力してください');
      return;
    }
    const urlErr = clientUrlError(newUrl);
    if (urlErr) {
      alert(urlErr);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/my-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel, url: newUrl }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '作成失敗'));
      setNewLabel('');
      setNewUrl('');
      setCreating(false);
      await loadList();
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(link: MyLink) {
    setEditingId(link.id);
    setDraftLabel(link.label);
    setDraftUrl(link.url);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    if (busy) return;
    if (!draftLabel.trim()) {
      alert('ラベルを入力してください');
      return;
    }
    const urlErr = clientUrlError(draftUrl);
    if (urlErr) {
      alert(urlErr);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/my-links/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: draftLabel, url: draftUrl }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '更新失敗'));
      setEditingId(null);
      await loadList();
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, label: string) {
    if (busy) return;
    if (
      !confirm(
        `「${label}」を削除しますか?\n\nこのマイリンクを参照しているボタンは、登録済みのURLが効かなくなります。`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/my-links/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readApiError(res, '削除失敗'));
      await loadList();
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-500">読み込み中...</p>;
  }

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            マイリンク
            {items.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({items.length}個)
              </span>
            )}
          </h2>
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              disabled={busy}
              className="px-3 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              + 新規追加
            </button>
          )}
        </div>

        {creating && (
          <div className="border border-blue-200 bg-blue-50 rounded p-3 mb-4 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="ラベル(例:本命LINE)"
                maxLength={50}
                required
                className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://lin.ee/..."
                required
                className="sm:col-span-2 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            {newUrl.trim() && clientUrlError(newUrl) && (
              <p className="text-xs text-red-600">{clientUrlError(newUrl)}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setNewLabel('');
                  setNewUrl('');
                }}
                disabled={busy}
                className="px-3 py-1.5 text-sm rounded text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={createNew}
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        )}

        {items.length === 0 && !creating ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-sm">まだマイリンクがありません</p>
            <p className="text-xs mt-1 text-gray-400">
              よく使う URL(LINE / フォーム / メール等)を登録すると、
              <br />
              ボタン編集で「マイリンクから選ぶ」だけで挿入できます
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((link) => (
              <li
                key={link.id}
                className="border border-gray-200 rounded p-3"
              >
                {editingId === link.id ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={draftLabel}
                        onChange={(e) => setDraftLabel(e.target.value)}
                        maxLength={50}
                        required
                        className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                      <input
                        type="url"
                        value={draftUrl}
                        onChange={(e) => setDraftUrl(e.target.value)}
                        required
                        className="sm:col-span-2 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                    </div>
                    {draftUrl.trim() && clientUrlError(draftUrl) && (
                      <p className="text-xs text-red-600">{clientUrlError(draftUrl)}</p>
                    )}
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={busy}
                        className="px-2 py-1 text-xs rounded text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(link.id)}
                        disabled={busy}
                        className="px-2 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {busy ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">
                        {link.label}
                      </div>
                      <div className="text-xs font-mono text-gray-500 truncate">
                        {link.url}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(link)}
                        disabled={busy}
                        className="px-2 py-1 text-xs font-medium rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(link.id, link.label)}
                        disabled={busy}
                        className="px-2 py-1 text-xs font-medium rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
        <p className="font-medium mb-1">マイリンクの使い方</p>
        <p>
          ボタン編集モーダルの「リンク先タイプ」で URL系を選んだ時、
          下に「マイリンクから選ぶ」が出ます。マイリンクのラベルを選ぶと
          URLが自動入力され、ここで URL を変えると全ボタンに反映されます。
        </p>
      </section>
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
