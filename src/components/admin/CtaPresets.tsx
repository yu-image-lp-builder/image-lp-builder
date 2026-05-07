/**
 * AddCtaMenu
 *
 * Replaces the "+ ボタンを追加" button. When clicked, shows a popover
 * with five preset templates (color + shape + link defaults). Picking
 * one inserts a new CTA configured to that preset.
 *
 * Each preset is a sensible starting point; the user can still edit
 * everything afterwards in the property form.
 */

import { useEffect, useRef, useState } from 'react';
import type { Cta } from '../../lib/content';
import {
  getButtonClipboard,
  type ButtonClipboardEntry,
} from '../../lib/clipboard';
import { uploadImage } from '../../lib/upload';

interface Preset {
  id: string;
  label: string;
  description: string;
  build: () => Omit<Cta, 'id'>;
}

/**
 * Presets are organized by *function* (what the button does), not by
 * color. Each preset already wires up an appropriate link type and
 * sensible defaults so the user only fills in the destination
 * (URL / phone / email). Color and shape can still be tweaked after.
 */
const PRESETS: Preset[] = [
  {
    id: 'line-friend',
    label: 'LINE 友だち追加',
    description: 'LINE緑・URLを入力するだけ',
    build: () => ({
      text: 'LINEに登録する',
      position: { x: 20, y: 75 },
      size: { width: 60, height: 8 },
      style: {
        backgroundColor: '#06c755',
        textColor: '#ffffff',
        borderRadius: 40,
      },
      // URL は空にする — テンプレートから追加した時に旧 URL が
      // 残ってると気付かず保存して「リンク先がデフォルトのまま」
      // という事故が起きる。空にして必ず入力させる方向で。
      link: { type: 'line_friend', url: '' },
    }),
  },
  {
    id: 'tel',
    label: '電話で予約',
    description: 'スマホでタップ → 電話発信',
    build: () => ({
      text: '今すぐ電話する',
      position: { x: 20, y: 80 },
      size: { width: 60, height: 9 },
      style: {
        backgroundColor: '#ea580c',
        textColor: '#ffffff',
        borderRadius: 6,
      },
      link: { type: 'tel', number: '' },
    }),
  },
  {
    id: 'mailto',
    label: 'メールで問い合わせ',
    description: 'タップ → メーラー起動',
    build: () => ({
      text: 'メールで問い合わせる',
      position: { x: 20, y: 80 },
      size: { width: 60, height: 8 },
      style: {
        backgroundColor: '#2563eb',
        textColor: '#ffffff',
        borderRadius: 6,
      },
      link: { type: 'mailto', email: '' },
    }),
  },
  {
    id: 'form',
    label: '申込み・登録フォームへ',
    description: 'Tally / Googleフォーム等',
    build: () => ({
      text: '今すぐ申し込む',
      position: { x: 20, y: 80 },
      size: { width: 60, height: 9 },
      style: {
        backgroundColor: '#dc2626',
        textColor: '#ffffff',
        borderRadius: 6,
      },
      link: { type: 'custom_url', url: '' },
    }),
  },
  {
    id: 'external',
    label: '外部サイトへ',
    description: '任意のURLへ遷移',
    build: () => ({
      text: '詳しく見る',
      position: { x: 20, y: 80 },
      size: { width: 60, height: 8 },
      style: {
        backgroundColor: '#1a1a1a',
        textColor: '#ffffff',
        borderRadius: 6,
      },
      link: { type: 'custom_url', url: '' },
    }),
  },
];

interface Props {
  disabled: boolean;
  disabledReason?: string;
  onPick: (cta: Omit<Cta, 'id'>) => void;
  label?: string;
  variant?: 'primary' | 'outline';
  alignMenu?: 'left' | 'right';
  menuPosition?: 'below' | 'above';
}

