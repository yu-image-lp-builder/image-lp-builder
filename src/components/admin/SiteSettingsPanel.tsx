/**
 * SiteSettingsPanel
 *
 * Form for the site-wide tracking tag IDs (Google Tag Manager,
 * GA4, Microsoft Clarity, Meta Pixel) plus a free-form custom HTML
 * block injected into <head>. Saves are batched on a single
 * "保存" click rather than per-field blur, so the user can review
 * the whole form before committing.
 */

import { useEffect, useState } from 'react';

interface TagsForm {
  gtmId: string;
  ga4Id: string;
  clarityId: string;
  metaPixelId: string;
  customHead: string;
}

interface SiteSettingsResponse {
  maintenanceMode: boolean;
  updatedAt: string;
}

type ApiError = { success: false; error: { code: string; message: string } };

const EMPTY: TagsForm = {
  gtmId: '',
  ga4Id: '',
  clarityId: '',
  metaPixelId: '',
  customHead: '',
};

export default function SiteSettingsPanel() {
  const [form, setForm] = useState<TagsForm>(EMPTY);
  const [original, setOriginal] = useState<TagsForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [maintenanceMode, setMaintenanceMode] = useState<boolean | null>(null);
  const [savingMaintenance, setSavingMaintenance] = useState(false);

  useEffect(() => {
    void load();
    void loadSiteSettings();
  }, []);

  async function loadSiteSettings() {
    try {
      const res = await fetch('/api/site-settings');
      if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
      const json = (await res.json()) as { success: true; data: SiteSettingsResponse };
      setMaintenanceMode(json.data.maintenanceMode);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function toggleMaintenance(next: boolean) {
    setSavingMaintenance(true);
    try {
      const res = await fetch('/api/site-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maintenanceMode: next }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '保存失敗'));
      setMaintenanceMode(next);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingMaintenance(false);
    }
  }

  async function load() {
    try {
      const res = await fetch('/api/tracking-tags');
      if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
      const json = (await res.json()) as {
        success: true;
        data: {
          gtmId: string | null;
          ga4Id: string | null;
          clarityId: string | null;
          metaPixelId: string | null;
          customHead: string | null;
        };
      };
      const fresh: TagsForm = {
        gtmId: json.data.gtmId ?? '',
        ga4Id: json.data.ga4Id ?? '',
        clarityId: json.data.clarityId ?? '',
        metaPixelId: json.data.metaPixelId ?? '',
        customHead: json.data.customHead ?? '',
      };
      setForm(fresh);
      setOriginal(fresh);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  function set<K extends keyof TagsForm>(key: K, value: TagsForm[K]) {
    setForm((cur) => ({ ...cur, [key]: value }));
  }

  const isDirty = JSON.stringify(form) !== JSON.stringify(original);

  async function save() {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/tracking-tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gtmId: form.gtmId.trim() || null,
          ga4Id: form.ga4Id.trim() || null,
          clarityId: form.clarityId.trim() || null,
          metaPixelId: form.metaPixelId.trim() || null,
          customHead: form.customHead,
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res, '保存失敗'));
      setOriginal(form);
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt(null), 2000);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-500">読み込み中...</p>;
  }

  return (
    <div className="space-y-6">
      <section
        className={`rounded-lg shadow-sm border p-6 space-y-3 ${
          maintenanceMode
            ? 'bg-amber-50 border-amber-300'
            : 'bg-white border-gray-200'
        }`}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              メンテナンスモード
              {maintenanceMode && (
                <span className="ml-2 text-[11px] uppercase tracking-wider text-amber-800 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5">
                  ON
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-600 mt-1">
              ON にすると **すべての公開LP** が「メンテナンス中」ページに置き換わります。
              管理画面は引き続き使えます
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={maintenanceMode === true}
              disabled={maintenanceMode === null || savingMaintenance}
              onChange={(e) => toggleMaintenance(e.target.checked)}
              className="w-5 h-5"
            />
            <span className="text-sm font-medium text-gray-700">
              {savingMaintenance
                ? '保存中...'
                : maintenanceMode
                  ? '解除する'
                  : 'メンテにする'}
            </span>
          </label>
        </header>
      </section>

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-5">
        <header>
          <h2 className="text-lg font-semibold text-gray-900">
            追跡タグ(計測・解析)
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            すべての公開LPの &lt;head&gt; に挿入されます。<br />空欄なら出力されません。
          </p>
        </header>

        <Field
          label="Google Tag Manager(GTM-XXXXXXX)"
          help="入れておくと、GA4 / Meta Pixel / その他全部 GTM 経由で管理できます"
          value={form.gtmId}
          onChange={(v) => set('gtmId', v)}
          placeholder="GTM-XXXXXXX"
        />
        <Field
          label="Google Analytics 4(G-XXXXXXX)"
          help="GTM 使わない場合の直接設定"
          value={form.ga4Id}
          onChange={(v) => set('ga4Id', v)}
          placeholder="G-XXXXXXX"
        />
        <Field
          label="Microsoft Clarity ID"
          help="無料のヒートマップ・操作録画ツール"
          value={form.clarityId}
          onChange={(v) => set('clarityId', v)}
          placeholder="abcdefghij"
        />
        <Field
          label="Meta Pixel ID(Facebook / Instagram 広告)"
          help="数字のみのID"
          value={form.metaPixelId}
          onChange={(v) => set('metaPixelId', v)}
          placeholder="000000000000000"
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-gray-700">
            カスタム HTML(自由追加)
          </span>
          <textarea
            value={form.customHead}
            onChange={(e) => set('customHead', e.target.value)}
            placeholder={'<!-- 任意の <script>, <meta>, <link> 等を貼り付け -->'}
            rows={6}
            maxLength={8000}
            className="px-2 py-1.5 border border-gray-300 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
            ⚠ ここに貼り付ける HTML はそのまま全 LP に出力されます。<br />信頼できるコードのみ貼ってください。
          </span>
        </label>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          {savedAt && (
            <span className="text-xs text-emerald-700">✓ 保存しました</span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!isDirty || saving}
            className="px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </section>

      <section className="bg-blue-50 border border-blue-200 rounded p-4 text-sm text-blue-900">
        <p className="font-medium mb-1">追跡タグの使い分け</p>
        <ul className="text-xs space-y-1 list-disc pl-5">
          <li>
            <strong>GTM だけ入れる</strong> → 一番ラク。他のタグは GTM 内で管理
          </li>
          <li>
            <strong>GA4 単体</strong> → GTM 使わずに Google Analytics だけ
          </li>
          <li>
            <strong>Clarity</strong> → 訪問者の操作録画・ヒートマップ(無料)
          </li>
          <li>
            <strong>Meta Pixel</strong> → Facebook / Instagram 広告のコンバージョン計測
          </li>
        </ul>
      </section>
    </div>
  );
}

interface FieldProps {
  label: string;
  help?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

function Field({ label, help, value, onChange, placeholder }: FieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={100}
        className="px-2 py-1.5 border border-gray-300 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
      />
      {help && <span className="text-[11px] text-gray-500">{help}</span>}
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
