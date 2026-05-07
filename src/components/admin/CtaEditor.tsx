/**
 * CtaEditor
 *
 * Modal that overlays a section's image with each CTA as a draggable
 * and resizable rectangle (react-rnd). Position and size are persisted
 * as percentages of the section's bounding box so the layout adapts
 * to any viewport width — same convention used by LPRenderer when
 * rendering the public LP.
 *
 * Snapping:
 * - Targets: container center (X / Y), other CTAs' edges and centers
 * - Threshold: SNAP_THRESHOLD pixels
 * - Live guide lines (blue dashed) appear during drag when a snap
 *   target is within range; positions snap on drop.
 */

import { useEffect, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import type { Cta, CtaImage, CtaLink, CtaAnimation, Section } from '../../lib/content';
import { CTA_ANIMATIONS } from '../../lib/content';
import { setButtonClipboard } from '../../lib/clipboard';
import { uploadImage } from '../../lib/upload';
import AddCtaMenu from './CtaPresets';

interface MyLink {
  id: string;
  label: string;
  url: string;
}

const ANIMATION_LABELS: Record<CtaAnimation, string> = {
  none: 'なし',
  pulse: 'パルス(やさしく拡大)',
  shake: 'シェイク(左右に揺れ)',
  bounce: 'バウンス(上下にはねる)',
  glow: 'グロー(ふわっと光る)',
  fade: 'フェード(明滅)',
};

interface Props {
  section: Section;
  busy: boolean;
  onClose: () => void;
  onSave: (ctas: Cta[]) => Promise<void>;
}

interface Guides {
  verticalAt?: number; // x in px (vertical guide line)
  horizontalAt?: number; // y in px (horizontal guide line)
}

const SNAP_THRESHOLD = 8;
const MAX_CTAS = 2;

// Mirror of the lenient checks in src/lib/content.ts so the editor
// can flag bad tel / mailto values before the save round-trips and
// the visitor ends up tapping a broken `tel:` / `mailto:` link.
const CTA_TEL_PATTERN = /^[+\d\s().-]+$/;
const CTA_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors src/lib/url.ts:validateUrlScheme with `kind: 'absolute'`.
// CTA destinations always need an absolute URL — relative paths
// would resolve against the public LP origin, which isn't useful
// for line_friend / custom_url / webhook.
function ctaUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'URL を入力してください';
  if (trimmed.startsWith('//') || trimmed.startsWith('/')) {
    return 'http:// または https:// で始まる URL を入力してください';
  }
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'http:// または https:// で始まる URL を入力してください';
    }
    return null;
  } catch {
    return 'URL の形式が正しくありません(http:// や https:// で始める)';
  }
}

