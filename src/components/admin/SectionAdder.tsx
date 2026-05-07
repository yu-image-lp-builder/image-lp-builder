/**
 * SectionAdder
 *
 * Button + hidden file input that lets the user pick one or many
 * image files (PNG/JPG/WebP) or a ZIP archive of images. Each
 * selected file is processed by the shared client-side pipeline
 * (compress -> upload -> append section). On completion the page
 * reloads so the server-rendered list reflects the newest content.
 */

import { useRef, useState } from 'react';
import { processFiles } from '../../lib/upload';

interface Props {
  lpId: string;
}

export default function SectionAdder({ lpId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  function openPicker() {
    if (busy) return;
    inputRef.current?.click();
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;

    setBusy(true);
    try {
      const results = await processFiles(files, lpId, (p) => {
        const stageLabel =
          p.stage === 'compressing'
            ? '変換中'
            : p.stage === 'uploading'
              ? 'アップロード中'
              : '保存中';
        setProgress(`${p.current}/${p.total} ${stageLabel}: ${p.fileName}`);
      });

      const succeeded = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);

      if (failed.length > 0) {
        const detail = failed
          .map((f) => `- ${f.fileName}: ${f.error}`)
          .join('\n');
        alert(
          `${succeeded}件追加、${failed.length}件失敗\n\n${detail}`
        );
      } else if (succeeded === 0) {
        alert('画像ファイルが見つかりませんでした(PNG/JPG/WebP/ZIP に対応)');
      }

      if (succeeded > 0) {
        window.location.reload();
        return;
      }
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,.zip"
        multiple
        className="hidden"
        onChange={onFileChange}
      />
      <button
        type="button"
        disabled={busy}
        onClick={openPicker}
        className="px-3 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        title="画像 / 複数選択 / ZIP 対応"
      >
        {busy ? progress || '処理中...' : '+ 画像セクションを追加'}
      </button>
    </>
  );
}
