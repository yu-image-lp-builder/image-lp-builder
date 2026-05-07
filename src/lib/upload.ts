/**
 * Client-side upload pipeline shared by SectionAdder and DropZone.
 *
 * Handles:
 * - Single image -> WebP-convert -> POST /api/upload
 * - Multiple images -> sequential processing
 * - ZIP archive -> unzip -> filter images -> sequential processing
 * - Adds each successful upload as a new section in the LP via PUT
 *   /api/lps/:id (one PUT per section to keep the source of truth
 *   server-side and to surface partial successes).
 */

import imageCompression from 'browser-image-compression';
import type { PageContent, Section } from './content';

const MAX_DIMENSION = 1200;
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)$/i;

export interface ProgressUpdate {
  current: number;
  total: number;
  fileName: string;
  stage: 'compressing' | 'uploading' | 'saving';
}

export type ProgressCallback = (update: ProgressUpdate) => void;

type UploadedSection = Section;

/**
 * Compress one image file, upload it, and return the section object
 * (without persisting it to the LP). Use this when the caller wants
 * to splice the new section into a specific position in the list and
 * commit the whole reorder in one PUT.
 */
/**
 * Compress to a target square size and upload. Used by the icon
 * pipeline (favicon at 48px, apple-touch at 180px) so a single
 * source image yields both shipped variants in one go.
 */
export async function uploadImageAt(
  file: File,
  maxDimension: number
): Promise<{ url: string; width: number; height: number }> {
  if (!isImage(file)) {
    throw new Error('対応していない形式です(PNG / JPG / WebP)');
  }
  const compressed = await imageCompression(file, {
    maxWidthOrHeight: maxDimension,
    maxSizeMB: 2,
    fileType: 'image/webp',
    useWebWorker: true,
  });
  const dims = await readImageDimensions(compressed);

  const formData = new FormData();
  formData.append('file', compressed, withWebpExt(file.name));
  formData.append('width', String(dims.width));
  formData.append('height', String(dims.height));

  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'アップロード失敗'));
  }
  const json = (await res.json()) as {
    success: true;
    data: { url: string; width: number; height: number };
  };
  return json.data;
}

/**
 * One source image -> favicon + apple-touch-icon variants in one
 * call. Returns both resulting URLs so the caller can store them
 * in site_meta together.
 */
export async function uploadIconSet(file: File): Promise<{
  faviconUrl: string;
  appleTouchIconUrl: string;
}> {
  // Sequential rather than Promise.all so we don't hit the same
  // /api/upload endpoint twice in parallel and risk an R2 / D1
  // contention spike for what is essentially a one-off action.
  const apple = await uploadImageAt(file, 180);
  const favicon = await uploadImageAt(file, 48);
  return { faviconUrl: favicon.url, appleTouchIconUrl: apple.url };
}

/**
 * Compress + upload a single image and return only the resulting URL
 * (and dimensions). Use this when the caller doesn't want a full
 * Section object — e.g. picking an OGP image, an avatar, etc.
 */
export async function uploadImage(
  file: File
): Promise<{ url: string; width: number; height: number }> {
  if (!isImage(file)) {
    throw new Error('対応していない形式です(PNG / JPG / WebP)');
  }
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

  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'アップロード失敗'));
  }
  const json = (await res.json()) as {
    success: true;
    data: { url: string; width: number; height: number };
  };
  return json.data;
}

export async function uploadOneAsSection(file: File): Promise<UploadedSection> {
  if (!isImage(file)) {
    throw new Error('対応していない形式です(PNG / JPG / WebP)');
  }
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

  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'アップロード失敗'));
  }
  const json = (await res.json()) as {
    success: true;
    data: { url: string; width: number; height: number };
  };

  return {
    id: crypto.randomUUID(),
    type: 'image',
    image: {
      url: json.data.url,
      width: json.data.width,
      height: json.data.height,
      alt: '',
    },
    ctas: [],
  };
}

interface UploadFileResult {
  ok: boolean;
  fileName: string;
  error?: string;
}

/**
 * Take a list of File objects (from picker, drop, or unzipped),
 * filter to images, and add each as a new section sequentially.
 * Returns a per-file result list so the caller can show what
 * succeeded and what didn't.
 */
