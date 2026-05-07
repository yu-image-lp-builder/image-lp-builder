
import { useEffect, useState } from 'react';
import { useAdminPublicOrigin } from '../../lib/admin-public-url';

interface UtmLink {
  id: string;
  label: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  short_path: string | null;
  created_at: string;
}

interface Props {
  lpId: string;
}

type ApiError = { success: false; error: { code: string; message: string } };

const EMPTY_FORM = {
  label: '',
  utmSource: '',
  utmMedium: '',
  utmCampaign: '',
  utmContent: '',
  utmTerm: '',
};

export default function UtmLinksPanel({ lpId }: Props) {
  const [items, setItems] = useState<UtmLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const origin = useAdminPublicOrigin();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (collapsed) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/lps/${lpId}/utm-links`);
      if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
      const json = (await res.json()) as {
        success: true;
        data: { utmLinks: UtmLink[] };
      };
      setItems(json.data.utmLinks);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function createNew() {
    if (busy) return;
    if (!form.label.trim()) {
      alert('ラベルを入力してください');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/lps/${lpId}/utm-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: form.label.trim(),
          utmSource: form.utmSource.trim() || null,
          utmMedium: form.utmMedium.trim() || null,
          utmCampaign: form.utmCampaign.trim() || null,
          utmContent: form.utmContent.trim() || null,
          utmTerm: form.utmTerm.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '作成失敗'));
      setForm(EMPTY_FORM);
      setCreating(false);
      await load();
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: UtmLink) {
    if (busy) return;
    if (!confirm(`「${item.label}」を削除しますか?\n短縮URLが即無効になります。`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/lps/${lpId}/utm-links/${item.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await readApiError(res, '削除失敗'));
      await load();
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function copyShort(item: UtmLink) {
    if (!item.short_path || !origin) return;
    const url = `${origin}/go/${item.short_path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold text-gray-700">
            流入計測URL(UTM + 短縮URL)
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            チャネル別に短縮URLを発行 — GA4 / GTM で流入元を区別できる
          </p>
        </div>
        <span className="text-gray-400 text-sm">
          {collapsed ? '▼ 開く' : '▲ 閉じる'}
        </span>
      </button>

      {!collapsed && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
          {!creating && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setCreating(true)}
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                + 新規作成
              </button>
            </div>
          )}

          {creating && (
            <div className="border border-blue-200 bg-blue-50 rounded p-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  label="ラベル(必須)"
                  value={form.label}
                  onChange={(v) => setForm({ ...form, label: v })}
                  placeholder="X 投稿用 / Insta ストーリー 等"
                />
                <Input
                  label="utm_source"
                  value={form.utmSource}
                  onChange={(v) => setForm({ ...form, utmSource: v })}
                  placeholder="twitter / instagram / mail"
                />
                <Input
                  label="utm_medium"
                  value={form.utmMedium}
                  onChange={(v) => setForm({ ...form, utmMedium: v })}
                  placeholder="social / email / referral"
                />
                <Input
                  label="utm_campaign"
                  value={form.utmCampaign}
                  onChange={(v) => setForm({ ...form, utmCampaign: v })}
                  placeholder="spring2026"
                />
                <Input
                  label="utm_content(任意)"
                  value={form.utmContent}
                  onChange={(v) => setForm({ ...form, utmContent: v })}
                  placeholder="banner_top"
                />
                <Input
                  label="utm_term(任意)"
                  value={form.utmTerm}
                  onChange={(v) => setForm({ ...form, utmTerm: v })}
                  placeholder="検索キーワード等"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setForm(EMPTY_FORM);
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
                  {busy ? '作成中...' : '作成'}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-gray-500">読み込み中...</p>
          ) : items.length === 0 && !creating ? (
            <p className="text-xs text-gray-400 text-center py-4">
              まだ流入計測URLがありません
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="border border-gray-200 rounded p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="text-sm font-medium text-gray-800 truncate">
                        {item.label}
                      </div>
                      <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
                        {item.utm_source && (
                          <span>
                            <strong>source:</strong> {item.utm_source}
                          </span>
                        )}
                        {item.utm_medium && (
                          <span>
                            <strong>medium:</strong> {item.utm_medium}
                          </span>
                        )}
                        {item.utm_campaign && (
                          <span>
                            <strong>campaign:</strong> {item.utm_campaign}
                          </span>
                        )}
                      </div>
                      <code className="block text-[11px] font-mono text-blue-700 truncate">
                        {origin}/go/{item.short_path}
                      </code>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => copyShort(item)}
                        disabled={busy}
                        className={`px-2 py-1 text-xs font-medium rounded ${
                          copiedId === item.id
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                        }`}
                      >
                        {copiedId === item.id ? '✓ コピー済み' : '📋 コピー'}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(item)}
                        disabled={busy}
                        className="px-2 py-1 text-xs font-medium rounded bg-red-50 text-red-700 hover:bg-red-100"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={200}
        className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
      />
    </label>
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
