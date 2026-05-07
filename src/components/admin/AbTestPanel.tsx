/**
 * AbTestPanel
 *
 * LP-edit-screen panel for managing A/B variants of the current LP.
 *
 *   - List variants with their label, weight, status
 *   - Create new variant (forks parent's current content as the
 *     starting point)
 *   - Inline edit label + weight (PATCH /api/lps/:id/ab)
 *   - Open the variant in the regular LP editor (it's just a Page
 *     row with page_type='ab_variant')
 *   - Soft-delete a variant via existing DELETE /api/lps/:id
 *
 * Distribution is read-only here (config only, not stats); analytics
 * splits are handled by GTM/GA4 via the dataLayer push.
 */

import { useEffect, useState } from 'react';

interface Props {
  lpId: string;
}

interface VariantSummary {
  id: string;
  status: string;
  label: string;
  weight: number;
  createdAt: string;
  updatedAt: string;
}

type ApiError = { success: false; error: { code: string; message: string } };

export default function AbTestPanel({ lpId }: Props) {
  const [variants, setVariants] = useState<VariantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await fetch(`/api/lps/${lpId}/variants`);
      if (!res.ok) throw new Error(await readApiError(res, 'バリアント取得失敗'));
      const json = (await res.json()) as {
        success: true;
        data: { variants: VariantSummary[] };
      };
      setVariants(json.data.variants);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function createVariant() {
    const label = newLabel.trim();
    if (label.length === 0 || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/lps/${lpId}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, weight: 1 }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '作成失敗'));
      const json = (await res.json()) as {
        success: true;
        data: { variant: VariantSummary };
      };
      setVariants((prev) => [...prev, json.data.variant]);
      setNewLabel('');
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreating(false);
    }
  }

  async function saveAb(id: string, label: string, weight: number) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/lps/${id}/ab`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), weight }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '保存失敗'));
      const json = (await res.json()) as {
        success: true;
        data: { variant: VariantSummary };
      };
      setVariants((prev) =>
        prev.map((v) => (v.id === id ? { ...v, ...json.data.variant } : v))
      );
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingId(null);
    }
  }

  async function deleteVariant(v: VariantSummary) {
    if (
      !window.confirm(
        `バリアント「${v.label}」をゴミ箱に移動します。続行しますか?`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/lps/${v.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readApiError(res, '削除失敗'));
      setVariants((prev) => prev.filter((x) => x.id !== v.id));
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const publishedCount = variants.filter((v) => v.status === 'published').length;

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold text-gray-700">
            A/B テスト
            {variants.length > 0 && (
              <span className="ml-2 text-xs font-normal text-gray-500">
                バリアント {publishedCount} / {variants.length} 公開中
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            別案を作って LP を比較。<br />公開中の案は重みに応じて自動配分されます
          </p>
        </div>
        <span className="text-gray-400 text-sm">
          {collapsed ? '▼ 開く' : '▲ 閉じる'}
        </span>
      </button>

      {!collapsed && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
          {loading ? (
            <p className="text-sm text-gray-500">読み込み中...</p>
          ) : (
            <>
              {variants.length === 0 ? (
                <p className="text-xs text-gray-500 italic">
                  まだバリアントがありません。最初の1案を作って比較を始めましょう。
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-200">
                      <th className="text-left py-2 font-medium">ラベル</th>
                      <th className="text-left py-2 font-medium">状態</th>
                      <th className="text-left py-2 font-medium w-24">重み</th>
                      <th className="text-right py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((v) => (
                      <VariantRow
                        key={v.id}
                        variant={v}
                        saving={savingId === v.id}
                        onSave={(label, weight) => saveAb(v.id, label, weight)}
                        onDelete={() => deleteVariant(v)}
                      />
                    ))}
                  </tbody>
                </table>
              )}

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="新しいバリアントのラベル(例:案A)"
                  maxLength={100}
                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <button
                  type="button"
                  onClick={createVariant}
                  disabled={newLabel.trim().length === 0 || creating}
                  className="px-3 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? '作成中...' : 'バリアント作成'}
                </button>
              </div>

              <p className="text-[11px] text-gray-500">
                バリアントは <strong>親LPの現在の状態をコピー</strong> して作成されます。
                編集後 <strong>公開中</strong> にすると配信に組み込まれます。
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

interface RowProps {
  variant: VariantSummary;
  saving: boolean;
  onSave: (label: string, weight: number) => void;
  onDelete: () => void;
}

function VariantRow({ variant, saving, onSave, onDelete }: RowProps) {
  const [label, setLabel] = useState(variant.label);
  const [weight, setWeight] = useState(variant.weight);

  const isDirty =
    label.trim() !== variant.label || weight !== variant.weight;
  const isPublished = variant.status === 'published';

  return (
    <tr className="border-b border-gray-100 align-middle">
      <td className="py-2 pr-3">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={100}
          className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </td>
      <td className="py-2 pr-3">
        <span
          className={`inline-block text-[11px] px-2 py-0.5 rounded ${
            isPublished
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-gray-100 text-gray-600'
          }`}
        >
          {isPublished ? '公開中' : '下書き'}
        </span>
      </td>
      <td className="py-2 pr-3">
        <input
          type="number"
          min={0}
          step={1}
          value={weight}
          onChange={(e) => setWeight(Math.max(0, Number(e.target.value) || 0))}
          className="w-20 px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </td>
      <td className="py-2 text-right space-x-2">
        {isDirty && (
          <button
            type="button"
            onClick={() => onSave(label, weight)}
            disabled={saving}
            className="text-xs text-blue-700 hover:underline disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        )}
        <a
          href={`/admin/lps/${variant.id}`}
          className="text-xs text-gray-700 hover:underline"
        >
          編集
        </a>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-red-600 hover:underline"
        >
          削除
        </button>
      </td>
    </tr>
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