export async function processFiles(
  files: File[],
  lpId: string,
  onProgress?: ProgressCallback
): Promise<UploadFileResult[]> {
  const expanded = await expandZipsAndFilterImages(files);
  if (expanded.length === 0) {
    return [];
  }

  const results: UploadFileResult[] = [];
  for (let i = 0; i < expanded.length; i++) {
    const file = expanded[i];
    try {
      onProgress?.({
        current: i + 1,
        total: expanded.length,
        fileName: file.name,
        stage: 'compressing',
      });
      const compressed = await imageCompression(file, {
        maxWidthOrHeight: MAX_DIMENSION,
        maxSizeMB: 2,
        fileType: 'image/webp',
        useWebWorker: true,
      });
      const dims = await readImageDimensions(compressed);

      onProgress?.({
        current: i + 1,
        total: expanded.length,
        fileName: file.name,
        stage: 'uploading',
      });
      const uploaded = await uploadCompressed(compressed, file.name, dims);

      onProgress?.({
        current: i + 1,
        total: expanded.length,
        fileName: file.name,
        stage: 'saving',
      });
      await appendSectionToLp(lpId, {
        id: crypto.randomUUID(),
        type: 'image',
        image: {
          url: uploaded.url,
          width: uploaded.width,
          height: uploaded.height,
          alt: '',
        },
        ctas: [],
      });

      results.push({ ok: true, fileName: file.name });
    } catch (err) {
      results.push({
        ok: false,
        fileName: file.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

async function expandZipsAndFilterImages(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    if (isZip(file)) {
      const extracted = await extractImagesFromZip(file);
      out.push(...extracted);
    } else if (isImage(file)) {
      out.push(file);
    }
    // silently skip non-image, non-zip files
  }
  return out;
}

function isZip(file: File): boolean {
  return (
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed' ||
    /\.zip$/i.test(file.name)
  );
}

function isImage(file: File): boolean {
  if (ALLOWED_IMAGE_MIME.has(file.type)) return true;
  // Some sources don't set a MIME type (e.g. drag from certain apps).
  // Fall back to extension check.
  return IMAGE_EXTENSIONS.test(file.name);
}

async function extractImagesFromZip(zipFile: File): Promise<File[]> {
  // Dynamic import keeps JSZip out of the SSR bundle. The library is
  // only needed when an admin uploads a ZIP, so loading it on demand
  // avoids shipping its bundle weight on every public LP page.
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(zipFile);
  const entries: { name: string; file: File }[] = [];

  // iterate sync; JSZip's forEach handles directories too
  const promises: Promise<void>[] = [];
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    if (!IMAGE_EXTENSIONS.test(relativePath)) return;
    promises.push(
      entry.async('blob').then((blob) => {
        const name = relativePath.split('/').pop() ?? relativePath;
        const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'png').toLowerCase();
        const mime =
          ext === 'png'
            ? 'image/png'
            : ext === 'webp'
              ? 'image/webp'
              : 'image/jpeg';
        entries.push({
          name,
          file: new File([blob], name, { type: mime }),
        });
      })
    );
  });
  await Promise.all(promises);

  // Stable sort by file name so the LP keeps a deterministic order.
  entries.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return entries.map((e) => e.file);
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

async function uploadCompressed(
  file: Blob,
  originalName: string,
  dims: { width: number; height: number }
): Promise<{ url: string; width: number; height: number }> {
  const formData = new FormData();
  formData.append('file', file, withWebpExt(originalName));
  formData.append('width', String(dims.width));
  formData.append('height', String(dims.height));

  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'アップロード失敗'));
  }
  const json = (await res.json()) as {
    success: true;
    data: { url: string; width: number; height: number };
  };
  return json.data;
}

async function appendSectionToLp(
  lpId: string,
  newSection: UploadedSection
): Promise<void> {
  const getRes = await fetch(`/api/lps/${lpId}`);
  if (!getRes.ok) throw new Error(await readApiError(getRes, 'LP取得失敗'));
  const getJson = (await getRes.json()) as {
    success: true;
    data: { content: PageContent };
  };

  const updatedContent: PageContent = {
    ...getJson.data.content,
    sections: [...getJson.data.content.sections, newSection],
  };

  const putRes = await fetch(`/api/lps/${lpId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: updatedContent }),
  });
  if (!putRes.ok) throw new Error(await readApiError(putRes, 'LP更新失敗'));
}

type ApiError = { success: false; error: { code: string; message: string } };

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