export default function AddCtaMenu({
  disabled,
  disabledReason,
  onPick,
  label = '+ ボタンを追加',
  variant = 'primary',
  alignMenu = 'right',
  menuPosition = 'below',
}: Props) {
  const [open, setOpen] = useState(false);
  const [clipboard, setClipboard] = useState<ButtonClipboardEntry | null>(null);
  const [uploading, setUploading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadImage(file);
      // Defaults sized for a centred image-button (60% wide, aspect
      // ratio derived from the upload so the rect roughly matches the
      // image — user can drag to resize after.)
      const aspect = uploaded.height / uploaded.width;
      const widthPct = 60;
      const heightPct = Math.max(4, Math.min(40, widthPct * aspect));
      onPick({
        text: '',
        position: { x: (100 - widthPct) / 2, y: 75 },
        size: { width: widthPct, height: heightPct },
        style: {
          backgroundColor: '#000000',
          textColor: '#ffffff',
          borderRadius: 0,
        },
        link: { type: 'custom_url', url: '' },
        image: {
          url: uploaded.url,
          width: uploaded.width,
          height: uploaded.height,
        },
      });
      setOpen(false);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
    }
  }

  // Refresh the clipboard preview every time the menu opens, and
  // listen for changes from copies that happened in this tab.
  useEffect(() => {
    if (open) setClipboard(getButtonClipboard());
    function onChange() {
      setClipboard(getButtonClipboard());
    }
    window.addEventListener('button-clipboard:change', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('button-clipboard:change', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  function pick(preset: Preset) {
    onPick(preset.build());
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={disabled ? disabledReason : 'テンプレを選ぶ'}
        className={
          variant === 'primary'
            ? 'px-3 py-1.5 text-sm font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed'
            : 'px-2 py-1 text-xs font-medium rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed'
        }
      >
        {label}
      </button>
      {open && !disabled && (
        <div
          className={`absolute ${alignMenu === 'right' ? 'right-0' : 'left-0'} ${menuPosition === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'} z-40 w-72 max-h-[60vh] overflow-auto bg-white border border-gray-200 rounded-lg shadow-xl p-2`}
        >
          {clipboard && (
            <>
              <p className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                コピー済みのボタン
              </p>
              <ul className="space-y-1 mb-2">
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(clipboard.template);
                      setOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded bg-emerald-50 hover:bg-emerald-100 text-left"
                  >
                    <span
                      className="shrink-0 inline-flex items-center justify-center text-xs font-bold whitespace-nowrap"
                      style={{
                        backgroundColor:
                          clipboard.template.style.backgroundColor,
                        color: clipboard.template.style.textColor,
                        borderRadius: `${clipboard.template.style.borderRadius}px`,
                        width: '88px',
                        height: '28px',
                      }}
                    >
                      {clipboard.template.text}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-emerald-800 truncate">
                        📋 貼り付け
                      </span>
                      <span className="block text-xs text-emerald-700 truncate">
                        コピーしたボタンを挿入
                      </span>
                    </span>
                  </button>
                </li>
              </ul>
              <div className="border-t border-gray-200 my-2" />
            </>
          )}

          <p className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            画像から作る
          </p>
          <ul className="space-y-1 mb-2">
            <li>
              <label
                className={`w-full flex items-center gap-3 px-2 py-2 rounded text-left cursor-pointer ${
                  uploading
                    ? 'bg-gray-50 cursor-not-allowed'
                    : 'hover:bg-gray-50'
                }`}
              >
                <span
                  className="shrink-0 inline-flex items-center justify-center text-xs font-bold whitespace-nowrap bg-white border border-dashed border-gray-300 rounded text-gray-400"
                  style={{ width: '88px', height: '28px' }}
                >
                  🖼 画像
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-gray-800 truncate">
                    {uploading ? 'アップロード中...' : '画像ボタンを追加'}
                  </span>
                  <span className="block text-xs text-gray-500 truncate">
                    Canva 等で作った画像をそのままボタンに
                  </span>
                </span>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={handleImagePick}
                  disabled={uploading}
                />
              </label>
            </li>
          </ul>
          <div className="border-t border-gray-200 my-2" />

          <p className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            テンプレを選ぶ
          </p>
          <ul className="space-y-1">
            {PRESETS.map((preset) => {
              const cta = preset.build();
              return (
                <li key={preset.id}>
                  <button
                    type="button"
                    onClick={() => pick(preset)}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-gray-50 text-left"
                  >
                    <span
                      className="shrink-0 inline-flex items-center justify-center text-xs font-bold whitespace-nowrap"
                      style={{
                        backgroundColor: cta.style.backgroundColor,
                        color: cta.style.textColor,
                        borderRadius: `${cta.style.borderRadius}px`,
                        width: '88px',
                        height: '28px',
                      }}
                    >
                      {cta.text}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-gray-800 truncate">
                        {preset.label}
                      </span>
                      <span className="block text-xs text-gray-500 truncate">
                        {preset.description}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
