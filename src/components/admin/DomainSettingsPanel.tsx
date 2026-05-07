/**
 * DomainSettingsPanel
 *
 * Lets the self-hoster wire a custom domain to this Worker.
 *
 * Two-step model:
 *   1. Self-hoster registers lp.{domain} as a Custom Domain in
 *      Cloudflare's dashboard.
 *   2. Self-hoster types the bare apex into this panel; we sanitise,
 *      validate, probe lp.{domain} for our X-Image-LP-Builder-Version header,
 *      and only then commit it to D1. From that point on canonical
 *      URLs, QR codes, share links and Set-Cookie domains all flip
 *      to the new host.
 *
 * The probe is the interesting part — we lean on /api/site-domain
 * (Worker side) to call lp.{domain} so the browser doesn't have to
 * deal with CORS. When the probe fails we surface the cleaned
 * value, the sanitisation notes and a "save anyway" button in a
 * modal instead of a one-shot alert(), because the most common
 * cause is "DNS still propagating" and the self-hoster should be able
 * to override the block.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

type ApiError = { success: false; error: { code: string; message: string; details?: Record<string, unknown> } };

interface DomainState {
  domain: string | null;
  workersDevDisabled: boolean;
}

interface ProbeReport {
  status: 'ok' | 'no_dns' | 'apex_only' | 'other_worker';
  detail?: string;
}

interface ProbePreview {
  cleaned: string;
  notes: string[];
  validationError: string | null;
}

type Modal =
  | { kind: 'none' }
  | {
      kind: 'probe-warning';
      cleaned: string;
      notes: string[];
      probe: ProbeReport;
      workersDevDisabled: boolean;
    }
  | { kind: 'save-success'; domain: string; slugs: string[] }
  | { kind: 'delete-confirm' };

interface PageSummary {
  slug: string;
  status: string;
}

const PROBE_DEBOUNCE_MS = 350;

export default function DomainSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<DomainState>({
    domain: null,
    workersDevDisabled: false,
  });

  // Working copy of the input field. Doesn't touch `saved` until we
  // get a 2xx back from PUT — that way "Cancel" is just a re-render.
  const [input, setInput] = useState('');
  const [workersDevDisabled, setWorkersDevDisabled] = useState(false);

  const [preview, setPreview] = useState<ProbePreview | null>(null);
  // After a blur-triggered auto-correction we freeze the before/after
  // pair here so the self-hoster can see exactly what we changed. Cleared
  // the next time the input is edited so we don't keep stale evidence
  // around once they've moved on.
  const [lastCorrection, setLastCorrection] = useState<{
    before: string;
    after: string;
    notes: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Modal>({ kind: 'none' });
  // The "保存して反映" link in the auto-correction notice scrolls
  // here and pulses for a beat so the self-hoster's eye lands on the
  // actual button instead of stopping at the link text.
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const [saveHighlight, setSaveHighlight] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await fetch('/api/site-domain');
      if (!res.ok) throw new Error(await readApiError(res, '取得失敗'));
      const json = (await res.json()) as { success: true; data: DomainState };
      setSaved(json.data);
      setInput(json.data.domain ?? '');
      setWorkersDevDisabled(json.data.workersDevDisabled);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  // Debounce the preview probe — every keystroke would hammer D1
  // (it does a no-op SELECT on the workspace row) for nothing.
  useEffect(() => {
    if (input.trim().length === 0) {
      setPreview(null);
      return;
    }
    const handle = setTimeout(() => {
      void runPreview(input);
    }, PROBE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input]);

  // Auto-snap the input to the cleaned value once the typing pause
  // has produced a preview. Doing it here instead of on blur means
  // the self-hoster never has to click somewhere else to trigger the
  // correction — paste, pause, done.
  useEffect(() => {
    if (!preview) return;
    const before = input;
    const after = preview.cleaned;
    if (before.trim() === after) return;
    setInput(after);
    if (preview.notes.length > 0) {
      setLastCorrection({ before, after, notes: preview.notes });
    }
  }, [preview]);

  function jumpToSaveButton() {
    const el = saveButtonRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setSaveHighlight(true);
    // Pulse for ~1.5s then clear so the highlight doesn't linger
    // forever and start to look like a permanent state.
    setTimeout(() => setSaveHighlight(false), 1500);
  }

  async function runPreview(value: string) {
    try {
      const res = await fetch(
        `/api/site-domain?probe=${encodeURIComponent(value)}`
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        success: true;
        data: DomainState & { probe?: ProbePreview };
      };
      if (json.data.probe) setPreview(json.data.probe);
    } catch {
      // Preview is best-effort; the real PUT will surface errors.
    }
  }

  async function loadPublishedSlugs(): Promise<string[]> {
    try {
      const res = await fetch('/api/lps?limit=100');
      if (!res.ok) return [];
      const json = (await res.json()) as {
        success: true;
        data: { pages: PageSummary[] };
      };
      return json.data.pages
        .filter((p) => p.status === 'published')
        .map((p) => p.slug);
    } catch {
      return [];
    }
  }

  async function handleSave(force: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/site-domain', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: input,
          workersDevDisabled,
          force,
        }),
      });
      if (res.status === 409 && !force) {
        // Probe failed but the value is otherwise legal — open the
        // override modal so the self-hoster can decide.
        const errBody = (await res.json()) as ApiError;
        const details = errBody.error.details ?? {};
        setModal({
          kind: 'probe-warning',
          cleaned: String(details.cleaned ?? input),
          notes: Array.isArray(details.notes) ? (details.notes as string[]) : [],
          probe: (details.probe as ProbeReport | undefined) ?? {
            status: 'no_dns',
            detail: errBody.error.message,
          },
          workersDevDisabled,
        });
        return;
      }
      if (!res.ok) throw new Error(await readApiError(res, '保存失敗'));
      const json = (await res.json()) as {
        success: true;
        data: DomainState & { notes?: string[] };
      };
      setSaved(json.data);
      setInput(json.data.domain ?? '');
      setWorkersDevDisabled(json.data.workersDevDisabled);
      setPreview(null);
      const slugs = await loadPublishedSlugs();
      setModal({
        kind: 'save-success',
        domain: json.data.domain ?? '',
        slugs,
      });
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/site-domain', { method: 'DELETE' });
      if (!res.ok) throw new Error(await readApiError(res, '削除失敗'));
      const json = (await res.json()) as { success: true; data: DomainState };
      setSaved(json.data);
      setInput('');
      setWorkersDevDisabled(false);
      setPreview(null);
      setModal({ kind: 'none' });
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const cleaned = preview?.cleaned ?? saved.domain ?? '';
  const dirty = useMemo(() => {
    const inputNormalised = input.trim().toLowerCase();
    return (
      inputNormalised !== (saved.domain ?? '') ||
      workersDevDisabled !== saved.workersDevDisabled
    );
  }, [input, workersDevDisabled, saved]);

  if (loading) {
    return <p className="text-sm text-gray-500">読み込み中...</p>;
  }

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-gray-900">独自ドメイン</h2>
        <p className="text-xs text-gray-500 mt-1">
          独自ドメインを設定すると、各 LP の公開 URL / QR コード / OGP / 短縮 URL が
          <code className="mx-1 px-1 py-0.5 bg-gray-100 rounded text-[11px]">
            lp.{'{ドメイン}'}/{'{slug}'}
          </code>
          に自動で切り替わります。先に Cloudflare 管理画面で
          <code className="mx-1 px-1 py-0.5 bg-gray-100 rounded text-[11px]">
            lp.{'{ドメイン}'}
          </code>
          を Custom Domain として登録してください(
          <a
            href="https://developers.cloudflare.com/workers/configuration/routing/custom-domains/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Cloudflare 公式手順
          </a>
          )。
        </p>
      </header>

      <div className="space-y-2">
        <label
          htmlFor="domain-input"
          className="block text-sm font-medium text-gray-700"
        >
          ドメイン名(lp. なし)
        </label>
        <input
          id="domain-input"
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // The previous correction now describes a stale state —
            // the self-hoster is editing again, so drop the explanation.
            if (lastCorrection) setLastCorrection(null);
          }}
          placeholder="example.com"
          autoComplete="off"
          spellCheck={false}
          className="block w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
        />
        {lastCorrection ? (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 space-y-1.5">
            <div className="font-semibold">自動で直しました</div>
            <div className="font-mono text-[11px] break-all">
              <span className="text-gray-500 line-through">
                {lastCorrection.before}
              </span>
              <span className="mx-1 text-gray-400">→</span>
              <span className="text-amber-900 font-semibold">
                {lastCorrection.after}
              </span>
            </div>
            <p>
              内容を確認して
              <button
                type="button"
                onClick={jumpToSaveButton}
                className="mx-0.5 text-amber-900 font-semibold underline underline-offset-2 hover:text-amber-700"
              >
                「保存して反映」
              </button>
              ボタンを押してください。
            </p>
          </div>
        ) : (
          preview?.notes &&
          preview.notes.length > 0 && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 space-y-1">
              <div className="font-semibold">自動で直しています...</div>
              <ul className="list-disc list-inside space-y-0.5">
                {preview.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          )
        )}
        {preview?.validationError && (
          <div className="text-xs text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2 space-y-1">
            <div className="font-semibold">このまま保存できません</div>
            <p>{preview.validationError}</p>
          </div>
        )}
      </div>

      {/* Live preview of the URL the self-hoster will end up with. We
          show a placeholder slug rather than picking the first
          published one to avoid confusing them when the list is
          empty or they haven't published yet. */}
      {cleaned && !preview?.validationError && (
        <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-xs text-gray-700 space-y-1">
          <div className="font-medium text-gray-900">公開 URL のプレビュー</div>
          <div>
            <span className="text-gray-500">あなたのドメイン:</span>{' '}
            <code className="font-mono">{cleaned}</code>
          </div>
          <div>
            <span className="text-gray-500">公開 URL:</span>{' '}
            <code className="font-mono text-blue-700">
              https://lp.{cleaned}/{'{slug}'}
            </code>
          </div>
        </div>
      )}

      <div className="border-t border-gray-100 pt-4 space-y-2">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={workersDevDisabled}
            onChange={(e) => setWorkersDevDisabled(e.target.checked)}
            disabled={input.trim().length === 0}
            className="mt-0.5 disabled:opacity-50"
          />
          <span className="text-sm">
            <span className="font-medium text-gray-900">
              workers.dev URL を停止する
            </span>
            <span className="block text-xs text-gray-500 mt-0.5">
              ON にすると workers.dev URL へのアクセスが全て lp.{'{ドメイン}'} に転送されます。
              <span className="text-gray-700">独自ドメイン設定後の最終ステップとして推奨</span>
              (デフォルト OFF、後方互換のため両 URL 並行稼働)。
            </span>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          ref={saveButtonRef}
          type="button"
          onClick={() => void handleSave(false)}
          disabled={
            busy ||
            !dirty ||
            (preview?.validationError !== null &&
              preview?.validationError !== undefined) ||
            input.trim().length === 0 ||
            // The auto-correction effect runs slightly after the
            // probe arrives. Until the input matches preview.cleaned,
            // the visible text and the actual save target are out
            // of sync — disable so the self-hoster can't fire a save
            // against an in-flight correction.
            (preview !== null && preview.cleaned !== input.trim().toLowerCase())
          }
          className={`px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-shadow ${
            saveHighlight
              ? 'ring-4 ring-blue-300 animate-pulse shadow-lg'
              : ''
          }`}
        >
          {busy ? '処理中...' : '保存して反映'}
        </button>
        {saved.domain && (
          <button
            type="button"
            onClick={() => setModal({ kind: 'delete-confirm' })}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            ドメイン設定を削除
          </button>
        )}
        {dirty && (
          <button
            type="button"
            onClick={() => {
              setInput(saved.domain ?? '');
              setWorkersDevDisabled(saved.workersDevDisabled);
              setPreview(null);
            }}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium rounded text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            変更を破棄
          </button>
        )}
      </div>

      {modal.kind === 'probe-warning' && (
        <Modal onClose={() => setModal({ kind: 'none' })}>
          <ModalHeader title="ドメインがまだ繋がっていません" tone="warning" />
          <p className="text-sm text-gray-700">
            <code className="px-1 py-0.5 bg-gray-100 rounded font-mono">
              lp.{modal.cleaned}
            </code>{' '}
            への接続を確認できませんでした。Cloudflare 側の設定が必要です。
          </p>
          <div className="text-xs text-gray-700 space-y-2 bg-gray-50 border border-gray-200 rounded px-3 py-2.5">
            <p className="font-medium text-gray-800">よくある原因と対処:</p>
            <ul className="space-y-1.5">
              <li>
                <span className="font-medium">
                  Cloudflare で Custom Domain を登録していない
                </span>
                <span className="block text-gray-600 ml-3">
                  → Cloudflare 管理画面の Workers & Pages → Settings →
                  Domains & Routes から Custom Domain を追加してください
                </span>
              </li>
              <li>
                <span className="font-medium">
                  ルートドメイン({modal.cleaned})で登録した
                </span>
                <span className="block text-gray-600 ml-3">
                  → lp.{modal.cleaned} として登録し直してください
                </span>
              </li>
              <li>
                <span className="font-medium">取得直後で DNS 反映待ち</span>
                <span className="block text-gray-600 ml-3">
                  → 最大24時間ほど待ってから再度お試しください
                </span>
              </li>
              <li>
                <span className="font-medium">ドメイン名の打ち間違い</span>
                <span className="block text-gray-600 ml-3">
                  → スペル / ピリオドを確認して入力し直してください
                </span>
              </li>
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModal({ kind: 'none' })}
              disabled={busy}
              className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 hover:underline disabled:opacity-50"
            >
              <span aria-hidden="true">←</span>
              入力し直す
            </button>
            <button
              type="button"
              onClick={() => void handleSave(true)}
              disabled={busy}
              className="ml-auto px-3 py-2 text-sm font-medium rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50"
              title="Cloudflare の設定が完了次第、自動で有効化されます"
            >
              このまま保存(設定完了後に有効化)
            </button>
          </div>
        </Modal>
      )}

      {modal.kind === 'save-success' && (
        <Modal onClose={() => setModal({ kind: 'none' })}>
          <ModalHeader title="独自ドメインを設定しました" tone="success" />
          <p className="text-sm text-gray-700">
            <code className="px-1 py-0.5 bg-blue-50 text-blue-700 rounded font-mono">
              lp.{modal.domain}
            </code>{' '}
            で公開されました。<br />各 LP の公開 URL / QR コード / OGP / 短縮 URL は自動で切り替わります。
          </p>
          {modal.slugs.length > 0 ? (
            <div className="text-xs text-gray-600 space-y-1">
              <p className="font-medium text-gray-800">公開済み LP の新 URL:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {modal.slugs.map((slug) => (
                  <li key={slug}>
                    <a
                      href={`https://lp.${modal.domain}/${slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 hover:underline font-mono"
                    >
                      https://lp.{modal.domain}/{slug}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              公開済みの LP がまだないため、URL リンクは省略しました。
            </p>
          )}
          <p className="text-xs text-gray-500 border-t border-gray-100 pt-3">
            workers.dev URL も引き続き動きます(後方互換)。<br />完全に切替たい場合は「workers.dev URL を停止する」を ON にしてください。
          </p>
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setModal({ kind: 'none' })}
              className="px-3 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700"
            >
              閉じる
            </button>
          </div>
        </Modal>
      )}

      {modal.kind === 'delete-confirm' && (
        <Modal onClose={() => setModal({ kind: 'none' })}>
          <ModalHeader title="独自ドメインの設定を削除しますか?" tone="danger" />
          <p className="text-sm text-gray-700">
            全 LP の URL が workers.dev に戻ります。<br />Cloudflare の Custom Domain は別途、Cloudflare 管理画面の Workers & Pages → Settings → Domains & Routes から削除してください。
          </p>
          <p className="text-xs text-gray-500">
            workers.dev URL の停止トグルも自動で OFF に戻ります。
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModal({ kind: 'none' })}
              disabled={busy}
              className="px-3 py-2 text-sm font-medium rounded text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={busy}
              className="ml-auto px-3 py-2 text-sm font-medium rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? '削除中...' : '削除して workers.dev に戻す'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function Modal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl border border-gray-200 max-w-lg w-full p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ModalHeader({
  title,
  tone,
}: {
  title: string;
  tone: 'warning' | 'success' | 'danger';
}) {
  const colour =
    tone === 'success'
      ? 'text-blue-700'
      : tone === 'danger'
        ? 'text-red-700'
        : 'text-amber-700';
  return <h3 className={`text-base font-semibold ${colour}`}>{title}</h3>;
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}
