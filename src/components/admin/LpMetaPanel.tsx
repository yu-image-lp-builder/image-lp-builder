/**
 * LpMetaPanel
 *
 * Inline editor for the LP's <head> metadata: page title, description,
 * OGP image (Twitter / Facebook share preview).
 *
 * Saved by patching content.meta and PUTting the whole content back.
 * Optimistic-style: edits debounce on blur and only fire when the
 * value actually changed.
 *
 * Defaults applied at render time (in [slug].astro et al), not here:
 * - title falls back to LP slug
 * - description falls back to empty
 * - OGP image falls back to first section image
 */

import { useState } from 'react';
import type { PageContent, PageMeta, Section } from '../../lib/content';
import { uploadImage } from '../../lib/upload';
import { notifyLpContentSaved } from '../../lib/lp-events';

interface Props {
  lpId: string;
  initialMeta: PageMeta;
  sections: Section[];
}

type ApiError = { success: false; error: { code: string; message: string } };

export default function LpMetaPanel({ lpId, initialMeta, sections }: Props) {
  const [meta, setMeta] = useState<PageMeta>(initialMeta);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [ogUploading, setOgUploading] = useState(false);

  async function commit(patch: Partial<PageMeta>, fieldKey: string) {
    const next = { ...meta, ...patch };
    // Skip empty values so we don't store "" on every blur
    const cleaned: PageMeta = {};
    if (next.title?.trim()) cleaned.title = next.title.trim();
    if (next.description?.trim()) cleaned.description = next.description.trim();
    if (next.ogImage?.trim()) cleaned.ogImage = next.ogImage.trim();
    // Only persist noindex when it's actively on. The omitted-equals-
    // false rule keeps freshly created LPs out of the JSON's noise
    // floor and matches the default-indexable behavior.
    if (next.noindex === true) cleaned.noindex = true;

    setMeta(cleaned);
    setSavingField(fieldKey);
    try {
      const getRes = await fetch(`/api/lps/${lpId}`);
      if (!getRes.ok) throw new Error(await readApiError(getRes, 'LP取得失敗'));
      const getJson = (await getRes.json()) as {
        success: true;
        data: { content: PageContent };
      };
      const updatedContent: PageContent = {
        ...getJson.data.content,
        meta: cleaned,
      };
      const putRes = await fetch(`/api/lps/${lpId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: updatedContent }),
      });
      if (!putRes.ok) throw new Error(await readApiError(putRes, 'LP更新失敗'));
      notifyLpContentSaved();
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingField(null);
    }
  }

  function maybeCommit(field: keyof PageMeta, value: string) {
    if ((meta[field] ?? '') === value) return;
    void commit({ [field]: value }, field);
  }

  const sectionImageOptions = sections
    .filter((s) => s.type === 'image' && s.image?.url)
    .map((s) => s.image);

  const isUsingFirstImage =
    !meta.ogImage && sectionImageOptions[0]?.url;

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold text-gray-700">
            メタ情報(SEO・SNSシェア)
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            タイトル・説明・OGP画像 — 設定しない場合はデフォルトが入ります
          </p>
        </div>
        <span className="text-gray-400 text-sm">
          {collapsed ? '▼ 開く' : '▲ 閉じる'}
        </span>
      </button>

      {!collapsed && (
        <div className="px-5 pb-5 space-y-3 border-t border-gray-100 pt-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600 flex items-center gap-2">
              ページタイトル
              {savingField === 'title' && (
                <span className="text-xs text-gray-400">保存中...</span>
              )}
            </span>
            <input
              type="text"
              defaultValue={meta.title ?? ''}
              onBlur={(e) => maybeCommit('title', e.target.value)}
              placeholder="例:無料相談はこちら|yulab"
              maxLength={120}
              className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <span className="text-[11px] text-gray-500">
              ブラウザのタブ・Google検索結果に出る。空ならLPのslugが使われます
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600 flex items-center gap-2">
              説明文(description)
              {savingField === 'description' && (
                <span className="text-xs text-gray-400">保存中...</span>
              )}
            </span>
            <textarea
              defaultValue={meta.description ?? ''}
              onBlur={(e) => maybeCommit('description', e.target.value)}
              placeholder="例:〇〇の悩みを抱える方へ。〜の方法をお伝えします。"
              maxLength={300}
              rows={2}
              className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
            />
            <span className="text-[11px] text-gray-500">
              SNSシェア時の説明文(80〜120文字目安)
            </span>
          </label>

          <OgImageField
            currentUrl={meta.ogImage}
            isUsingFirstImage={!!isUsingFirstImage}
            saving={savingField === 'ogImage'}
            uploading={ogUploading}
            setUploading={setOgUploading}
            onSet={(url) => commit({ ogImage: url }, 'ogImage')}
            onClear={() => commit({ ogImage: undefined }, 'ogImage')}
          />

          <div className="border-t border-gray-100 pt-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={meta.noindex !== true}
                onChange={(e) =>
                  void commit({ noindex: !e.target.checked }, 'noindex')
                }
                className="mt-0.5 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-300"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-gray-700 flex items-center gap-2">
                  検索エンジンに表示する
                  {savingField === 'noindex' && (
                    <span className="text-xs text-gray-400">保存中...</span>
                  )}
                </span>
                <span className="text-[11px] text-gray-500 leading-snug">
                  広告専用LPやクローズドな配布先のLPは OFF を推奨。
                  OFFにすると検索結果から徐々に消えます(数日〜数週間)
                </span>
              </span>
            </label>
          </div>
        </div>
      )}
    </section>
  );
}

interface OgFieldProps {
  currentUrl: string | undefined;
  isUsingFirstImage: boolean;
  saving: boolean;
  uploading: boolean;
  setUploading: (v: boolean) => void;
  onSet: (url: string) => void;
  onClear: () => void;
}

function OgImageField({
  currentUrl,
  isUsingFirstImage,
  saving,
  uploading,
  setUploading,
  onSet,
  onClear,
}: OgFieldProps) {
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const { url } = await uploadImage(file);
      onSet(url);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    if (uploading) return;
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
    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  const previewSrc = currentUrl || '/no-image.svg';

  function onImgError(e: React.SyntheticEvent<HTMLImageElement>) {
    if (e.currentTarget.src.endsWith('/no-image.svg')) return;
    e.currentTarget.src = '/no-image.svg';
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-600 flex items-center gap-2">
        OGP画像(SNSシェアのサムネ)
        {saving && <span className="text-xs text-gray-400">保存中...</span>}
        {uploading && (
          <span className="text-xs text-blue-600">アップロード中...</span>
        )}
      </span>

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`relative flex items-start gap-3 p-3 border-2 rounded transition-colors ${
          dragOver
            ? 'border-blue-400 border-solid bg-blue-50'
            : currentUrl
              ? 'border-gray-200 border-solid'
              : 'border-gray-300 border-dashed bg-gray-50'
        }`}
      >
        <img
          src={previewSrc}
          alt={currentUrl ? 'OGP プレビュー' : 'No Image'}
          className="w-28 h-20 object-cover rounded bg-gray-100 shrink-0"
          loading="lazy"
          onError={onImgError}
        />
        <div className="flex-1 min-w-0 space-y-2">
          {currentUrl ? (
            <>
              <code className="block text-[11px] font-mono text-gray-500 truncate">
                {currentUrl}
              </code>
              <div className="flex flex-wrap gap-2">
                <OgUploadButton
                  onSelected={handleFile}
                  label="画像を変更"
                  uploading={uploading}
                />
                <button
                  type="button"
                  onClick={onClear}
                  className="px-2 py-1 text-xs font-medium rounded bg-red-50 text-red-700 hover:bg-red-100"
                >
                  クリア
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-600">
                {isUsingFirstImage
                  ? '未設定 — 最初のセクション画像が自動で使われます'
                  : '画像をドラッグ&ドロップ または ボタンから選択'}
              </p>
              <OgUploadButton
                onSelected={handleFile}
                label="画像をアップロード"
                uploading={uploading}
              />
            </div>
          )}
        </div>
        {dragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-blue-500/20 rounded pointer-events-none">
            <span className="px-3 py-1.5 rounded-full bg-blue-600 text-white text-sm font-medium shadow-lg">
              ドロップで OGP 画像に設定
            </span>
          </div>
        )}
      </div>

      <span className="text-[11px] text-gray-500">
        推奨 1200×630。WebP に自動変換されます
      </span>
    </div>
  );
}

interface UploadButtonProps {
  onSelected: (file: File) => void;
  label: string;
  uploading: boolean;
}

function OgUploadButton({ onSelected, label, uploading }: UploadButtonProps) {
  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onSelected(file);
  }

  return (
    <label
      className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded cursor-pointer ${
        uploading
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-blue-600 text-white hover:bg-blue-700'
      }`}
    >
      {uploading ? 'アップロード中...' : label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={onChange}
        disabled={uploading}
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
