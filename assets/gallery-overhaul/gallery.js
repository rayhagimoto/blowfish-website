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
let selected = photos;
let shown = 0;
let grid;
let lightbox;
let opener;
const observed = new WeakSet();
const visible = new Set();
const pendingReveals = new Set();
let revealFrame;
const preloadObserver = new IntersectionObserver(entries => {
  // Start visible previews first; the small margin warms only the next row or two.
  entries.filter(entry => entry.isIntersecting)
    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
    .forEach(entry => loadPreview(entry.target));
}, { rootMargin: constrained ? '0px' : '200px 0px 400px' });
const revealObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      visible.add(entry.target);
      revealCard(entry.target);
    } else visible.delete(entry.target);
  }
});

function revealCard(card) {
  if (!visible.has(card) || !card.matches('.is-loaded, .image-error')) return;
  pendingReveals.add(card);
  if (revealFrame) return;
  // Group only previews ready in this frame; never wait for another download.
  revealFrame = requestAnimationFrame(() => {
    revealFrame = null;
    const cards = [...pendingReveals]
      .filter(card => card.isConnected && visible.has(card))
      .map(card => ({ card, bounds: card.getBoundingClientRect() }))
      .sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);
    pendingReveals.clear();
    cards.forEach(({ card }, index) => {
      card.style.setProperty('--reveal-delay', `${reducedMotion ? 0 : Math.min(index * 50, 100)}ms`);
      card.classList.add('is-revealed');
      revealObserver.unobserve(card);
      visible.delete(card);
    });
  });
}

function loadPreview(card) {
  preloadObserver.unobserve(card);
  const image = card.querySelector('img');
  if (image.hasAttribute('src')) return;
  const loaded = async () => {
    try {
      await image.decode();
    } catch {
      // A resize can replace the candidate while decoding; its load event will retry.
      return;
    }
    if (!card.isConnected) return;
    image.removeEventListener('load', loaded);
    image.removeEventListener('error', failed);
    card.classList.add('is-loaded');
    revealCard(card);
  };
  const failed = () => {
    if (!card.isConnected) return;
    image.removeEventListener('load', loaded);
    card.classList.add('image-error');
    card.querySelector('a').title = 'Preview unavailable. Open to try the full photograph.';
    revealCard(card);
  };
  image.addEventListener('load', loaded);
  image.addEventListener('error', failed, { once: true });
  const bounds = card.getBoundingClientRect();
  image.fetchPriority = bounds.top < innerHeight && bounds.bottom > 0 ? 'high' : 'low';
  // Set the measured slot before srcset so the browser fetches one suitable size.
  image.sizes = `${Math.ceil(bounds.width)}px`;
  if (!constrained) image.srcset = image.dataset.srcset;
  image.src = image.dataset.src;
}

function observeImage(card) {
  if (observed.has(card)) return;
  observed.add(card);
  preloadObserver.observe(card);
  revealObserver.observe(card);
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
  const image = new Image();
  image.alt = photo.alt;
  image.width = photo.width;
  image.height = photo.height;
  image.decoding = 'async';
  image.setAttribute('data-grid-skip', 'true');
  image.dataset.src = photo.thumbnail;
  image.dataset.srcset = photo.srcset;
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
  // Observe only after masonry has positioned the cards, never in their temporary layout.
  grid.on('renderComplete', () => {
    for (const card of container.querySelectorAll('.gallery-card')) {
      const image = card.querySelector('img');
      if (image.hasAttribute('src')) image.sizes = `${Math.ceil(card.getBoundingClientRect().width)}px`;
      observeImage(card);
    }
  });
  grid.renderItems();
}

function makeLightbox() {
  lightbox?.destroy();
  const slides = selected.map(photo => ({
    ...photo,
    // Responsive previews belong to the gallery; lightbox images use the original.
    srcset: '',
    msrc: photo.thumbnail,
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
  lightbox.on('destroy', () => opener?.focus({ preventScroll: true }));
  lightbox.init();
}

container.addEventListener('click', event => {
  const link = event.target.closest('.gallery-link');
  if (!link || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const index = selected.findIndex(photo => photo.id === link.closest('figure').dataset.photoId);
  opener = link;
  lightbox.loadAndOpen(index);
});

container.addEventListener('focusin', event => {
  const card = event.target.closest('.gallery-card');
  if (card) loadPreview(card);
});

filters.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.getAttribute('aria-pressed') === 'true') return;
  for (const filter of filters.querySelectorAll('button')) {
    filter.setAttribute('aria-pressed', String(filter === button));
  }
  selected = button.dataset.album
    ? photos.filter(photo => photo.albums.includes(button.dataset.album)) : photos;
  preloadObserver.disconnect();
  revealObserver.disconnect();
  visible.clear();
  pendingReveals.clear();
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

container.classList.add('is-enhanced');
container.replaceChildren(...selected.slice(0, batchSize).map(createCard));
shown = container.children.length;
makeLightbox();
makeGrid();
filters.hidden = false;
updateProgress();
