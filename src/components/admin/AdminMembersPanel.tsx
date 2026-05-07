/**
 * AdminMembersPanel
 *
 * Lists every admin in the current workspace, lets the operator
 * add a new one by email, and lets them remove anyone except
 * themselves.
 *
 * The "Add admin" flow is deliberately a server-side relay: we
 * insert the row with google_sub = NULL, and the very first time
 * that person logs in via Google we bind their `sub`. This is what
 * the design doc calls the "リレー方式" handover — the existing
 * admin pre-registers the email, the new admin completes the
 * round-trip with their own Google account, no shared password.
 */

import { useEffect, useMemo, useState } from 'react';

interface Admin {
  id: string;
  email: string;
  role: string;
  created_at: string;
  last_login_at: string | null;
  signed_in: boolean;
}

interface Props {
  /** Authenticated admin's id, used to flag "this is you" and block
   *  the self-delete button. */
  currentAdminId: string;
}

type ApiError = { success: false; error: { code: string; message: string } };

export default function AdminMembersPanel({ currentAdminId }: Props) {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/admin-members');
      if (!res.ok) throw new Error(await readApiError(res, '取得に失敗しました'));
      const json = (await res.json()) as {
        success: true;
        data: { admins: Admin[] };
      };
      setAdmins(json.data.admins);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function addAdmin() {
    if (busy) return;
    const email = newEmail.trim().toLowerCase();
    if (!email) {
      setErrorMessage('メールアドレスを入力してください');
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/admin-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '追加に失敗しました'));
      setNewEmail('');
      setAdding(false);
      await load();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeAdmin(id: string) {
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/admin-members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '削除に失敗しました'));
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const sortedAdmins = useMemo(() => {
    return [...admins].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [admins]);

  return (
    <div className="space-y-4">
      {errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMessage}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">管理者一覧</h2>
          {!adding && (
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setErrorMessage(null);
              }}
              className="text-sm font-medium text-blue-700 hover:text-blue-900"
            >
              + 管理者を追加
            </button>
          )}
        </div>

        {adding && (
          <div className="px-4 py-3 border-b border-gray-200 bg-blue-50">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              追加する Google アカウントのメールアドレス
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="someone@example.com"
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void addAdmin()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                追加
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAdding(false);
                  setNewEmail('');
                  setErrorMessage(null);
                }}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                キャンセル
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-600">
              入力したメールアドレスの Google アカウントでログインすると管理者として確定します。
              ログイン用 URL はこの画面の URL を直接お伝えください。
            </p>
          </div>
        )}

        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
            読み込み中...
          </div>
        ) : sortedAdmins.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
            管理者が登録されていません。
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {sortedAdmins.map((admin) => {
              const isMe = admin.id === currentAdminId;
              const isConfirming = confirmDeleteId === admin.id;
              return (
                <li key={admin.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {admin.email}
                        </span>
                        {isMe && (
                          <span className="inline-flex items-center rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                            自分
                          </span>
                        )}
                        {!admin.signed_in && (
                          <span className="inline-flex items-center rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                            未ログイン
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500">
                        追加: {formatDateTime(admin.created_at)}
                        {admin.last_login_at && (
                          <>
                            {' '}/ 最終ログイン: {formatDateTime(admin.last_login_at)}
                          </>
                        )}
                      </p>
                    </div>
                    {!isMe && (
                      <div>
                        {isConfirming ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void removeAdmin(admin.id)}
                              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              削除する
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              キャンセル
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(admin.id)}
                            className="text-xs font-medium text-red-700 hover:text-red-900"
                          >
                            削除
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600 leading-relaxed">
        <p className="font-medium text-gray-700 mb-1">追加の流れ</p>
        <p>
          ① 新しい管理者のメールアドレスを「+ 管理者を追加」で登録
          <br />
          ② この管理画面の URL を相手に伝える(LINE / 口頭など)
          <br />
          ③ 相手が自分の Google アカウントでログインしてアクセス確認
        </p>
        <p className="mt-2 pt-2 border-t border-gray-200">
          <span className="font-medium text-gray-700">引き継ぐ場合:</span>
          上記の追加 + アクセス確認後、自分のアカウントを「削除」すれば完了します。
        </p>
      </div>
    </div>
  );
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const json = (await res.json()) as ApiError;
    if (!json.success && json.error?.message) return json.error.message;
  } catch {
    // ignore — fall through
  }
  return `${fallback} (${res.status})`;
}

function formatDateTime(iso: string): string {
  // SQLite "YYYY-MM-DD HH:MM:SS" comes back without timezone; treat as UTC.
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}
