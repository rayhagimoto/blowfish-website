import { MasonryInfiniteGrid } from '@egjs/infinitegrid';
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import PhotoSwipeDynamicCaption from 'photoswipe-dynamic-caption-plugin';
import 'photoswipe/style.css';
import 'photoswipe-dynamic-caption-plugin/photoswipe-dynamic-caption-plugin.css';
import './gallery.css';

const photos = JSON.parse(document.getElementById('gallery-data').textContent);
const container = document.getElementById('photo-grid');
const filters = document.querySelector('.album-filters');
const count = document.getElementById('photo-count');
const more = document.getElementById('load-more');
const connection = navigator.connection;
const constrained = connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const batchSize = 12;
const sizes = container.dataset.imageSizes;
let selected = photos;
let shown = container.children.length;
let grid;
let lightbox;
let opener;
const prefetched = new Set();
const downloadMenu = document.createElement('a');
downloadMenu.className = 'photography-download-menu';
downloadMenu.textContent = 'Download full-resolution JPG';
downloadMenu.hidden = true;
document.body.append(downloadMenu);
let downloadOpener;

function hideDownloadMenu() {
  if (downloadMenu.hidden) return;
  const wasFocused = document.activeElement === downloadMenu;
  downloadMenu.hidden = true;
  if (wasFocused) downloadOpener?.focus({ preventScroll: true });
}

document.addEventListener('contextmenu', event => {
  const card = event.target.closest('.gallery-card');
  const inLightbox = event.target.closest('.photography-lightbox .pswp__img');
  const photo = card ? selected.find(photo => photo.id === card.dataset.photoId)
    : inLightbox ? lightbox.pswp?.currSlide?.data : null;
  hideDownloadMenu();
  if (!photo) return;
  event.preventDefault();
  downloadOpener = card?.querySelector('a') || lightbox.pswp.element;
  (inLightbox ? lightbox.pswp.element : document.body).append(downloadMenu);
  downloadMenu.href = photo.original;
  downloadMenu.download = `${photo.id}.jpg`;
  downloadMenu.hidden = false;
  downloadMenu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - downloadMenu.offsetWidth - 8))}px`;
  downloadMenu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - downloadMenu.offsetHeight - 8))}px`;
  downloadMenu.focus({ preventScroll: true });
});
downloadMenu.addEventListener('click', hideDownloadMenu);
document.addEventListener('pointerdown', event => {
  if (!downloadMenu.contains(event.target)) hideDownloadMenu();
}, true);
document.addEventListener('keydown', event => {
  if (downloadMenu.hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    hideDownloadMenu();
  } else if (event.key !== 'Enter') hideDownloadMenu();
}, true);
document.addEventListener('scroll', hideDownloadMenu, true);
window.addEventListener('resize', hideDownloadMenu);

function srcset(photo, maxWidth = Infinity) {
  return photo.variants.filter(image => image.width <= maxWidth)
    .map(image => `${image.src} ${image.width}w`).join(', ');
}

function observeImage(card) {
  const image = card.querySelector('img');
  const loaded = () => card.classList.add('is-loaded');
  if (image.complete && image.naturalWidth) loaded();
  else image.addEventListener('load', loaded, { once: true });
  image.addEventListener('error', () => {
    card.classList.add('image-error');
    card.querySelector('a').title = 'Preview unavailable. Open to try the full photograph.';
  }, { once: true });
}

function createCard(photo) {
  const card = document.createElement('figure');
  card.className = 'gallery-card';
  card.dataset.photoId = photo.id;
  const link = document.createElement('a');
  link.className = 'gallery-link';
  link.href = photo.original;
  link.setAttribute('aria-label', `Open ${photo.alt}`);
  link.style.aspectRatio = `${photo.width} / ${photo.height}`;
  link.style.backgroundImage = `url("${photo.preview}")`;
  const image = new Image();
  image.alt = photo.alt;
  image.width = photo.width;
  image.height = photo.height;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.sizes = sizes;
  image.srcset = srcset(photo, 960);
  image.src = photo.thumb;
  link.append(image);
  if (photo.title || photo.location) {
    const label = document.createElement('span');
    label.className = 'card-label';
    label.setAttribute('aria-hidden', 'true');
    for (const [tag, text] of [['strong', photo.title], ['span', photo.location]]) {
      if (!text) continue;
      const line = document.createElement(tag);
      line.textContent = text;
      label.append(line);
    }
    link.append(label);
  }
  card.append(link);
  if (photo.caption) {
    const caption = document.createElement('figcaption');
    caption.className = 'sr-only';
    // Caption markup is rendered and escaped by Hugo, never built from raw metadata here.
    caption.innerHTML = photo.caption;
    card.append(caption);
  }
  observeImage(card);
  return card;
}