export default function CtaEditor({ section, busy, onClose, onSave }: Props) {
  const [ctas, setCtas] = useState<Cta[]>(section.ctas);
  const [saving, setSaving] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [guides, setGuides] = useState<Guides>({});
  const [selectedId, setSelectedId] = useState<string | null>(
    section.ctas[0]?.id ?? null
  );
  const [panelOpen, setPanelOpen] = useState(true);
  const [myLinks, setMyLinks] = useState<MyLink[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/my-links')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.data?.myLinks) return;
        setMyLinks(json.data.myLinks);
      })
      .catch(() => {
        // Silent fail — MyLinks UI is just an extra convenience here
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = ctas.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setContainerSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose();
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, saving]);

  function updateCta(id: string, patch: Partial<Cta>) {
    setCtas((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function addCtaFromTemplate(template: Omit<Cta, 'id'>) {
    if (ctas.length >= MAX_CTAS) return;
    const newCta: Cta = { id: crypto.randomUUID(), ...template };
    setCtas((cur) => [...cur, newCta]);
    setSelectedId(newCta.id);
  }

  /**
   * Apply a preset to the currently selected CTA, keeping its
   * position and size (the user has likely tuned those) but
   * overwriting text, style, and link target from the preset.
   */
  function applyPresetToSelected(template: Omit<Cta, 'id'>) {
    if (!selectedId) return;
    setCtas((cur) =>
      cur.map((c) => {
        if (c.id !== selectedId) return c;
        // Keep the user's link values where the destination type
        // matches (e.g. switching between two URL-based presets
        // keeps the URL). Type-incompatible fields fall back to
        // the preset defaults via migrateLink.
        return {
          ...c,
          text: template.text,
          style: template.style,
          link: migrateLink(c.link, template.link.type),
        };
      })
    );
  }

  function removeCta(id: string) {
    setCtas((cur) => {
      const next = cur.filter((c) => c.id !== id);
      // shift selection to the previous CTA if the deleted one was selected
      if (selectedId === id) {
        const idx = cur.findIndex((c) => c.id === id);
        const fallback = next[idx - 1] ?? next[0] ?? null;
        setSelectedId(fallback?.id ?? null);
      }
      return next;
    });
  }

  async function handleSave() {
    // Frontend pre-check so the operator gets a Japanese, plain-language
    // error before the API rejects the whole content. Same shape of
    // rules as src/lib/content.ts's validateCtaLink, just user-facing
    // copy. We don't tag each error with a "「ボタンA」: " prefix because
    // CTA capacity caps at MAX_CTAS = 2 and the editor only ever shows
    // one button's form at a time, so a generic message is clearer.
    const errors: string[] = [];
    ctas.forEach((cta) => {
      const link = cta.link;
      switch (link.type) {
        case 'line_friend':
          if (!link.url?.trim()) {
            errors.push('LINE 友だち追加 URL を入力してください');
          } else {
            const urlErr = ctaUrlError(link.url);
            if (urlErr) errors.push(`LINE 友だち追加 URL: ${urlErr}`);
          }
          break;
        case 'custom_url':
          if (!link.url?.trim()) {
            errors.push('リンク先 URL を入力してください');
          } else {
            const urlErr = ctaUrlError(link.url);
            if (urlErr) errors.push(`リンク先 URL: ${urlErr}`);
          }
          break;
        case 'tel':
          if (!link.number?.trim()) {
            errors.push('電話番号を入力してください');
          } else if (!CTA_TEL_PATTERN.test(link.number.trim())) {
            errors.push(
              '電話番号は半角数字と + ( ) - スペース のみ使えます',
            );
          }
          break;
        case 'mailto':
          if (!link.email?.trim()) {
            errors.push('メールアドレスを入力してください');
          } else if (!CTA_EMAIL_PATTERN.test(link.email.trim())) {
            errors.push(
              'メールアドレスの形式が正しくありません(例: someone@example.com)',
            );
          }
          break;
        case 'webhook':
          if (!link.url?.trim()) {
            errors.push('Webhook URL を入力してください');
          } else {
            const urlErr = ctaUrlError(link.url);
            if (urlErr) errors.push(`Webhook URL: ${urlErr}`);
          }
          if (!link.tag?.trim()) {
            errors.push('Webhook のタグを入力してください');
          }
          break;
      }
    });
    if (errors.length > 0) {
      alert(`保存できません:\n\n・${errors.join('\n・')}`);
      return;
    }

    setSaving(true);
    try {
      await onSave(ctas);
      onClose();
    } catch {
      /* onSave shows its own alert */
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={() => !saving && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="ボタン配置"
    >
      <div
        className="bg-white rounded-lg max-w-[1400px] w-full max-h-[95vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              ボタン配置
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              ドラッグで移動、角を引っ張ってリサイズ・中央や他のボタンに自動吸着
            </p>
          </div>
          <div className="flex items-center gap-2">
            <AddCtaMenu
              disabled={saving || ctas.length >= MAX_CTAS}
              disabledReason={
                ctas.length >= MAX_CTAS
                  ? `1セクションあたり最大${MAX_CTAS}個までです`
                  : undefined
              }
              onPick={addCtaFromTemplate}
            />
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 py-1.5 text-sm font-medium rounded text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || busy}
              className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </header>

        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
          {/* Left column: section image with draggable CTAs. Wider on
              desktop now that the property form lives next to it. */}
          <div className="flex-1 overflow-auto bg-gray-100 p-4 min-h-0">
            <div
              ref={containerRef}
              className="relative mx-auto bg-white shadow"
              style={{
                aspectRatio: `${section.image.width} / ${section.image.height}`,
                maxWidth: '600px',
                width: '100%',
              }}
            >
              <img
                src={section.image.url}
                alt={section.image.alt ?? ''}
                className="absolute inset-0 w-full h-full object-cover select-none"
                draggable={false}
              />
              {containerSize.width > 0 &&
                ctas.map((cta) => (
                  <CtaHandle
                    key={cta.id}
                    cta={cta}
                    others={ctas.filter((c) => c.id !== cta.id)}
                    containerSize={containerSize}
                    isSelected={cta.id === selectedId}
                    onChange={(patch) => updateCta(cta.id, patch)}
                    onGuides={setGuides}
                    onSelect={() => setSelectedId(cta.id)}
                  />
                ))}
              {guides.verticalAt !== undefined && (
                <div
                  className="absolute top-0 bottom-0 border-l border-dashed border-blue-500 pointer-events-none"
                  style={{ left: guides.verticalAt }}
                />
              )}
              {guides.horizontalAt !== undefined && (
                <div
                  className="absolute left-0 right-0 border-t border-dashed border-blue-500 pointer-events-none"
                  style={{ top: guides.horizontalAt }}
                />
              )}
              {ctas.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 pointer-events-none">
                  このセクションにはボタンがありません
                </div>
              )}
            </div>
          </div>

          {/* Right column on desktop, bottom panel on mobile.
              Property form stays visible while the user drags / styles
              the button on the left so colour/text changes are
              immediately visible without scrolling. */}
          <div className="border-t lg:border-t-0 lg:border-l border-gray-200 bg-white lg:w-[380px] lg:shrink-0 flex flex-col lg:overflow-hidden min-h-0">
            {/* Mobile-only collapsible header (hidden on lg+). */}
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              className="lg:hidden w-full flex items-center justify-between px-5 py-2 hover:bg-gray-50 text-left"
              aria-expanded={panelOpen}
            >
              <span className="text-sm font-semibold text-gray-700">
                {selected ? (
                  <>
                    選択中のボタン
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      ({selected.text || '無題'})
                    </span>
                  </>
                ) : (
                  <span className="text-gray-500 font-normal">
                    ボタンを選択すると編集できます
                  </span>
                )}
              </span>
              <span className="text-gray-400 text-sm">
                {panelOpen ? '▲ 閉じる' : '▼ 開く'}
              </span>
            </button>

            {/* Desktop-only sticky header (hidden on mobile, where the
                collapsible header above replaces it). */}
            <div className="hidden lg:flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
              <span className="text-sm font-semibold text-gray-700">
                {selected ? (
                  <>
                    選択中のボタン
                    <span className="ml-2 text-xs font-normal text-gray-500 truncate inline-block max-w-[180px] align-bottom">
                      ({selected.text || '無題'})
                    </span>
                  </>
                ) : (
                  <span className="text-gray-500 font-normal">
                    ボタンを選択
                  </span>
                )}
              </span>
            </div>

            {(panelOpen || true) && (
              <div
                className={`px-5 pb-4 lg:overflow-y-auto lg:overflow-x-hidden lg:flex-1 ${
                  panelOpen ? '' : 'hidden lg:block'
                }`}
              >
                {selected ? (
                  <div className="pt-3">
                    <div className="flex items-center justify-end gap-2 mb-3 flex-wrap">
                      <CopyButton cta={selected} />
                      <AddCtaMenu
                        disabled={false}
                        label="種類変更"
                        variant="outline"
                        alignMenu="right"
                        menuPosition="below"
                        onPick={applyPresetToSelected}
                      />
                      <button
                        type="button"
                        onClick={() => removeCta(selected.id)}
                        className="px-2 py-1 text-xs font-medium rounded bg-red-50 text-red-700 hover:bg-red-100"
                      >
                        削除
                      </button>
                    </div>
                    {/*
                      Key on the selected CTA so CtaPropertyForm and
                      its CtaLinkForm subtree remount whenever the
                      operator switches between buttons. Otherwise
                      per-type drafts inside CtaLinkForm bleed across
                      buttons.
                    */}
                    <CtaPropertyForm
                      key={selected.id}
                      cta={selected}
                      onChange={(patch) => updateCta(selected.id, patch)}
                      myLinks={myLinks}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center py-6">
                    左の画像でボタンをクリックして選択すると、
                    <br />
                    ここで詳細を編集できます
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface PropertyFormProps {
  cta: Cta;
  onChange: (patch: Partial<Cta>) => void;
  myLinks: MyLink[];
}

function CtaPropertyForm({ cta, onChange, myLinks }: PropertyFormProps) {
  function patchStyle(stylePatch: Partial<Cta['style']>) {
    onChange({ style: { ...cta.style, ...stylePatch } });
  }

  const hasImage = !!cta.image;

  return (
    <div className="space-y-3 text-sm">
      <CtaImagePicker
        image={cta.image}
        onChange={(img) => onChange({ image: img })}
      />

      <div className="grid grid-cols-2 gap-3">
      <label className="flex flex-col gap-1 min-w-0 col-span-2">
        <span className="text-xs font-medium text-gray-600">
          {hasImage ? '文言(検索エンジン用 / alt)' : '文言'}
        </span>
        <input
          type="text"
          value={cta.text}
          onChange={(e) => onChange({ text: e.target.value })}
          maxLength={60}
          placeholder="例:無料相談はこちら"
          className="min-w-0 w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </label>

      <label className="flex flex-col gap-1 min-w-0">
        <span className="text-xs font-medium text-gray-600">背景色</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={cta.style.backgroundColor}
            onChange={(e) => patchStyle({ backgroundColor: e.target.value })}
            className="w-10 h-9 rounded border border-gray-300"
          />
          <input
            type="text"
            value={cta.style.backgroundColor}
            onChange={(e) => patchStyle({ backgroundColor: e.target.value })}
            className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
      </label>

      <label className="flex flex-col gap-1 min-w-0">
        <span className="text-xs font-medium text-gray-600">文字色</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={cta.style.textColor}
            onChange={(e) => patchStyle({ textColor: e.target.value })}
            className="w-10 h-9 rounded border border-gray-300"
          />
          <input
            type="text"
            value={cta.style.textColor}
            onChange={(e) => patchStyle({ textColor: e.target.value })}
            className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
      </label>

      <label className="flex flex-col gap-1 min-w-0">
        <span className="text-xs font-medium text-gray-600">角丸 (px)</span>
        <input
          type="number"
          value={cta.style.borderRadius}
          onChange={(e) =>
            patchStyle({
              borderRadius: Math.max(0, Number(e.target.value) || 0),
            })
          }
          min={0}
          max={100}
          className="min-w-0 w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </label>

      <label className="flex flex-col gap-1 min-w-0">
        <span className="text-xs font-medium text-gray-600">
          フォントサイズ (px)
        </span>
        {/*
          Show 28 as the visible default when the CTA hasn't customised
          fontSize. ctaPreviewFontSize already uses 28 as the scaling
          anchor in that case, so surfacing the same number means the
          operator sees the value the renderer is actually applying
          rather than an empty field labelled "自動".
        */}
        <input
          type="number"
          value={cta.style.fontSize ?? 28}
          onChange={(e) => {
            const v = e.target.value;
            patchStyle({
              fontSize: v === '' ? undefined : Math.max(8, Number(v) || 8),
            });
          }}
          min={8}
          max={120}
          className="min-w-0 w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </label>

      <label className="flex flex-col gap-1 min-w-0 col-span-2">
        <span className="text-xs font-medium text-gray-600">
          アニメーション(注目を引きたい時)
        </span>
        <select
          value={cta.animation ?? 'none'}
          onChange={(e) => {
            const v = e.target.value as CtaAnimation;
            onChange({ animation: v === 'none' ? undefined : v });
          }}
          className="min-w-0 w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          {CTA_ANIMATIONS.map((a) => (
            <option key={a} value={a}>
              {ANIMATION_LABELS[a]}
            </option>
          ))}
        </select>
      </label>

      <div className="col-span-2 border-t border-gray-200 pt-3 mt-1">
        <CtaLinkForm
          link={cta.link}
          onChange={(link) => onChange({ link })}
          myLinks={myLinks}
        />
      </div>
      </div>
    </div>
  );
}

interface CtaImagePickerProps {
  image: CtaImage | undefined;
  onChange: (image: CtaImage | undefined) => void;
}

function CtaImagePicker({ image, onChange }: CtaImagePickerProps) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const uploaded = await uploadImage(file);
      onChange({
        url: uploaded.url,
        width: uploaded.width,
        height: uploaded.height,
      });
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
    }
  }

  function onPickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void handleFile(file);
  }

  return (
    <div className="border border-gray-200 rounded p-3 bg-gray-50/50">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <span className="text-xs font-semibold text-gray-700">
            ボタン画像(任意)
          </span>
          <p className="text-[11px] text-gray-500 mt-0.5">
            設定すると、色・角丸・文字サイズの代わりに画像が表示されます。Canva 等で作ったボタン画像を上げてください
          </p>
        </div>
        {image && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="px-2 py-1 text-xs font-medium rounded bg-red-50 text-red-700 hover:bg-red-100 shrink-0"
          >
            画像を外す
          </button>
        )}
      </div>

      {image ? (
        <div className="flex items-start gap-3">
          <div className="w-24 h-24 bg-white border border-gray-200 rounded flex items-center justify-center overflow-hidden shrink-0">
            <img
              src={image.url}
              alt="ボタン画像プレビュー"
              className="max-w-full max-h-full object-contain"
            />
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="text-[11px] text-gray-500">
              {image.width} × {image.height}px
            </div>
            <CtaImageUploadButton
              uploading={uploading}
              onPick={onPickerChange}
              label="画像を変更"
            />
          </div>
        </div>
      ) : (
        <CtaImageUploadButton
          uploading={uploading}
          onPick={onPickerChange}
          label="ボタン画像をアップロード"
        />
      )}
    </div>
  );
}

