/**
 * Glossa reader: renders PDFs with PDF.js (canvas + selectable text layer) inside the extension,
 * so selection, the Explain button, ⌥E and "seen it before" underlines work on PDFs too.
 * Opens ?url=<pdf> (remote or file://) or a file the user picks/drops. Nothing is uploaded.
 */

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import '../ui/theme.css';
import './reader.css';
import { initContent } from '../content/main';
import { getSettings } from '../shared/storage';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const doc = $('r-doc');
const empty = $('r-empty');
const msg = $('r-msg');
const nameEl = $('r-name');
const pagesEl = $('r-pages');

let pdf: pdfjs.PDFDocumentProxy | null = null;
let scale = 1.35;
let observer: IntersectionObserver | null = null;

function show(text: string, action?: { label: string; run: () => void }): void {
  msg.hidden = false;
  msg.textContent = text;
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn btn-secondary btn-sm';
    b.textContent = action.label;
    b.addEventListener('click', action.run);
    msg.append(' ', b);
  }
  empty.hidden = false;
  doc.hidden = true;
}

function fileNameFrom(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return last || new URL(url).hostname;
  } catch {
    return 'Document';
  }
}

async function renderPage(holder: HTMLElement, n: number): Promise<void> {
  if (!pdf || holder.dataset.rendered === String(scale)) return;
  holder.dataset.rendered = String(scale);
  const page = await pdf.getPage(n);
  const viewport = page.getViewport({ scale });
  holder.replaceChildren();
  holder.style.width = `${viewport.width}px`;
  holder.style.height = `${viewport.height}px`;
  holder.style.setProperty('--scale-factor', String(viewport.scale));
  holder.style.setProperty('--user-unit', '1');
  holder.style.setProperty('--total-scale-factor', String(viewport.scale));

  const canvas = document.createElement('canvas');
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  holder.append(canvas);
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise;

  const text = document.createElement('div');
  text.className = 'textLayer';
  holder.append(text);
  await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport }).render();
  holder.dataset.done = '1';
}

async function layout(): Promise<void> {
  if (!pdf) return;
  observer?.disconnect();
  doc.replaceChildren();
  const first = await pdf.getPage(1);
  const v = first.getViewport({ scale });
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) void renderPage(e.target as HTMLElement, Number((e.target as HTMLElement).dataset.page));
    },
    { rootMargin: '1200px 0px' }
  );
  for (let n = 1; n <= pdf.numPages; n++) {
    const holder = document.createElement('div');
    holder.className = 'r-page';
    holder.dataset.page = String(n);
    holder.style.width = `${v.width}px`;
    holder.style.height = `${v.height}px`;
    doc.append(holder);
    observer.observe(holder);
  }
}

async function open(data: ArrayBuffer, name: string): Promise<void> {
  try {
    const asset = (dir: string) => chrome.runtime.getURL(`pdfjs/${dir}/`);
    pdf = await pdfjs.getDocument({ data, cMapUrl: asset('cmaps'), cMapPacked: true, standardFontDataUrl: asset('standard_fonts'), wasmUrl: asset('wasm') }).promise;
  } catch {
    show('That file couldn’t be opened as a PDF.');
    return;
  }
  document.title = `${name} · Glossa reader`;
  nameEl.textContent = name;
  pagesEl.textContent = `${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}`;
  empty.hidden = true;
  msg.hidden = true;
  doc.hidden = false;
  await layout();
}

async function openUrl(url: string): Promise<void> {
  const name = fileNameFrom(url);
  if (url.startsWith('file:') && !(await chrome.extension.isAllowedFileSchemeAccess())) {
    show('To open files from your computer by link, turn on “Allow access to file URLs” for Glossa in chrome://extensions. Or choose the file with the button above.');
    return;
  }
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    let origin = '';
    try {
      origin = new URL(url).origin;
    } catch {
      // not a URL
    }
    if (origin.startsWith('http')) {
      show(`Glossa needs your permission to load PDFs from ${new URL(url).hostname}.`, {
        label: 'Allow and open',
        run: async () => {
          if (await chrome.permissions.request({ origins: [`${origin}/*`] })) void openUrl(url);
        },
      });
    } else {
      show('That PDF couldn’t be loaded. Download it and open it with the button above.');
    }
    return;
  }
  await open(await res.arrayBuffer(), name);
}

function openFile(file: File | undefined): void {
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
    show('That isn’t a PDF.');
    return;
  }
  history.replaceState(null, '', location.pathname);
  void file.arrayBuffer().then((buf) => open(buf, file.name));
}

$<HTMLInputElement>('r-file').addEventListener('change', (e) => openFile((e.target as HTMLInputElement).files?.[0]));
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  openFile(e.dataTransfer?.files?.[0]);
});
const zoom = (f: number) => {
  scale = Math.min(3, Math.max(0.6, scale * f));
  void layout();
};
$('r-zoom-in').addEventListener('click', () => zoom(1.15));
$('r-zoom-out').addEventListener('click', () => zoom(1 / 1.15));

void getSettings().then((s) => {
  const theme = s.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : s.theme;
  document.documentElement.dataset.theme = theme;
});
if (!/Mac|iPhone|iPad/.test(navigator.platform)) $('r-key').textContent = 'Alt+E';

// Selection, Explain button, ⌥E and underlines behave exactly as on a web page.
initContent();

const target = new URLSearchParams(location.search).get('url');
if (target) void openUrl(target);
