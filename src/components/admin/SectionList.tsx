/**
 * SectionList
 *
 * Renders the LP's sections as a sortable list with per-row controls:
 * - drag-and-drop reordering (handle on the leading "⋮⋮ NN" block)
 * - inline alt-text editing (click the alt label, blur/Enter saves,
 *   Esc cancels)
 * - image replacement via the same client-side WebP pipeline as
 *   SectionAdder
 * - delete
 *
 * All mutations are optimistic. The local sections array is updated
 * first; we then GET the latest content (so we don't clobber
 * server-side changes we didn't see) and PUT the merged result.
 * On failure we roll back and surface the message via alert().
 */

import { useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import imageCompression from 'browser-image-compression';
import { notifyLpContentSaved } from '../../lib/lp-events';
import type {
  ArchivedSection,
  Section,
  PageContent,
} from '../../lib/content';
import { uploadOneAsSection } from '../../lib/upload';
import Lightbox from './Lightbox';
import CtaEditor from './CtaEditor';
import type { Cta } from '../../lib/content';

interface Props {
  lpId: string;
  initialSections: Section[];
  initialArchivedSections: ArchivedSection[];
}

type ApiError = { success: false; error: { code: string; message: string } };

const MAX_DIMENSION = 1200;

const IMG_FILE_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(?:webp|png|jpg)$/;

export default function SectionList({
  lpId,
  initialSections,
  initialArchivedSections,
}: Props) {
  const [sections, setSections] = useState<Section[]>(initialSections);
  const [archivedSections, setArchivedSections] = useState<ArchivedSection[]>(
    initialArchivedSections
  );
  const [busy, setBusy] = useState(false);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  const [busyReplaceId, setBusyReplaceId] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [ctaEditId, setCtaEditId] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  /**
   * Replace the current sections (and optionally the archived
   * sections) on the server, preserving everything else in the
   * content payload (meta, promotions, etc.) by always GET-ing the
   * latest first and spreading it into the PUT body.
   *
   * For per-section field edits (alt, image, CTAs) the merge logic
   * keeps any concurrent server-side change to *other* sections.
   */
  async function persistSections(
    nextSections: Section[],
    previous: Section[],
    options: {
      mergeWithLatest?: boolean;
      nextArchived?: ArchivedSection[];
    } = {}
  ) {
    const { mergeWithLatest = true, nextArchived } = options;
    setBusy(true);
    try {
      const getRes = await fetch(`/api/lps/${lpId}`);
      if (!getRes.ok) {
        throw new Error(await readApiError(getRes, 'LP取得失敗'));
      }
      const getJson = (await getRes.json()) as {
        success: true;
        data: { content: PageContent };
      };
      const serverContent = getJson.data.content;

      let chosenSections: Section[];
      if (mergeWithLatest) {
        const latestById = new Map(
          serverContent.sections.map((s) => [s.id, s])
        );
        // For each id in our local order, take our local copy if we
        // changed it, otherwise prefer the server's latest. This
        // keeps reorder-only operations from clobbering ctas etc.
        // We detect "changed" by reference equality: the caller
        // passed an updated section object, the server-only one is
        // a different reference.
        chosenSections = nextSections.map((local) => {
          const fromServer = latestById.get(local.id);
          const previousLocal = previous.find((p) => p.id === local.id);
          if (previousLocal === local && fromServer) {
            return fromServer;
          }
          return local;
        });
      } else {
        chosenSections = nextSections;
      }

      const nextContent: PageContent = {
        ...serverContent,
        version: 1,
        sections: chosenSections,
        ...(nextArchived !== undefined && {
          archived_sections: nextArchived,
        }),
      };

      const putRes = await fetch(`/api/lps/${lpId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: nextContent }),
      });
      if (!putRes.ok) {
        throw new Error(await readApiError(putRes, 'LP更新失敗'));
      }
      notifyLpContentSaved();
    } catch (err) {
      setSections(previous);
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sections.findIndex((s) => s.id === active.id);
    const newIndex = sections.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const previous = sections;
    const next = arrayMove(sections, oldIndex, newIndex);
    setSections(next);
    persistSections(next, previous).catch(() => {
      /* error already alerted; rollback already happened */
    });
  }

  /**
   * Soft-delete: move the section into archived_sections so the user
   * can restore it from the archive pane below. The R2 image stays
   * put — only "完全削除" from the archive removes it.
   */
  async function deleteSection(sectionId: string) {
    if (busy) return;
    const target = sections.find((s) => s.id === sectionId);
    if (!target) return;
    if (
      !confirm(
        'このセクションを削除しますか?\n下の「削除済みセクション」から復元できます。'
      )
    )
      return;

    setBusyDeleteId(sectionId);
    const previous = sections;
    const previousArchived = archivedSections;
    const next = sections.filter((s) => s.id !== sectionId);
    const nextArchived: ArchivedSection[] = [
      ...archivedSections,
      { ...target, archived_at: new Date().toISOString() },
    ];
    setSections(next);
    setArchivedSections(nextArchived);
    try {
      await persistSections(next, previous, {
        mergeWithLatest: false,
        nextArchived,
      });
    } catch {
      setArchivedSections(previousArchived);
    } finally {
      setBusyDeleteId(null);
    }
  }

  /**
   * Move an archived section back into the active list. Appends to
   * the end — preserving the original index would require carrying
   * it in the archive entry, which isn't worth the complexity.
   */
  async function restoreFromArchive(sectionId: string) {
    if (busy) return;
    const target = archivedSections.find((s) => s.id === sectionId);
    if (!target) return;

    const previous = sections;
    const previousArchived = archivedSections;
    // Strip archived_at when promoting back to a live Section.
    const { archived_at: _archivedAt, ...sectionOnly } = target;
    const next: Section[] = [...sections, sectionOnly];
    const nextArchived = archivedSections.filter((s) => s.id !== sectionId);
    setSections(next);
    setArchivedSections(nextArchived);
    try {
      await persistSections(next, previous, {
        mergeWithLatest: false,
        nextArchived,
      });
    } catch {
      setArchivedSections(previousArchived);
    }
  }

  /**
   * Permanently remove an archived section. Drops the entry from
   * archived_sections AND deletes the underlying R2 image. This
   * is the only path in the editor that destroys a stored image,
   * so the confirmation copy spells that out.
   */
  async function permanentlyDelete(sectionId: string) {
    if (busy) return;
    const target = archivedSections.find((s) => s.id === sectionId);
    if (!target) return;
    if (
      !confirm(
        'このセクションを完全に削除しますか?\n画像も含めて元に戻せません。'
      )
    )
      return;

    const previousArchived = archivedSections;
    const nextArchived = archivedSections.filter((s) => s.id !== sectionId);
    setArchivedSections(nextArchived);
    try {
      await persistSections(sections, sections, {
        mergeWithLatest: false,
        nextArchived,
      });
      // R2 cleanup is best-effort: if the section is dropped from
      // content but the bucket DELETE fails, we have an orphaned
      // image — annoying but not corrupt. Don't roll back the
      // archive removal on R2 failure.
      const file = target.image.url.replace(/^\/img\//, '');
      if (IMG_FILE_PATTERN.test(file)) {
        await fetch(`/api/uploads/${file}`, { method: 'DELETE' }).catch(
          () => {}
        );
      }
    } catch {
      setArchivedSections(previousArchived);
    }
  }

  async function updateAlt(sectionId: string, newAlt: string) {
    if (busy) return;
    const trimmed = newAlt;
    const target = sections.find((s) => s.id === sectionId);
    if (!target) return;
    if (target.image.alt === trimmed) return; // no-op, skip PUT

    const previous = sections;
    const next = sections.map((s) =>
      s.id === sectionId
        ? { ...s, image: { ...s.image, alt: trimmed } }
        : s
    );
    setSections(next);
    try {
      await persistSections(next, previous);
    } catch {
      /* handled */
    }
  }

  async function insertAt(index: number, files: File[]) {
    if (busy || files.length === 0) return;
    setBusy(true);
    const previous = sections;
    try {
      const newSections: Section[] = [];
      for (const file of files) {
        const section = await uploadOneAsSection(file);
        newSections.push(section);
      }
      const next = [
        ...sections.slice(0, index),
        ...newSections,
        ...sections.slice(index),
      ];
      setSections(next);
      // mergeWithLatest: false because we're injecting brand new
      // sections at a precise index; merging with the server view
      // would lose the position.
      await persistSections(next, previous, { mergeWithLatest: false });
    } catch (err) {
      setSections(previous);
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveCtas(sectionId: string, newCtas: Cta[]) {
    if (busy) return;
    const previous = sections;
    const next = sections.map((s) =>
      s.id === sectionId ? { ...s, ctas: newCtas } : s
    );
    setSections(next);
    try {
      await persistSections(next, previous);
    } catch (err) {
      // persistSections already rolled the local state back and showed
      // its alert. Re-throw so CtaEditor (the caller) treats this as a
      // failed save and keeps the modal open with the user's drafts —
      // otherwise the editor closes and any unsaved tweaks are lost.
      throw err;
    }
  }

  async function replaceImage(sectionId: string, file: File) {
    if (busy) return;
    setBusyReplaceId(sectionId);
    setBusy(true);
    try {
      const compressed = await imageCompression(file, {
        maxWidthOrHeight: MAX_DIMENSION,
        maxSizeMB: 2,
        fileType: 'image/webp',
        useWebWorker: true,
      });
      const dims = await readImageDimensions(compressed);

      const formData = new FormData();
      formData.append('file', compressed, withWebpExt(file.name));
      formData.append('width', String(dims.width));
      formData.append('height', String(dims.height));

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      if (!uploadRes.ok) {
        throw new Error(await readApiError(uploadRes, 'アップロード失敗'));
      }
      const uploadJson = (await uploadRes.json()) as {
        success: true;
        data: { url: string; width: number; height: number };
      };

      const previous = sections;
      const next = sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              image: {
                ...s.image,
                url: uploadJson.data.url,
                width: uploadJson.data.width,
                height: uploadJson.data.height,
              },
            }
          : s
      );
      setSections(next);
      // The PUT path is wrapped in its own setBusy(true/false), so we
      // briefly have setBusy true here -> false in persistSections ->
      // true again. That's fine; UI just stays disabled throughout.
      await persistSections(next, previous);
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyReplaceId(null);
      setBusy(false);
    }
  }

  return (
    <>
      {sections.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">まだセクションがありません</p>
          <p className="text-xs mt-1 text-gray-400">
            「画像セクションを追加」ボタン、または
            <br />
            下のエリアに画像をドラッグ&ドロップして追加できます
          </p>
        </div>
      ) : (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={sections.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div>
            <InsertSlot
              busy={busy}
              onPick={(files) => insertAt(0, files)}
            />
            {sections.map((section, i) => (
              <div key={section.id}>
                <SortableRow
                  section={section}
                  index={i}
                  busy={busy}
                  isDeleting={busyDeleteId === section.id}
                  isReplacing={busyReplaceId === section.id}
                  onDelete={() => deleteSection(section.id)}
                  onAltSave={(newAlt) => updateAlt(section.id, newAlt)}
                  onReplace={(file) => replaceImage(section.id, file)}
                  onPreview={() => setPreviewIndex(i)}
                  onEditCtas={() => setCtaEditId(section.id)}
                />
                <InsertSlot
                  busy={busy}
                  onPick={(files) => insertAt(i + 1, files)}
                />
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      )}

      {archivedSections.length > 0 && (
        <ArchivePane
          items={archivedSections}
          open={archivedOpen}
          busy={busy}
          onToggle={() => setArchivedOpen((v) => !v)}
          onRestore={restoreFromArchive}
          onPermanentDelete={permanentlyDelete}
        />
      )}
      {previewIndex !== null && (
        <Lightbox
          images={sections.map((s) => ({
            url: s.image.url,
            alt: s.image.alt ?? '',
          }))}
          initialIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
      {ctaEditId !== null &&
        (() => {
          const editing = sections.find((s) => s.id === ctaEditId);
          if (!editing) return null;
          return (
            <CtaEditor
              section={editing}
              busy={busy}
              onClose={() => setCtaEditId(null)}
              onSave={(newCtas) => saveCtas(editing.id, newCtas)}
            />
          );
        })()}
    </>
  );
}

interface RowProps {
  section: Section;
  index: number;
  busy: boolean;
  isDeleting: boolean;
  isReplacing: boolean;
  onDelete: () => void;
  onAltSave: (newAlt: string) => void;
  onReplace: (file: File) => void;
  onPreview: () => void;
  onEditCtas: () => void;
}

function SortableRow({
  section,
  index,
  busy,
  isDeleting,
  isReplacing,
  onDelete,
  onAltSave,
  onReplace,
  onPreview,
  onEditCtas,
}: RowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const [editingAlt, setEditingAlt] = useState(false);
  const [altDraft, setAltDraft] = useState(section.image.alt ?? '');
  const [rowDragOver, setRowDragOver] = useState(false);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };

  function startEditingAlt() {
    if (busy) return;
    setAltDraft(section.image.alt ?? '');
    setEditingAlt(true);
  }

  function commitAlt() {
    setEditingAlt(false);
    onAltSave(altDraft);
  }

  function cancelAlt() {
    setEditingAlt(false);
    setAltDraft(section.image.alt ?? '');
  }

  function onAltKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitAlt();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelAlt();
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onReplace(file);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onDragOver={(e) => {
        if (busy) return;
        // Only react to file drags (ignore the @dnd-kit sortable drag)
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        setRowDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setRowDragOver(false);
      }}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        setRowDragOver(false);
        if (busy) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onReplace(file);
      }}
      className={`relative border rounded p-3 flex gap-3 items-center bg-white transition-colors ${
        rowDragOver
          ? 'border-blue-400 ring-2 ring-blue-400 bg-blue-50'
          : 'border-gray-200'
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="flex items-center gap-1.5 px-2 py-1 -ml-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-50 cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-blue-300"
        aria-label="ドラッグして並び替え"
      >
        <span className="text-base leading-none select-none" aria-hidden="true">
          ⋮⋮
        </span>
        <span className="font-mono text-sm">
          {String(index + 1).padStart(2, '0')}
        </span>
      </button>

      <button
        type="button"
        onClick={onPreview}
        className="relative shrink-0 group rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
        aria-label="画像を拡大表示"
      >
        <img
          src={section.image.url}
          alt={section.image.alt ?? ''}
          className="w-16 h-16 object-cover rounded bg-gray-100"
          loading="lazy"
        />
        <span
          className="absolute inset-0 flex items-center justify-center bg-black/50 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          aria-hidden="true"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
            stroke="currentColor"
            className="w-6 h-6 text-white"
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
        </span>
      </button>

      <div className="flex-1 min-w-0">
        {editingAlt ? (
          <input
            type="text"
            value={altDraft}
            onChange={(e) => setAltDraft(e.target.value)}
            onBlur={commitAlt}
            onKeyDown={onAltKeyDown}
            placeholder="例:FV、お悩み"
            autoFocus
            className="w-full text-sm font-medium px-2 py-1 border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
            maxLength={50}
          />
        ) : (
          <button
            type="button"
            onClick={startEditingAlt}
            disabled={busy}
            title="クリックしてラベルを編集"
            className={`flex items-center gap-1.5 text-left w-full min-w-0 text-sm font-medium px-2 py-1 rounded border border-dashed border-transparent hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50 ${
              section.image.alt
                ? 'text-gray-700'
                : 'text-gray-400 italic'
            }`}
          >
            <span className="text-gray-400 text-xs shrink-0" aria-hidden="true">
              ✎
            </span>
            <span className="flex-1 min-w-0 truncate">
              {section.image.alt || 'ラベルを追加'}
            </span>
          </button>
        )}
        <div className="text-xs text-gray-500 mt-0.5 px-2 truncate">
          {section.image.width} × {section.image.height} px
          &nbsp;·&nbsp; CTA {section.ctas.length}個
        </div>
      </div>

      <label
        className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded cursor-pointer ${
          busy
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
        }`}
        title="クリックでファイル選択(行にドロップでも差し替え可)"
      >
        {isReplacing ? '差し替え中...' : '差し替え'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={onFileChange}
          disabled={busy}
        />
      </label>

      <button
        type="button"
        onClick={onEditCtas}
        disabled={busy}
        className="px-2 py-1 text-xs font-medium rounded bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
        title="ボタンの追加・編集"
      >
        ボタン{section.ctas.length > 0 ? ` (${section.ctas.length})` : ''}
      </button>

      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="px-2 py-1 text-xs font-medium rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="このセクションを削除"
      >
        {isDeleting ? '削除中...' : '削除'}
      </button>
      {rowDragOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-500/20 rounded pointer-events-none">
          <span className="px-3 py-1.5 rounded-full bg-blue-600 text-white text-sm font-medium shadow-lg">
            ドロップして画像を差し替え
          </span>
        </div>
      )}
    </div>
  );
}

interface InsertSlotProps {
  busy: boolean;
  onPick: (files: File[]) => void;
}

function InsertSlot({ busy, onPick }: InsertSlotProps) {
  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length > 0) onPick(files);
  }

  return (
    <label
      className={`group relative block py-1.5 z-20 transition-all ${
        busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'
      }`}
    >
      {/* thin guide line */}
      <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-transparent group-hover:bg-blue-300 transition-colors pointer-events-none" />
      {/* hover-only "+ セクション追加" pill */}
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-600 text-white text-xs font-medium shadow-lg whitespace-nowrap pointer-events-none">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
          className="w-3.5 h-3.5"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 4.5v15m7.5-7.5h-15"
          />
        </svg>
        セクション追加
      </span>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="sr-only"
        onChange={onChange}
        disabled={busy}
      />
    </label>
  );
}

async function readImageDimensions(
  file: Blob
): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiError;
    return data?.error?.message ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}

function withWebpExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? `${name}.webp` : `${name.slice(0, dot)}.webp`;
}

interface ArchivePaneProps {
  items: ArchivedSection[];
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
}

function ArchivePane({
  items,
  open,
  busy,
  onToggle,
  onRestore,
  onPermanentDelete,
}: ArchivePaneProps) {
  return (
    <div className="mt-6 border-t border-gray-200 pt-4">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
        aria-expanded={open}
      >
        <span>{open ? '▼' : '▶'}</span>
        <span>削除済みセクション ({items.length})</span>
      </button>

      {open && (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 p-2 border border-gray-200 rounded bg-gray-50"
            >
              <img
                src={item.image.url}
                alt={item.image.alt ?? ''}
                className="w-16 h-16 object-cover rounded border border-gray-200 bg-white shrink-0"
                loading="lazy"
              />
              <div className="flex-1 min-w-0 text-xs text-gray-600">
                <div className="truncate">
                  CTA {item.ctas.length} 個 / {item.image.width}×
                  {item.image.height}
                </div>
                <div className="text-[11px] text-gray-400">
                  削除日: {formatArchivedAt(item.archived_at)}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRestore(item.id)}
                  className="px-2 py-1 text-xs font-medium rounded bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 disabled:opacity-50"
                >
                  復元
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPermanentDelete(item.id)}
                  className="px-2 py-1 text-xs font-medium rounded bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 disabled:opacity-50"
                >
                  完全削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatArchivedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