function updateProgress() {
  count.textContent = selected.length;
  more.hidden = shown >= selected.length;
}

function appendBatch() {
  if (shown >= selected.length) return;
  const batch = selected.slice(shown, shown + batchSize).map(createCard);
  const group = shown / batchSize;
  shown += batch.length;
  grid.append(batch, group);
  updateProgress();
}

function makeGrid() {
  grid = new MasonryInfiniteGrid(container, {
    gap: 16,
    align: 'start',
    threshold: constrained ? 100 : 700,
    useRecycle: false,
    useResizeObserver: true,
    observeChildren: false,
    isReachStart: true,
  });
  grid.on('requestAppend', event => {
    if (shown >= selected.length) event.reachEnd();
    else appendBatch();
  });
  grid.renderItems();
}

function makeLightbox() {
  lightbox?.destroy();
  const slides = selected.map(photo => ({
    ...photo,
    srcset: srcset(photo),
    msrc: photo.preview,
  }));
  lightbox = new PhotoSwipeLightbox({
    dataSource: slides,
    pswpModule: () => import('photoswipe'),
    preload: constrained ? [0, 1] : [2, 2],
    bgOpacity: 1,
    mainClass: 'photography-lightbox',
    showHideAnimationType: reducedMotion ? 'none' : 'zoom',
    paddingFn: viewport => ({ top: 64, bottom: 28, left: viewport.x < 600 ? 12 : 60, right: viewport.x < 600 ? 12 : 60 }),
    closeTitle: 'Close photograph (Escape)',
    zoomTitle: 'Zoom photograph',
    arrowPrevTitle: 'Previous photograph',
    arrowNextTitle: 'Next photograph',
    errorMsg: 'This photograph could not be loaded. Close and reopen it to try again.',
  });
  lightbox.addFilter('thumbEl', (_, data) =>
    container.querySelector(`[data-photo-id="${data.id}"] img`));
  lightbox.addFilter('placeholderSrc', (placeholder, slide) =>
    container.querySelector(`[data-photo-id="${slide.data.id}"] img`)?.currentSrc || placeholder);
  new PhotoSwipeDynamicCaption(lightbox, {
    type: 'auto',
    captionContent: slide => slide.data.caption || '',
    mobileCaptionOverlapRatio: 1,
  });
  lightbox.on('change', hideDownloadMenu);
  lightbox.on('close', hideDownloadMenu);
  lightbox.on('destroy', () => {
    hideDownloadMenu();
    document.body.append(downloadMenu);
    opener?.focus({ preventScroll: true });
  });
  lightbox.init();
}

// Warm only nearby thumbnails, once each. PhotoSwipe handles larger slide preloads.
function prefetchNeighbors(index) {
  if (constrained) return;
  for (const neighbor of [selected[index - 1], selected[index + 1]]) {
    if (!neighbor || prefetched.has(neighbor.thumb)) continue;
    prefetched.add(neighbor.thumb);
    const hint = document.createElement('link');
    hint.rel = 'prefetch';
    hint.as = 'image';
    hint.href = neighbor.thumb;
    document.head.append(hint);
  }
}

container.addEventListener('click', event => {
  const link = event.target.closest('.gallery-link');
  if (!link || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const index = selected.findIndex(photo => photo.id === link.closest('figure').dataset.photoId);
  opener = link;
  lightbox.loadAndOpen(index);
});

for (const eventName of ['pointerover', 'focusin']) {
  container.addEventListener(eventName, event => {
    const card = event.target.closest('.gallery-card');
    if (card) prefetchNeighbors(selected.findIndex(photo => photo.id === card.dataset.photoId));
  });
}

filters.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.getAttribute('aria-pressed') === 'true') return;
  for (const filter of filters.querySelectorAll('button')) {
    filter.setAttribute('aria-pressed', String(filter === button));
  }
  selected = button.dataset.album
    ? photos.filter(photo => photo.albums.includes(button.dataset.album)) : photos;
  grid.destroy();
  container.replaceChildren(...selected.slice(0, batchSize).map(createCard));
  shown = container.children.length;
  makeLightbox();
  makeGrid();
  updateProgress();
});

more.addEventListener('click', () => {
  const nextId = selected[shown]?.id;
  appendBatch();
  requestAnimationFrame(() => container.querySelector(`[data-photo-id="${nextId}"] a`)?.focus({ preventScroll: true }));
});

container.querySelectorAll('.gallery-card').forEach(observeImage);
makeLightbox();
makeGrid();
filters.hidden = false;
updateProgress();
