
import { useEffect, useState } from 'react';
import type {
  Countdown,
  CountdownType,
  CtaLink,
  FloatingCta,
  FloatingCtaImage,
  PageContent,
  Promotions,
  Scarcity,
  StickyPosition,
} from '../../lib/content';
import { uploadImage } from '../../lib/upload';
import { notifyLpContentSaved } from '../../lib/lp-events';

interface MyLinkOption {
  id: string;
  label: string;
  url: string;
}

interface Props {
  lpId: string;
  initialPromotions: Promotions;
}

type ApiError = { success: false; error: { code: string; message: string } };

const COUNTDOWN_DEFAULTS: Countdown = {
  enabled: false,
  type: 'absolute',
  deadline: '',
  durationHours: 72,
  label: '',
  expiredText: '',
  position: 'top',
  backgroundColor: '#dc2626',
  textColor: '#ffffff',
};

const SCARCITY_DEFAULTS: Scarcity = {
  enabled: false,
  text: '残り 3 席',
  position: 'top',
  backgroundColor: '#f59e0b',
  textColor: '#1f2937',
};

const FLOATING_CTA_DEFAULTS: FloatingCta = {
  enabled: false,
  text: '今すぐ申し込む',
  link: { type: 'custom_url', url: '' },
  backgroundColor: '#0ea5e9',
  textColor: '#ffffff',
  borderRadius: 9999,
  position: 'bottom',
  showAfterScrollPercent: 30,
};

