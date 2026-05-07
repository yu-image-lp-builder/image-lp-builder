/**
 * PreviewControls
 *
 * Single header button that opens the unified preview tab. The
 * preview page (`/admin/lps/:id/preview/mock`) handles iPhone
 * mock + QR (📱 タブ) and full-width view (🖥 タブ) plus a "戻る"
 * button to come back to this editor.
 *
 * Opens in a new tab via target="_blank" (consistent across
 * browsers), with a stable name so a second click reuses the same
 * tab instead of stacking copies.
 */

interface Props {
  lpId: string;
}

export default function PreviewControls({ lpId }: Props) {
  const previewWindowUrl = `/admin/lps/${lpId}/preview/mock`;

  return (
    <a
      href={previewWindowUrl}
      target={`lp-preview-${lpId}`}
      rel="noopener"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded bg-gray-900 text-white hover:bg-gray-800"
      title="別タブでプレビュー(スマホモック / デスクトップ / QR)"
    >
      <EyeIcon className="w-4 h-4" />
      プレビュー
    </a>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}
