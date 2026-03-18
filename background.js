import avifEncode from './lib/avif/encode.js';

const FORMATS = [
  { id: 'fmt-jpeg', title: 'JPEG', mimeType: 'image/jpeg', ext: 'jpg' },
  { id: 'fmt-png',  title: 'PNG',  mimeType: 'image/png',  ext: 'png' },
  { id: 'fmt-webp', title: 'WebP', mimeType: 'image/webp', ext: 'webp' },
  { id: 'fmt-avif', title: 'AVIF', mimeType: 'image/avif', ext: 'avif' },
];

function getBrowserName() {
  const brands = navigator.userAgentData?.brands ?? [];
  const KNOWN = ['Microsoft Edge', 'Opera', 'Brave', 'Google Chrome', 'Chromium'];
  for (const known of KNOWN) {
    if (brands.some(b => b.brand === known)) {
      if (known === 'Microsoft Edge') return 'Edge';
      if (known === 'Google Chrome')  return 'Chrome';
      return known;
    }
  }
  return 'Browser';
}

function getTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
         `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function buildFilename(srcUrl, ext) {
  let base = 'image';
  try {
    const u = new URL(srcUrl);
    const parts = u.pathname.split('/');
    const last = parts[parts.length - 1];
    if (last) base = last.replace(/\.[^.]*$/, '') || 'image';
  } catch (_) {}
  return `${base}.${ext}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 200);
}

// Chrome 123+ で removeAll は Promise 専用 API になったため async/await を使用
async function setupContextMenus() {
  await chrome.contextMenus.removeAll();
  const httpPattern = ['http://*/*', 'https://*/*'];
  chrome.contextMenus.create({
    id: 'save-image-as', title: 'Save image as', contexts: ['image'],
    documentUrlPatterns: httpPattern,
  });
  for (const fmt of FORMATS) {
    chrome.contextMenus.create({
      id: fmt.id, parentId: 'save-image-as', title: fmt.title, contexts: ['image'],
      documentUrlPatterns: httpPattern,
    });
  }
}

chrome.runtime.onInstalled.addListener(setupContextMenus);
chrome.runtime.onStartup.addListener(setupContextMenus);

// ArrayBuffer → data URL（Service Worker 内で FileReader は使えないため手動変換）
function arrayBufferToDataUrl(buffer, mimeType) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

// Blob → data URL
async function blobToDataUrl(blob) {
  const buf = await blob.arrayBuffer();
  return arrayBufferToDataUrl(buf, blob.type);
}

const MAX_DIM = 4096;

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const fmt = FORMATS.find(f => f.id === info.menuItemId);
  if (!fmt || !info.srcUrl) return;
  if (!tab?.url?.match(/^https?:/)) return;

  const srcUrl = info.srcUrl;
  const filename = buildFilename(srcUrl, fmt.ext);

  // activeTab + scripting でページコンテキストから画像を取得（host_permissions 不要）
  let srcBlob;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: async (url) => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const type = resp.headers.get('content-type') || 'application/octet-stream';
        return { bytes: Array.from(new Uint8Array(buf)), type };
      },
      args: [srcUrl],
    });
    const result = results?.[0]?.result;
    if (!result) throw new Error('executeScript returned no result');
    srcBlob = new Blob([new Uint8Array(result.bytes)], { type: result.type });
  } catch (err) {
    console.warn('[save-image-as] fetch failed, downloading original:', err.message);
    chrome.downloads.download({ url: srcUrl });
    return;
  }

  // ImageBitmap にデコード
  let bitmap;
  try {
    bitmap = await createImageBitmap(srcBlob);
  } catch (err) {
    console.error('[save-image-as] createImageBitmap failed:', err.message);
    chrome.downloads.download({ url: srcUrl });
    return;
  }

  // 最大サイズでスケール制限
  let { width, height } = bitmap;
  if (width > MAX_DIM || height > MAX_DIM) {
    const scale = MAX_DIM / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  // OffscreenCanvas で描画（Service Worker で利用可能）
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');

  if (fmt.mimeType === 'image/jpeg') {
    // JPEG: 白背景で透明部分を塗りつぶす
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let dataUrl;

  if (fmt.mimeType === 'image/avif') {
    // AVIF: WASM エンコーダーで変換
    try {
      const imageData = ctx.getImageData(0, 0, width, height);
      const avifBuffer = await avifEncode(imageData);
      dataUrl = arrayBufferToDataUrl(avifBuffer, 'image/avif');
    } catch (err) {
      console.error('[save-image-as] AVIF encode failed:', err.message);
      chrome.downloads.download({ url: srcUrl });
      return;
    }
  } else {
    // JPEG / PNG / WebP: Canvas API で変換
    let outBlob;
    try {
      outBlob = await canvas.convertToBlob({ type: fmt.mimeType });
    } catch (err) {
      console.error('[save-image-as] convertToBlob failed:', err.message);
      chrome.downloads.download({ url: srcUrl });
      return;
    }

    try {
      dataUrl = await blobToDataUrl(outBlob);
    } catch (err) {
      console.error('[save-image-as] blobToDataUrl failed:', err.message);
      chrome.downloads.download({ url: srcUrl });
      return;
    }
  }

  try {
    await chrome.downloads.download({ url: dataUrl, filename });
    console.log(`[save-image-as] downloaded as ${filename}`);
  } catch (err) {
    console.error('[save-image-as] download failed:', err.message);
  }
});