export default function PromotionsPanel({ lpId, initialPromotions }: Props) {
  const [promotions, setPromotions] = useState<Promotions>(initialPromotions);
  const [collapsed, setCollapsed] = useState(true);
  const [saving, setSaving] = useState(false);
  const [myLinks, setMyLinks] = useState<MyLinkOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/my-links')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.data?.myLinks) return;
        setMyLinks(json.data.myLinks);
      })
      .catch(() => {
        // MyLinks are an optional convenience here; silent fail is fine.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function persist(next: Promotions) {
    setSaving(true);
    setPromotions(next);
    try {
      const getRes = await fetch(`/api/lps/${lpId}`);
      if (!getRes.ok) throw new Error(await readApiError(getRes, 'LP取得失敗'));
      const getJson = (await getRes.json()) as {
        success: true;
        data: { content: PageContent };
      };

      const updatedContent: PageContent = {
        ...getJson.data.content,
        promotions: next,
      };
      const putRes = await fetch(`/api/lps/${lpId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: updatedContent }),
      });
      if (!putRes.ok) throw new Error(await readApiError(putRes, '保存失敗'));
      notifyLpContentSaved();
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  function updateCountdown(patch: Partial<Countdown>) {
    const current = promotions.countdown ?? COUNTDOWN_DEFAULTS;
    const next: Promotions = {
      ...promotions,
      countdown: { ...current, ...patch },
    };
    void persist(next);
  }

  function updateScarcity(patch: Partial<Scarcity>) {
    const current = promotions.scarcity ?? SCARCITY_DEFAULTS;
    const next: Promotions = {
      ...promotions,
      scarcity: { ...current, ...patch },
    };
    void persist(next);
  }

  function updateFloatingCta(patch: Partial<FloatingCta>) {
    const current = promotions.floatingCta ?? FLOATING_CTA_DEFAULTS;
    const next: Promotions = {
      ...promotions,
      floatingCta: { ...current, ...patch },
    };
    void persist(next);
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
            コンバージョン要素
            {saving && (
              <span className="ml-2 text-xs text-gray-400">保存中...</span>
            )}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            残席数・フローティングCTA
          </p>
        </div>
        <span className="text-gray-400 text-sm">
          {collapsed ? '▼ 開く' : '▲ 閉じる'}
        </span>
      </button>

      {!collapsed && (
        <div className="px-5 pb-5 space-y-6 border-t border-gray-100 pt-4">
          {/* Countdown editor is hidden for now. The data model keeps
              the field so previously-saved countdowns still render on
              public LPs. */}
          {/* <CountdownEditor
            value={promotions.countdown ?? COUNTDOWN_DEFAULTS}
            onChange={updateCountdown}
          /> */}
          <ScarcityEditor
            value={promotions.scarcity ?? SCARCITY_DEFAULTS}
            onChange={updateScarcity}
          />
          <FloatingCtaEditor
            value={promotions.floatingCta ?? FLOATING_CTA_DEFAULTS}
            myLinks={myLinks}
            onChange={updateFloatingCta}
          />
        </div>
      )}
    </section>
  );
}

interface FloatingCtaEditorProps {
  value: FloatingCta;
  myLinks: MyLinkOption[];
  onChange: (patch: Partial<FloatingCta>) => void;
}

const LINK_TYPE_LABELS: Record<CtaLink['type'], string> = {
  custom_url: 'カスタムURL',
  line_friend: 'LINE 友だち追加',
  tel: '電話発信(tel:)',
  mailto: 'メール(mailto:)',
  webhook: 'Webhook(現在 inert)',
};

function FloatingCtaEditor({ value, myLinks, onChange }: FloatingCtaEditorProps) {
  function setLinkType(type: CtaLink['type']) {
    // Reset link payload when type changes so we never carry stale fields.
    let nextLink: CtaLink;
    switch (type) {
      case 'custom_url':
      case 'line_friend':
        nextLink = { type, url: '' };
        break;
      case 'tel':
        nextLink = { type, number: '' };
        break;
      case 'mailto':
        nextLink = { type, email: '' };
        break;
      case 'webhook':
        nextLink = { type, url: '', tag: '' };
        break;
    }
    onChange({ link: nextLink });
  }

  function patchLink(patch: Partial<CtaLink>) {
    onChange({ link: { ...value.link, ...patch } as CtaLink });
  }

  return (
    <div className="border border-gray-200 rounded p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">
            フローティング CTA
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            画面上下に常に出るボタン。スクロール位置で出現させることもできます
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-xs text-gray-700">有効化</span>
        </label>
      </header>

      <fieldset disabled={!value.enabled} className="space-y-3">
        <FloatingCtaImagePicker
          image={value.image}
          imageWidth={value.imageWidth}
          onImageChange={(image) => onChange({ image })}
          onImageWidthChange={(imageWidth) => onChange({ imageWidth })}
        />

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-600">
            {value.image
              ? 'ボタン文言(検索エンジン用 / alt)'
              : 'ボタン文言'}
          </span>
          <input
            type="text"
            value={value.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="例:今すぐ申し込む"
            maxLength={60}
            className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-600">リンク種別</span>
          <select
            value={value.link.type}
            onChange={(e) => setLinkType(e.target.value as CtaLink['type'])}
            className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
          >
            {(Object.keys(LINK_TYPE_LABELS) as Array<CtaLink['type']>).map(
              (k) => (
                <option key={k} value={k}>
                  {LINK_TYPE_LABELS[k]}
                </option>
              )
            )}
          </select>
        </label>

        <LinkTargetField link={value.link} myLinks={myLinks} onPatch={patchLink} />

        <div className="grid grid-cols-4 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">表示位置</span>
            <select
              value={value.position}
              onChange={(e) =>
                onChange({ position: e.target.value as StickyPosition })
              }
              className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
            >
              <option value="bottom">下部</option>
              <option value="top">上部</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">背景色</span>
            <input
              type="color"
              value={value.backgroundColor ?? '#0ea5e9'}
              onChange={(e) => onChange({ backgroundColor: e.target.value })}
              className="h-9 w-full border border-gray-300 rounded cursor-pointer disabled:cursor-not-allowed"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">文字色</span>
            <input
              type="color"
              value={value.textColor ?? '#ffffff'}
              onChange={(e) => onChange({ textColor: e.target.value })}
              className="h-9 w-full border border-gray-300 rounded cursor-pointer disabled:cursor-not-allowed"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">角丸 (px)</span>
            <input
              type="number"
              min={0}
              max={9999}
              value={value.borderRadius ?? 9999}
              onChange={(e) =>
                onChange({ borderRadius: Math.max(0, Number(e.target.value) || 0) })
              }
              className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-600">
            出現タイミング:スクロール {value.showAfterScrollPercent ?? 0}% 経過後
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={value.showAfterScrollPercent ?? 0}
            onChange={(e) =>
              onChange({ showAfterScrollPercent: Number(e.target.value) })
            }
            className="w-full"
          />
          <span className="text-[11px] text-gray-500">
            0% = 常時表示。50% にすると LP の半分まで読んだ訪問者にだけ出ます
          </span>
        </label>

        {value.enabled && value.text && (
          <div className="bg-gray-50 border border-gray-200 rounded p-3 flex items-center justify-center">
            <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-3">
              プレビュー
            </span>
            <span
              className="inline-block px-5 py-2.5 font-bold text-sm shadow-md"
              style={{
                background: value.backgroundColor ?? '#0ea5e9',
                color: value.textColor ?? '#ffffff',
                borderRadius: `${value.borderRadius ?? 9999}px`,
              }}
            >
              {value.text}
            </span>
          </div>
        )}
      </fieldset>
    </div>
  );
}

interface FloatingCtaImagePickerProps {
  image: FloatingCtaImage | undefined;
  imageWidth: number | undefined;
  onImageChange: (image: FloatingCtaImage | undefined) => void;
  onImageWidthChange: (width: number | undefined) => void;
}

function FloatingCtaImagePicker({
  image,
  imageWidth,
  onImageChange,
  onImageWidthChange,
}: FloatingCtaImagePickerProps) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const uploaded = await uploadImage(file);
      onImageChange({
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

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void handleFile(file);
  }

  return (
    <div className="border border-gray-200 rounded p-3 bg-gray-50/50 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-xs font-semibold text-gray-700">
            ボタン画像(任意)
          </span>
          <p className="text-[11px] text-gray-500 mt-0.5">
            設定すると、色・角丸・文字サイズの代わりに画像が表示されます
          </p>
        </div>
        {image && (
          <button
            type="button"
            onClick={() => onImageChange(undefined)}
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
          <div className="flex-1 min-w-0 space-y-2">
            <div className="text-[11px] text-gray-500">
              元サイズ:{image.width} × {image.height}px
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-gray-600">
                表示幅 (px)
              </span>
              <input
                type="number"
                min={40}
                max={2000}
                value={imageWidth ?? 200}
                onChange={(e) =>
                  onImageWidthChange(
                    Math.max(40, Math.min(2000, Number(e.target.value) || 200))
                  )
                }
                className="px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-300 w-28"
              />
              <span className="text-[10px] text-gray-500">
                高さは自動(アスペクト比保持)
              </span>
            </label>
            <label
              className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded cursor-pointer ${
                uploading
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {uploading ? 'アップロード中...' : '画像を変更'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={onPick}
                disabled={uploading}
              />
            </label>
          </div>
        </div>
      ) : (
        <label
          className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded cursor-pointer ${
            uploading
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {uploading ? 'アップロード中...' : 'ボタン画像をアップロード'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={onPick}
            disabled={uploading}
          />
        </label>
      )}
    </div>
  );
}

interface LinkTargetFieldProps {
  link: CtaLink;
  myLinks: MyLinkOption[];
  onPatch: (patch: Partial<CtaLink>) => void;
}

function LinkTargetField({ link, myLinks, onPatch }: LinkTargetFieldProps) {
  // For tel and mailto, MyLinks don't apply; render the corresponding field.
  if (link.type === 'tel') {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-600">電話番号</span>
        <input
          type="tel"
          value={link.number}
          onChange={(e) => onPatch({ number: e.target.value })}
          placeholder="例:09012345678"
          className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
        />
      </label>
    );
  }
  if (link.type === 'mailto') {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-600">メールアドレス</span>
        <input
          type="email"
          value={link.email}
          onChange={(e) => onPatch({ email: e.target.value })}
          placeholder="例:contact@example.com"
          className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
        />
      </label>
    );
  }

  // For url-based types (line_friend / custom_url / webhook): allow
  // either an inline URL or a MyLink reference.
  const myLinkId = 'myLinkId' in link ? link.myLinkId : undefined;
  return (
    <div className="space-y-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-600">マイリンク参照</span>
        <select
          value={myLinkId ?? ''}
          onChange={(e) => {
            const next = e.target.value || undefined;
            onPatch({ myLinkId: next } as Partial<CtaLink>);
          }}
          className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
        >
          <option value="">— 使わない(下のURL を直接使用)—</option>
          {myLinks.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-600">
          URL{myLinkId ? '(マイリンク削除時のフォールバック)' : ''}
        </span>
        <input
          type="url"
          value={'url' in link ? link.url : ''}
          onChange={(e) => onPatch({ url: e.target.value } as Partial<CtaLink>)}
          placeholder="https://example.com/contact"
          className="px-2 py-1.5 border border-gray-300 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
        />
      </label>
      {link.type === 'webhook' && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-600">tag</span>
          <input
            type="text"
            value={link.tag}
            onChange={(e) => onPatch({ tag: e.target.value } as Partial<CtaLink>)}
            placeholder="例:floating_signup"
            className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
          />
          <span className="text-[11px] text-amber-700">
            ⚠ Webhook ボタンは公開LPで押しても何も起きません(inert)
          </span>
        </label>
      )}
    </div>
  );
}

interface ScarcityEditorProps {
  value: Scarcity;
  onChange: (patch: Partial<Scarcity>) => void;
}

function ScarcityEditor({ value, onChange }: ScarcityEditorProps) {
  return (
    <div className="border border-gray-200 rounded p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">残席数 / 在庫数</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            「残り 3 席」「あと 2 名様」など希少性を訴えるバーを表示します
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-xs text-gray-700">有効化</span>
        </label>
      </header>

      <fieldset disabled={!value.enabled} className="space-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-600">表示テキスト</span>
          <input
            type="text"
            value={value.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="例:残り 3 席"
            maxLength={100}
            className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
          />
          <span className="text-[11px] text-gray-500">
            数字は手動更新してください(自動カウントダウンしません)
          </span>
        </label>

        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">表示位置</span>
            <select
              value={value.position}
              onChange={(e) =>
                onChange({ position: e.target.value as StickyPosition })
              }
              className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
            >
              <option value="top">上部</option>
              <option value="bottom">下部</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">背景色</span>
            <input
              type="color"
              value={value.backgroundColor ?? '#f59e0b'}
              onChange={(e) => onChange({ backgroundColor: e.target.value })}
              className="h-9 w-full border border-gray-300 rounded cursor-pointer disabled:cursor-not-allowed"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">文字色</span>
            <input
              type="color"
              value={value.textColor ?? '#1f2937'}
              onChange={(e) => onChange({ textColor: e.target.value })}
              className="h-9 w-full border border-gray-300 rounded cursor-pointer disabled:cursor-not-allowed"
            />
          </label>
        </div>

        {value.enabled && value.text && (
          <div
            className="rounded px-3 py-2 text-sm font-medium text-center"
            style={{
              background: value.backgroundColor ?? '#f59e0b',
              color: value.textColor ?? '#1f2937',
            }}
          >
            <span className="text-[10px] uppercase tracking-wider opacity-70 mr-2">
              プレビュー
            </span>
            {value.text}
          </div>
        )}
      </fieldset>
    </div>
  );
}

interface CountdownEditorProps {
  value: Countdown;
  onChange: (patch: Partial<Countdown>) => void;
}

function CountdownEditor({ value, onChange }: CountdownEditorProps) {
  return (
    <div className="border border-gray-200 rounded p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">
            カウントダウンタイマー
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            期限まで秒単位でカウントダウンするバーを表示します
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-xs text-gray-700">有効化</span>
        </label>
      </header>

      <fieldset disabled={!value.enabled} className="space-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-600">タイマー種別</span>
          <select
            value={value.type ?? 'absolute'}
            onChange={(e) =>
              onChange({ type: e.target.value as CountdownType })
            }
            className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
          >
            <option value="absolute">絶対日時(全員に同じ終了)</option>
            <option value="per_visitor">訪問から○○時間(訪問者ごと)</option>
            <option value="sync_with_unpublish">公開停止日時に同期</option>
          </select>
          <span className="text-[11px] text-gray-500">
            「訪問から」型は cookie で訪問者ごとにスタートが分かれます。
            「同期」型は LP の公開停止日時を自動的に終了時刻にします
          </span>
        </label>

        {(value.type ?? 'absolute') === 'absolute' && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">期限日時</span>
            <input
              type="datetime-local"
              value={toDatetimeLocal(value.deadline ?? '')}
              onChange={(e) =>
                onChange({ deadline: fromDatetimeLocal(e.target.value) })
              }
              className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
            />
          </label>
        )}

        {value.type === 'per_visitor' && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">
              訪問から何時間でカウント終了?
            </span>
            <input
              type="number"
              min={1}
              max={8760}
              value={value.durationHours ?? 72}
              onChange={(e) =>
                onChange({
                  durationHours: Math.max(1, Number(e.target.value) || 0),
                })
              }
              className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50 w-32"
            />
            <span className="text-[11px] text-gray-500">
              例:72(3日)、168(1週間)、720(30日)
            </span>
          </label>
        )}

        {value.type === 'sync_with_unpublish' && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            ⚠ 「公開停止日時」が設定されていない LP では何も表示されません。
            「公開URL」セクションで公開停止日時を入れてください
          </p>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-600">
            ラベル(タイマーの左に出る文言)
          </span>
          <input
            type="text"
            value={value.label ?? ''}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="例:募集終了まで"
            maxLength={50}
            className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-600">
            期限切れ後のメッセージ(空欄ならバーを非表示)
          </span>
          <input
            type="text"
            value={value.expiredText ?? ''}
            onChange={(e) => onChange({ expiredText: e.target.value })}
            placeholder="例:募集は終了しました"
            maxLength={100}
            className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
          />
        </label>

        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">表示位置</span>
            <select
              value={value.position}
              onChange={(e) =>
                onChange({ position: e.target.value as StickyPosition })
              }
              className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-50"
            >
              <option value="top">上部</option>
              <option value="bottom">下部</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">背景色</span>
            <input
              type="color"
              value={value.backgroundColor ?? '#dc2626'}
              onChange={(e) => onChange({ backgroundColor: e.target.value })}
              className="h-9 w-full border border-gray-300 rounded cursor-pointer disabled:cursor-not-allowed"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">文字色</span>
            <input
              type="color"
              value={value.textColor ?? '#ffffff'}
              onChange={(e) => onChange({ textColor: e.target.value })}
              className="h-9 w-full border border-gray-300 rounded cursor-pointer disabled:cursor-not-allowed"
            />
          </label>
        </div>

        <CountdownPreview countdown={value} />
      </fieldset>
    </div>
  );
}

function CountdownPreview({ countdown }: { countdown: Countdown }) {
  if (!countdown.enabled || !countdown.deadline) return null;
  const ms = new Date(countdown.deadline).getTime() - Date.now();
  const display = ms <= 0
    ? countdown.expiredText || '（期限切れ後は非表示）'
    : `${countdown.label ?? ''}${countdown.label ? ' ' : ''}${formatRemaining(ms)}`;
  return (
    <div
      className="rounded px-3 py-2 text-sm font-medium text-center"
      style={{
        background: countdown.backgroundColor ?? '#dc2626',
        color: countdown.textColor ?? '#ffffff',
      }}
    >
      <span className="text-[10px] uppercase tracking-wider opacity-70 mr-2">
        プレビュー
      </span>
      {display}
    </div>
  );
}

/**
 * Format an `<input type="datetime-local">` value (which is local-time
 * "YYYY-MM-DDTHH:MM") from a stored ISO string. Returns "" for empty
 * or unparseable input.
 */
function toDatetimeLocal(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function fromDatetimeLocal(value: string): string {
  if (!value) return '';
  const d = new Date(value); // browser interprets as local time
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function formatRemaining(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (days > 0) return `${days}日 ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}
