/**
 * McpPanel
 *
 * Admin UI for the MCP (Model Context Protocol) endpoint:
 * - Mode selector (read_only / edit_no_delete / edit_full) + enabled toggle
 * - Token list (label, prefix, created, last used, revoke)
 * - Token issuance flow that surfaces the raw token *once* in a modal
 *
 * The raw token is never re-fetchable; the modal is the only chance
 * the user has to copy it. Mirroring how GitHub PATs are presented.
 */

import { useEffect, useMemo, useState } from 'react';

type McpMode = 'read_only' | 'edit_no_delete' | 'edit_full';

type SettingsResponse = {
  mode: McpMode;
  enabled: boolean;
  updatedAt: string;
};

type TokenSummary = {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type ApiError = { success: false; error: { code: string; message: string } };

const MODE_OPTIONS: Array<{
  value: McpMode;
  label: string;
  helper: string;
}> = [
  {
    value: 'read_only',
    label: '読み取り専用',
    helper: 'AI からは閲覧のみ可能。一切の変更を許さない最も安全なモード。',
  },
  {
    value: 'edit_no_delete',
    label: '編集可・削除不可',
    helper: '推奨。編集はできるが削除系ツールは公開されない。',
  },
  {
    value: 'edit_full',
    label: '全権限(削除も可)',
    helper: '削除系含めて全部許可。慣れてからにしましょう。',
  },
];

export default function McpPanel() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [issuedRaw, setIssuedRaw] = useState<{ raw: string; label: string } | null>(null);

  useEffect(() => {
    void Promise.all([loadSettings(), loadTokens()]).finally(() => setLoading(false));
  }, []);

  async function loadSettings() {
    const res = await fetch('/api/mcp-settings');
    if (!res.ok) {
      alert(await readApiError(res, '設定の取得に失敗'));
      return;
    }
    const json = (await res.json()) as { success: true; data: SettingsResponse };
    setSettings(json.data);
  }

  async function loadTokens() {
    const res = await fetch('/api/mcp-tokens');
    if (!res.ok) {
      alert(await readApiError(res, 'トークン一覧の取得に失敗'));
      return;
    }
    const json = (await res.json()) as { success: true; data: { tokens: TokenSummary[] } };
    setTokens(json.data.tokens);
  }

  async function updateSettings(patch: Partial<SettingsResponse>) {
    if (!settings) return;
    setSavingMode(true);
    try {
      const res = await fetch('/api/mcp-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await readApiError(res, '保存に失敗'));
      const json = (await res.json()) as { success: true; data: SettingsResponse };
      setSettings(json.data);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingMode(false);
    }
  }

  async function issueToken() {
    const label = newLabel.trim();
    if (label.length === 0 || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/mcp-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'トークン発行に失敗'));
      const json = (await res.json()) as {
        success: true;
        data: { token: TokenSummary; rawToken: string };
      };
      setTokens((prev) => [json.data.token, ...prev]);
      setIssuedRaw({ raw: json.data.rawToken, label: json.data.token.label });
      setNewLabel('');
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(token: TokenSummary) {
    if (token.revokedAt) return;
    if (
      !window.confirm(
        `「${token.label}」を無効化します。
このトークンを使っているクライアントは即座にアクセスできなくなります。続行しますか?`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/mcp-tokens/${token.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readApiError(res, '無効化に失敗'));
      setTokens((prev) =>
        prev.map((t) =>
          t.id === token.id ? { ...t, revokedAt: new Date().toISOString() } : t
        )
      );
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const activeTokens = useMemo(
    () => tokens.filter((t) => !t.revokedAt),
    [tokens]
  );

  if (loading || !settings) {
    return <p className="text-sm text-gray-500">読み込み中...</p>;
  }

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-5">
        <header>
          <h2 className="text-lg font-semibold text-gray-900">アクセスモード</h2>
          <p className="text-xs text-gray-500 mt-1">
            AI が /mcp 経由でできることの上限を決めます。<br />トークンごとの個別設定はなし、この設定だけが効きます。
          </p>
        </header>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={savingMode}
            onChange={(e) => updateSettings({ enabled: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-sm text-gray-800">
            MCP エンドポイントを有効化
            <span className="text-xs text-gray-500 ml-2">
              オフにすると全クライアントが 503 を受け取ります
            </span>
          </span>
        </label>

        <fieldset
          disabled={!settings.enabled || savingMode}
          className="space-y-3"
        >
          {MODE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer ${
                settings.mode === opt.value
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:bg-gray-50'
              } ${!settings.enabled ? 'opacity-60' : ''}`}
            >
              <input
                type="radio"
                name="mcp-mode"
                checked={settings.mode === opt.value}
                onChange={() => updateSettings({ mode: opt.value })}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">
                  {opt.label}
                </div>
                <div className="text-xs text-gray-600 mt-0.5">{opt.helper}</div>
              </div>
            </label>
          ))}
        </fieldset>
      </section>

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-5">
        <header>
          <h2 className="text-lg font-semibold text-gray-900">アクセストークン</h2>
          <p className="text-xs text-gray-500 mt-1">
            AI クライアント(Claude Desktop / Cursor 等)に貼り付ける Bearer トークン。
            発行時に1回だけ表示されます — 必ず安全な場所に保存してください。
          </p>
        </header>

        <div className="flex gap-2">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="ラベル(例:Claude Desktop / 自宅 Mac)"
            maxLength={100}
            className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <button
            type="button"
            onClick={issueToken}
            disabled={newLabel.trim().length === 0 || creating}
            className="px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? '発行中...' : 'トークン発行'}
          </button>
        </div>

        {tokens.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            まだトークンがありません。最初の1本を発行してください。
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-200">
                <th className="text-left py-2 font-medium">ラベル</th>
                <th className="text-left py-2 font-medium">識別子</th>
                <th className="text-left py-2 font-medium">作成</th>
                <th className="text-left py-2 font-medium">最終使用</th>
                <th className="text-right py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-b border-gray-100">
                  <td className="py-2">
                    <span
                      className={
                        t.revokedAt ? 'text-gray-400 line-through' : 'text-gray-900'
                      }
                    >
                      {t.label}
                    </span>
                    {t.revokedAt && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                        revoked
                      </span>
                    )}
                  </td>
                  <td className="py-2 font-mono text-xs text-gray-600">
                    {t.prefix}…
                  </td>
                  <td className="py-2 text-xs text-gray-500">
                    {formatDate(t.createdAt)}
                  </td>
                  <td className="py-2 text-xs text-gray-500">
                    {t.lastUsedAt ? formatDate(t.lastUsedAt) : '—'}
                  </td>
                  <td className="py-2 text-right">
                    {!t.revokedAt && (
                      <button
                        type="button"
                        onClick={() => revokeToken(t)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        無効化
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="text-xs text-gray-500">
          現在有効なトークン:{activeTokens.length} 本
        </p>
      </section>

      {issuedRaw && (
        <IssuedTokenModal
          raw={issuedRaw.raw}
          label={issuedRaw.label}
          onClose={() => setIssuedRaw(null)}
        />
      )}
    </div>
  );
}

function IssuedTokenModal({
  raw,
  label,
  onClose,
}: {
  raw: string;
  label: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('クリップボードへのコピーに失敗しました。手動でコピーしてください。');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4">
        <header>
          <h3 className="text-lg font-semibold text-gray-900">
            トークンを発行しました
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            ラベル:<strong>{label}</strong>
          </p>
        </header>

        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded p-3">
          ⚠ このトークンは <strong>今しか表示されません</strong>。
          画面を閉じる前に必ずコピーして安全な場所(パスワードマネージャ等)に保存してください。
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={raw}
            className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs font-mono bg-gray-50"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={copy}
            className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            {copied ? 'コピー済み' : 'コピー'}
          </button>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded bg-gray-800 text-white hover:bg-gray-900"
          >
            保存しました(閉じる)
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  // D1 returns 'YYYY-MM-DD HH:MM:SS' (UTC). Render in local TZ.
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}
