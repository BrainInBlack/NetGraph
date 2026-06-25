import { sanitizeSvg, MAX_SVG_LENGTH } from '../svg-sanitizer';
import { generateId } from '../util';
import type { CustomIcon } from '../types';

// Shared by the icon picker (Custom tab) and the standalone Manage Icons
// modal so both upload flows enforce the same caps and produce identical
// stored icons.

export { MAX_SVG_LENGTH };
export const IMAGE_MAX_BYTES = 256 * 1024;   // Reject sources larger than this outright
export const IMAGE_MAX_DIMENSION = 128;       // Downscale to this max edge — 128px is plenty for a card/panel icon
const IMAGE_ENCODE_QUALITY = 0.9;             // JPEG/WebP-style quality when re-encoding

export async function readFileAsIcon(file: File): Promise<CustomIcon> {
  // Accept both MIME and extension fallbacks for every supported kind — some
  // browsers / OS combos strip MIME on drag-drop or send vendor-specific
  // types (e.g. "image/x-png"), so the extension check is the friendlier net.
  const lowerName = file.name.toLowerCase();
  const isSvg = file.type === 'image/svg+xml' || lowerName.endsWith('.svg');
  const isImage = file.type === 'image/png' || file.type === 'image/jpeg'
    || lowerName.endsWith('.png') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg');

  if (!isSvg && !isImage) {
    throw new Error('Unsupported file type. Use SVG, PNG, or JPG.');
  }

  if (!isSvg && file.size > IMAGE_MAX_BYTES) {
    throw new Error(`Image is too large (${Math.round(file.size / 1024)} KB). Maximum is ${IMAGE_MAX_BYTES / 1024} KB.`);
  }

  if (isSvg && file.size > MAX_SVG_LENGTH) {
    throw new Error(`SVG is too large (${Math.round(file.size / 1024)} KB). Maximum is ${MAX_SVG_LENGTH / 1024} KB.`);
  }

  // Strip the extension for the display name. Dotfiles ("foo.bar.svg" → "foo.bar"
  // is fine; ".hidden" → "" needs the fallback) collapse to an empty string
  // which the icon library doesn't render usefully — fall back to a generic.
  const name = file.name.replace(/\.[^.]+$/, '') || 'untitled';
  const id = generateId();
  const createdAt = new Date().toISOString();

  if (isSvg) {
    const text = await file.text();
    const cleaned = sanitizeSvg(text);
    if (!cleaned) throw new Error('Could not parse SVG file.');
    return { id, name, kind: 'svg', data: cleaned, createdAt };
  }

  // Re-encode raster images at icon resolution. This keeps stored size
  // bounded regardless of the source dimensions — a 4000×3000 PNG would
  // otherwise become a multi-megabyte data URL after base64 inflation and
  // chew through localStorage.
  const dataUrl = await downscaleImage(file);
  return { id, name, kind: 'image', data: dataUrl, createdAt };
}

async function downscaleImage(file: File): Promise<string> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(sourceUrl);
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = longest > IMAGE_MAX_DIMENSION ? IMAGE_MAX_DIMENSION / longest : 1;
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a 2D canvas context.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    // PNG keeps transparency; quality is ignored for PNG but we pass it for completeness.
    return canvas.toDataURL('image/png', IMAGE_ENCODE_QUALITY);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image.'));
    img.src = src;
  });
}
