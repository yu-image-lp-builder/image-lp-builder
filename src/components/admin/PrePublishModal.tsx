/**
 * PrePublishModal
 *
 * Shown the first time the operator clicks "公開する" on an LP. Surfaces
 * the publish-readiness issues from src/lib/publish-check so they can
 * fix anything obvious (missing CTA, missing meta, no tracking) before
 * the LP goes live.
 *
 * Severity → behaviour:
 *   blocker — disables the publish button until the operator dismisses
 *             or fixes it
 *   warning — shown prominently but doesn't block publish
 *   info    — small note, doesn't block
 *
 * Each issue is clickable: in-page anchors scroll the editor, external
 * URLs open in a new tab so the publish flow isn't lost.
 *
 * The "次回以降このLPでは表示しない" toggle persists per-LP in
 * localStorage. LpActions checks that key before opening the modal.
 */

import { useState } from 'react';
import {
  hasBlockers,
  type CheckIssue,
  type CheckJump,
} from '../../lib/publish-check';

interface Props {
  lpId: string;
  issues: CheckIssue[];
  publishing: boolean;
  onConfirm: (dismissForFuture: boolean) => void;
  onClose: () => void;
}

const SEVERITY_BADGE: Record<
  CheckIssue['severity'],
  { label: string; classes: string; icon: string }
> = {
  blocker: {
    label: '必須',
    classes: 'bg-red-50 text-red-700 border-red-200',
    icon: '🔴',
  },
  warning: {
    label: '推奨',
    classes: 'bg-amber-50 text-amber-800 border-amber-200',
    icon: '🟡',
  },
  info: {
    label: '情報',
    classes: 'bg-blue-50 text-blue-700 border-blue-200',
    icon: 'ℹ️',
  },
};

export default function PrePublishModal({
  lpId: _lpId,
  issues,
  publishing,
  onConfirm,
  onClose,
}: Props) {
  const [dismiss, setDismiss] = useState(false);
  const blocked = hasBlockers(issues);
  const hasAny = issues.length > 0;

  function jump(jumpTo: CheckJump) {
    if (jumpTo.type === 'url') {
      window.open(jumpTo.href, '_blank', 'noopener,noreferrer');
      return;
    }
    const el = document.getElementById(jumpTo.id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Brief flash so the destination is obvious in a long page.
      el.style.transition = 'box-shadow 0.6s';
      el.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.45)';
      window.setTimeout(() => {
        el.style.boxShadow = '';
      }, 1100);
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={() => !publishing && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="公開前チェック"
    >
      <div
        className="bg-white rounded-lg max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">
            公開前チェック
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            {hasAny
              ? blocked
                ? '🔴 必須項目を解決してから公開してください。'
                : '推奨項目があります。気になる箇所はクリックで修正に移動できます。'
              : '✅ チェックリストの問題はありません。公開する準備ができています。'}
          </p>
        </header>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-3">
          {issues.length === 0 && (
            <p className="text-sm text-gray-600">
              すべて問題ありません。
            </p>
          )}
          {issues.map((issue) => {
            const sev = SEVERITY_BADGE[issue.severity];
            return (
              <button
                key={issue.key}
                type="button"
                onClick={() => jump(issue.jumpTo)}
                className={`w-full text-left rounded border ${sev.classes} px-3 py-2 hover:brightness-95 transition`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-base leading-5">{sev.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        {issue.label}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/70">
                        {sev.label}
                      </span>
                    </div>
                    {issue.description && (
                      <p className="text-xs mt-1 opacity-90">
                        {issue.description}
                      </p>
                    )}
                    <span className="text-[11px] underline mt-1 inline-block">
                      {issue.jumpTo.type === 'url'
                        ? '↗ 別タブで設定を開く'
                        : '↑ 修正箇所に移動'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <footer className="px-5 py-3 border-t border-gray-200 flex flex-col gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={dismiss}
              onChange={(e) => setDismiss(e.target.checked)}
            />
            次回以降このLPでは表示しない
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={publishing}
              className="px-3 py-1.5 text-sm font-medium rounded text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => onConfirm(dismiss)}
              disabled={blocked || publishing}
              className="px-3 py-1.5 text-sm font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title={
                blocked ? '必須項目を解決してから公開できます' : undefined
              }
            >
              {publishing ? '公開中...' : '公開する'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
