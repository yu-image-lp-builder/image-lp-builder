/**
 * SiteMetaPanel
 *
 * One source image -> two shipped variants:
 *   - Favicon (48px)            for browser tabs
 *   - Apple Touch Icon (180px)  for iOS home screens
 *
 * The self-hoster uploads once; the client compresses to both sizes
 * (browser-image-compression) and stores the two resulting R2 URLs
 * on the site_meta singleton.
 */

import { useEffect, useState } from 'react';
import { uploadIconSet } from '../../lib/upload';

type ApiError = { success: false; error: { code: string; message: string } };

interface SiteMetaForm {
  faviconUrl: string | null;
  appleTouchIconUrl: string | null;
}

const EMPTY: SiteMetaForm = {
  faviconUrl: null,
  appleTouchIconUrl: null,
};

export default function SiteMetaPanel() {
  const [data, setData] = useState<SiteMetaForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await fetch('/api/site-meta');
      if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
      const json = (await res.json()) as {
        success: true;
        data: { faviconUrl: string | null; appleTouchIconUrl: string | null };
      };
      setData({
        faviconUrl: json.data.faviconUrl ?? null,
        appleTouchIconUrl: json.data.appleTouchIconUrl ?? null,
      });
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function patch(body: Record<string, string | null>) {
    const res = await fetch('/api/site-meta', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readApiError(res, '保存失敗'));
    const json = (await res.json()) as {
      success: true;
      data: SiteMetaForm;
    };
    setData(json.data);
  }

  async function handleFile(file: File) {
    if (busy) return;
    setBusy(true);
    try {
      setStage('画像を変換中...');
      const { faviconUrl, appleTouchIconUrl } = await uploadIconSet(file);
      setStage('保存中...');
      await patch({ faviconUrl, appleTouchIconUrl });
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setStage('');
    }
  }

  async function clearAll() {
    if (busy) return;
    if (!confirm('ファビコン・Apple Touch Icon を両方クリアしますか?')) return;
    setBusy(true);
    try {
      await patch({ faviconUrl: null, appleTouchIconUrl: null });
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void handleFile(file);
  }

  function onDragOver(e: React.DragEvent) {
    if (busy) return;
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }
  function onDrop(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function onImgError(e: React.SyntheticEvent<HTMLImageElement>) {
    if (e.currentTarget.src.endsWith('/no-image.svg')) return;
    e.currentTarget.src = '/no-image.svg';
  }

  if (loading) return <p className="text-sm text-gray-500">読み込み中...</p>;

  const hasIcon = data.faviconUrl || data.appleTouchIconUrl;

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-gray-900">
          サイト全体のアイコン
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          1枚アップロードすると、ファビコン(ブラウザタブ)と Apple Touch Icon(iOS ホーム画面)の両方を自動生成します。
          推奨:512×512 程度の正方形 PNG。
        </p>
      </header>

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`relative border-2 rounded p-4 transition-colors ${
          dragOver
            ? 'border-blue-400 border-solid bg-blue-50'
            : hasIcon
              ? 'border-gray-200 border-solid'
              : 'border-gray-300 border-dashed bg-gray-50'
        }`}
      >
        {hasIcon ? (
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <img
                src={data.faviconUrl || '/no-image.svg'}
                alt="ファビコン"
                className="w-8 h-8 rounded bg-gray-100"
                onError={onImgError}
              />
              <div className="text-xs">
                <div className="font-medium text-gray-700">ファビコン</div>
                <div className="text-gray-500">48×48</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <img
                src={data.appleTouchIconUrl || '/no-image.svg'}
                alt="Apple Touch Icon"
                className="w-12 h-12 rounded bg-gray-100"
                onError={onImgError}
              />
              <div className="text-xs">
                <div className="font-medium text-gray-700">
                  Apple Touch Icon
                </div>
                <div className="text-gray-500">180×180</div>
              </div>
            </div>
            <div className="ml-auto flex gap-2">
              <UploadButton
                busy={busy}
                stage={stage}
                onChange={onPick}
                label="画像を変更"
              />
              <button
                type="button"
                onClick={clearAll}
                disabled={busy}
                className="px-2 py-1 text-xs font-medium rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                クリア
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center space-y-2">
            <p className="text-xs text-gray-600">
              画像をドラッグ&ドロップ または ボタンから選択(1枚で2サイズ自動生成)
            </p>
            <UploadButton
              busy={busy}
              stage={stage}
              onChange={onPick}
              label="アイコン画像をアップロード"
            />
          </div>
        )}

        {dragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-blue-500/20 rounded pointer-events-none">
            <span className="px-3 py-1.5 rounded-full bg-blue-600 text-white text-sm font-medium shadow-lg">
              ドロップで設定(2サイズ自動生成)
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function UploadButton({
  busy,
  stage,
  onChange,
  label,
}: {
  busy: boolean;
  stage: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label: string;
}) {
  return (
    <label
      className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded cursor-pointer ${
        busy
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-blue-600 text-white hover:bg-blue-700'
      }`}
    >
      {busy ? stage || '処理中...' : label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={onChange}
        disabled={busy}
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
