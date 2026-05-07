/**
 * DropZone
 *
 * A drag-and-drop target that accepts the same inputs as SectionAdder:
 * loose images (PNG/JPG/WebP) or a ZIP archive containing images.
 * Files dropped here go through the shared upload pipeline.
 *
 * Visual states:
 * - idle: dashed border, neutral colors
 * - drag-over: highlighted border + subtle background tint
 * - busy: progress text, blocking new drops
 */

import { useState } from 'react';
import { processFiles } from '../../lib/upload';

interface Props {
  lpId: string;
}

export default function DropZone({ lpId }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  async function processSelected(files: File[]) {
    if (busy || files.length === 0) return;
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
        alert(`${succeeded}件追加、${failed.length}件失敗\n\n${detail}`);
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

  function onDragOver(e: React.DragEvent) {
    if (busy) return;
    e.preventDefault();
    setDragOver(true);
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files
      ? Array.from(e.dataTransfer.files)
      : [];
    void processSelected(files);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    void processSelected(files);
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`border-2 border-dashed rounded-lg px-6 py-8 text-center transition-colors ${
        busy
          ? 'border-blue-400 bg-blue-50'
          : dragOver
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400'
      }`}
    >
      {busy ? (
        <p className="text-sm text-blue-700 font-medium">{progress}</p>
      ) : (
        <div className="text-sm text-gray-600">
          <p className="font-medium text-gray-700">
            ここに画像をドラッグ&ドロップ
          </p>
          <p className="text-xs text-gray-500 mt-1">
            PNG / JPG / WebP(複数可)・画像をまとめた ZIP も対応
          </p>
          <label className="mt-3 inline-block px-3 py-1.5 text-sm font-medium rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer">
            またはファイルを選ぶ
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,.zip"
              multiple
              className="sr-only"
              onChange={onFileChange}
            />
          </label>
        </div>
      )}
    </div>
  );
}