interface CtaImageUploadButtonProps {
  uploading: boolean;
  label: string;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function CtaImageUploadButton({
  uploading,
  label,
  onPick,
}: CtaImageUploadButtonProps) {
  return (
    <label
      className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded cursor-pointer ${
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
        onChange={onPick}
        disabled={uploading}
      />
    </label>
  );
}

interface LinkFormProps {
  link: CtaLink;
  onChange: (link: CtaLink) => void;
  myLinks: MyLink[];
}

const LINK_TYPE_LABELS: Record<CtaLink['type'], string> = {
  line_friend: 'LINE 友だち追加',
  custom_url: '外部URL',
  tel: '電話番号',
  mailto: 'メールアドレス',
  webhook: 'Webhook(高度)',
};

// Types currently exposed to the picker. `webhook` stays in the data
// model and continues to render for any CTA already saved with it,
// but it's hidden from the dropdown so new CTAs can't pick a type
// whose send-on-click delivery isn't implemented yet.
const SELECTABLE_LINK_TYPES: ReadonlyArray<CtaLink['type']> = [
  'line_friend',
  'custom_url',
  'tel',
  'mailto',
];

/**
 * Switch the link's type while preserving any field values that
 * still apply (e.g. URL when going custom_url -> line_friend).
 * Only fields that don't carry over fall back to the type's defaults.
 */
/**
 * Treat any of the seed URLs we ship in CTA presets as "no real value
 * was entered yet" so type changes don't carry the placeholder forward
 * into the new shape. Same intent as forcing empty defaults — we want
 * the operator to put their own URL in.
 */
function isPlaceholderUrl(url: string): boolean {
  if (!url) return true;
  const u = url.trim().toLowerCase();
  return (
    u === '' ||
    u === 'https://' ||
    u === 'http://' ||
    u === 'https://lin.ee/'
  );
}

function migrateLink(oldLink: CtaLink, newType: CtaLink['type']): CtaLink {
  const oldUrl = 'url' in oldLink ? oldLink.url : '';
  const oldTag = oldLink.type === 'webhook' ? oldLink.tag : '';
  const oldApiKey = oldLink.type === 'webhook' ? oldLink.apiKey : undefined;
  const oldNumber = oldLink.type === 'tel' ? oldLink.number : '';
  const oldEmail = oldLink.type === 'mailto' ? oldLink.email : '';

  switch (newType) {
    case 'line_friend':
      // 旧 URL がプレースホルダ ('https://...' / 'https://lin.ee/' 等)
      // 由来でも空に戻して、必ずユーザー入力を強制する。
      return { type: 'line_friend', url: isPlaceholderUrl(oldUrl) ? '' : oldUrl };
    case 'custom_url':
      return {
        type: 'custom_url',
        url: isPlaceholderUrl(oldUrl) ? '' : oldUrl,
      };
    case 'tel':
      return { type: 'tel', number: oldNumber };
    case 'mailto':
      return { type: 'mailto', email: oldEmail };
    case 'webhook':
      return {
        type: 'webhook',
        url: isPlaceholderUrl(oldUrl) ? '' : oldUrl,
        tag: oldTag,
        apiKey: oldApiKey,
      };
  }
}

function CtaLinkForm({ link, onChange, myLinks }: LinkFormProps) {
  // Snapshot the link as it was when the editor opened. Returning to
  // the originally-saved type should restore the persisted values
  // (e.g. the operator opens a tel CTA at 03-xxxx, flips to custom_url
  // to glance at it, then flips back — they expect 03-xxxx, not an
  // empty field). In-flight draft inputs for the *other* type are
  // intentionally not preserved: half-typed work shouldn't reappear
  // when the type is switched away and back.
  const initialLinkRef = useRef(link);

  function changeType(newType: CtaLink['type']) {
    if (newType === link.type) return;
    const initial = initialLinkRef.current;
    if (newType === initial.type) {
      onChange(initial);
    } else {
      onChange(migrateLink(link, newType));
    }
  }

  const supportsMyLink =
    link.type === 'custom_url' ||
    link.type === 'line_friend' ||
    link.type === 'webhook';
  const myLinkId = supportsMyLink ? link.myLinkId : undefined;
  const usingMyLink = Boolean(myLinkId);

  function pickMyLink(id: string) {
    if (!supportsMyLink) return;
    if (id === '') {
      // Switch back to inline URL — keep the current url value.
      onChange({ ...link, myLinkId: undefined });
      return;
    }
    const ml = myLinks.find((m) => m.id === id);
    if (!ml) return;
    // Snap inline url to the MyLink url so it acts as a fallback if
    // the MyLink later disappears, and the field reflects reality.
    onChange({ ...link, myLinkId: id, url: ml.url });
  }

  return (
    <div className="flex flex-col gap-3 text-sm w-full">
      <label className="flex flex-col gap-1 min-w-0 w-full">
        <span className="text-xs font-medium text-gray-600">
          リンク先タイプ
        </span>
        <select
          value={link.type}
          onChange={(e) => {
            changeType(e.target.value as CtaLink['type']);
          }}
          className="min-w-0 w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          {/*
            Always show the current type so a CTA already saved as
            `webhook` keeps a consistent dropdown; only the *picker
            list* drops the hidden types.
          */}
          {(link.type === 'webhook'
            ? ([...SELECTABLE_LINK_TYPES, 'webhook'] as CtaLink['type'][])
            : SELECTABLE_LINK_TYPES
          ).map((t) => (
            <option key={t} value={t}>
              {LINK_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      {supportsMyLink && (
        <label className="flex flex-col gap-1 min-w-0 w-full">
          <span className="text-xs font-medium text-gray-600">
            マイリンクから選ぶ
          </span>
          <select
            value={myLinkId ?? ''}
            onChange={(e) => pickMyLink(e.target.value)}
            className="min-w-0 w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value="">カスタム URL を入力(マイリンクを使わない)</option>
            {myLinks.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          {usingMyLink && (
            <span
              className="text-[11px] text-gray-500 mt-0.5 break-all"
              title={myLinks.find((m) => m.id === myLinkId)?.url}
            >
              ↳ {myLinks.find((m) => m.id === myLinkId)?.url}
            </span>
          )}
          {myLinks.length === 0 && (
            <span className="text-xs text-gray-400 mt-0.5">
              マイリンクが登録されていません(
              <a
                href="/admin/my-links"
                target="_blank"
                className="underline text-blue-600"
              >
                ここで登録
              </a>
              すると一元管理できます)
            </span>
          )}
        </label>
      )}

      {(link.type === 'custom_url' || link.type === 'line_friend') && (
        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-medium text-gray-600">
            URL{usingMyLink && '(マイリンク参照中・編集不可)'}
          </span>
          <input
            type="url"
            value={link.url}
            onChange={(e) => onChange({ ...link, url: e.target.value })}
            placeholder={
              link.type === 'line_friend'
                ? 'https://lin.ee/xxxxxxx'
                : 'https://example.com/...'
            }
            readOnly={usingMyLink}
            className={`min-w-0 w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 ${
              usingMyLink ? 'bg-gray-100 text-gray-500' : ''
            }`}
          />
          {!usingMyLink && link.url?.trim() && ctaUrlError(link.url) && (
            <span className="text-xs text-red-600">{ctaUrlError(link.url)}</span>
          )}
        </label>
      )}

      {link.type === 'tel' && (
        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-medium text-gray-600">電話番号</span>
          <input
            type="tel"
            value={link.number}
            onChange={(e) => onChange({ ...link, number: e.target.value })}
            placeholder="03-0000-0000"
            className="min-w-0 w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          {link.number?.trim() && !CTA_TEL_PATTERN.test(link.number.trim()) && (
            <span className="text-xs text-red-600">
              半角数字と + ( ) - スペース のみ使えます
            </span>
          )}
        </label>
      )}

      {link.type === 'mailto' && (
        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-medium text-gray-600">
            メールアドレス
          </span>
          <input
            type="email"
            value={link.email}
            onChange={(e) => onChange({ ...link, email: e.target.value })}
            placeholder="contact@example.com"
            className="min-w-0 w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          {link.email?.trim() && !CTA_EMAIL_PATTERN.test(link.email.trim()) && (
            <span className="text-xs text-red-600">
              形式が正しくありません(例: someone@example.com)
            </span>
          )}
        </label>
      )}

      {link.type === 'webhook' && (
        <>
          <label className="flex flex-col gap-1 min-w-0 w-full">
            <span className="text-xs font-medium text-gray-600">
              Webhook URL{usingMyLink && '(マイリンク参照中・編集不可)'}
            </span>
            <input
              type="url"
              value={link.url}
              onChange={(e) => onChange({ ...link, url: e.target.value })}
              placeholder="https://example.com/webhook"
              readOnly={usingMyLink}
              className={`min-w-0 w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 ${
                usingMyLink ? 'bg-gray-100 text-gray-500' : ''
              }`}
            />
            {!usingMyLink && link.url?.trim() && ctaUrlError(link.url) && (
              <span className="text-xs text-red-600">{ctaUrlError(link.url)}</span>
            )}
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-xs font-medium text-gray-600">
              タグ(必須)
            </span>
            <input
              type="text"
              value={link.tag}
              onChange={(e) => onChange({ ...link, tag: e.target.value })}
              placeholder="LP_top_cta"
              className="min-w-0 w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-xs font-medium text-gray-600">
              APIキー(任意)
            </span>
            <input
              type="text"
              value={link.apiKey ?? ''}
              onChange={(e) =>
                onChange({
                  ...link,
                  apiKey: e.target.value === '' ? undefined : e.target.value,
                })
              }
              placeholder="(必要なら入力)"
              className="min-w-0 w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </label>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            ⚠ Webhook ボタンは公開LPで押しても何も起きません(inert)
          </p>
        </>
      )}
    </div>
  );
}

interface HandleProps {
  cta: Cta;
  others: Cta[];
  containerSize: { width: number; height: number };
  isSelected: boolean;
  onChange: (patch: Partial<Cta>) => void;
  onGuides: (guides: Guides) => void;
  onSelect: () => void;
}

function CtaHandle({
  cta,
  others,
  containerSize,
  isSelected,
  onChange,
  onGuides,
  onSelect,
}: HandleProps) {
  const xPx = (cta.position.x / 100) * containerSize.width;
  const yPx = (cta.position.y / 100) * containerSize.height;
  const wPx = (cta.size.width / 100) * containerSize.width;
  const hPx = (cta.size.height / 100) * containerSize.height;

  /**
   * Compute snap targets in pixels for X axis and Y axis given the
   * current candidate (left, top, width, height). Returns the snapped
   * left/top plus the guide line positions to draw.
   */
  function computeSnap(
    left: number,
    top: number,
    w: number,
    h: number
  ): { left: number; top: number; guides: Guides } {
    const candidates = collectSnapTargets(others, containerSize);

    let snappedLeft = left;
    let snappedTop = top;
    const guides: Guides = {};

    // X axis: try left, center, right of the candidate against each target
    const myLeft = left;
    const myCenter = left + w / 2;
    const myRight = left + w;
    let bestX = SNAP_THRESHOLD + 1;
    let bestXGuide: number | undefined;
    let bestXAdjust = 0;
    for (const tx of candidates.x) {
      const dLeft = Math.abs(myLeft - tx);
      const dCenter = Math.abs(myCenter - tx);
      const dRight = Math.abs(myRight - tx);
      const dist = Math.min(dLeft, dCenter, dRight);
      if (dist < bestX) {
        bestX = dist;
        bestXGuide = tx;
        if (dist === dLeft) bestXAdjust = tx - myLeft;
        else if (dist === dCenter) bestXAdjust = tx - myCenter;
        else bestXAdjust = tx - myRight;
      }
    }
    if (bestX <= SNAP_THRESHOLD) {
      snappedLeft = left + bestXAdjust;
      guides.verticalAt = bestXGuide;
    }

    // Y axis: top, center, bottom
    const myTop = top;
    const myMid = top + h / 2;
    const myBottom = top + h;
    let bestY = SNAP_THRESHOLD + 1;
    let bestYGuide: number | undefined;
    let bestYAdjust = 0;
    for (const ty of candidates.y) {
      const dTop = Math.abs(myTop - ty);
      const dMid = Math.abs(myMid - ty);
      const dBottom = Math.abs(myBottom - ty);
      const dist = Math.min(dTop, dMid, dBottom);
      if (dist < bestY) {
        bestY = dist;
        bestYGuide = ty;
        if (dist === dTop) bestYAdjust = ty - myTop;
        else if (dist === dMid) bestYAdjust = ty - myMid;
        else bestYAdjust = ty - myBottom;
      }
    }
    if (bestY <= SNAP_THRESHOLD) {
      snappedTop = top + bestYAdjust;
      guides.horizontalAt = bestYGuide;
    }

    return { left: snappedLeft, top: snappedTop, guides };
  }

  return (
    <Rnd
      bounds="parent"
      position={{ x: xPx, y: yPx }}
      size={{ width: wPx, height: hPx }}
      onDrag={(_e, d) => {
        const { guides } = computeSnap(d.x, d.y, wPx, hPx);
        onGuides(guides);
      }}
      onDragStop={(_e, d) => {
        const snap = computeSnap(d.x, d.y, wPx, hPx);
        onGuides({});
        onChange({
          position: {
            x: (snap.left / containerSize.width) * 100,
            y: (snap.top / containerSize.height) * 100,
          },
        });
      }}
      onResize={(_e, _dir, ref, _delta, pos) => {
        const w = ref.offsetWidth;
        const h = ref.offsetHeight;
        const { guides } = computeSnap(pos.x, pos.y, w, h);
        onGuides(guides);
      }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        const w = ref.offsetWidth;
        const h = ref.offsetHeight;
        const snap = computeSnap(pos.x, pos.y, w, h);
        onGuides({});
        onChange({
          size: {
            width: (w / containerSize.width) * 100,
            height: (h / containerSize.height) * 100,
          },
          position: {
            x: (snap.left / containerSize.width) * 100,
            y: (snap.top / containerSize.height) * 100,
          },
        });
      }}
      onMouseDown={onSelect}
    >
      <div
        className={`w-full h-full flex items-center justify-center text-center px-2 font-bold leading-tight overflow-hidden cursor-move ${
          isSelected
            ? 'ring-2 ring-blue-500'
            : 'ring-1 ring-blue-300/70'
        } ${
          cta.animation && cta.animation !== 'none'
            ? `cta-anim-${cta.animation}`
            : ''
        }`}
        style={{
          backgroundColor: cta.image ? 'transparent' : cta.style.backgroundColor,
          color: cta.style.textColor,
          borderRadius: cta.image ? 0 : `${cta.style.borderRadius}px`,
          padding: cta.image ? 0 : undefined,
          // Establish container so the inner span can scale via cqw —
          // mirrors the public renderer so WYSIWYG matches.
          containerType: 'inline-size',
        }}
      >
        {cta.image ? (
          <img
            src={cta.image.url}
            alt={cta.text}
            className="w-full h-full object-contain pointer-events-none"
          />
        ) : (
          <span style={{ fontSize: ctaPreviewFontSize(cta) }}>
            {cta.text || '(無題のボタン)'}
          </span>
        )}
      </div>
    </Rnd>
  );
}

/**
 * Mirrors the public renderer's font-size formula so the WYSIWYG
 * preview matches the visitor view. Font scales in lockstep with
 * the CTA box (cqw based) — generous clamp bounds only catch the
 * extremes.
 */
function ctaPreviewFontSize(cta: Cta): string {
  const set = cta.style.fontSize;
  const anchor = typeof set === 'number' && set > 0 ? Math.max(8, set) : 28;
  const cqw = +(anchor / 4).toFixed(2);
  const ceil = anchor * 3;
  return `clamp(8px, ${cqw}cqw, ${ceil}px)`;
}

function CopyButton({ cta }: { cta: Cta }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    // Strip the id; clipboard stores a fresh template that becomes
    // a new instance when pasted.
    const { id: _id, ...template } = cta;
    void _id;
    setButtonClipboard(template);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
        copied
          ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      }`}
      title="このボタンをコピー(他のセクションでも貼り付けられます)"
    >
      {copied ? '✓ コピーしました' : '📋 コピー'}
    </button>
  );
}

function collectSnapTargets(
  others: Cta[],
  containerSize: { width: number; height: number }
): { x: number[]; y: number[] } {
  const x: number[] = [
    0,
    containerSize.width / 2,
    containerSize.width,
  ];
  const y: number[] = [
    0,
    containerSize.height / 2,
    containerSize.height,
  ];

  for (const other of others) {
    const ox = (other.position.x / 100) * containerSize.width;
    const oy = (other.position.y / 100) * containerSize.height;
    const ow = (other.size.width / 100) * containerSize.width;
    const oh = (other.size.height / 100) * containerSize.height;
    x.push(ox, ox + ow / 2, ox + ow);
    y.push(oy, oy + oh / 2, oy + oh);
  }

  return { x, y };
}
