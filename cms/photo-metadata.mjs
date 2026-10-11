import exifr from 'exifr';

const text = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 240) : '';
const number = value => {
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?\/-?\d+(?:\.\d+)?$/.test(value)) {
    const [numerator, denominator] = value.split('/').map(Number); value = numerator / denominator;
  } else if (typeof value === 'string' && value.trim()) value = Number(value);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};
const rounded = value => Number(value.toFixed(3));
function coordinate(value, reference) {
  const decimal = number(value);
  if (decimal !== undefined) return /^[SW]$/i.test(reference || '') ? -Math.abs(decimal) : decimal;
  const parts = text(value).match(/^(-?\d+(?:\.\d+)?)(?:[,\s]+(\d+(?:\.\d+)?))?(?:[,\s]+(\d+(?:\.\d+)?))?\s*([NSEW])?$/i);
  if (!parts || Number(parts[2] || 0) >= 60 || Number(parts[3] || 0) >= 60) return;
  const result = Math.abs(Number(parts[1])) + Number(parts[2] || 0) / 60 + Number(parts[3] || 0) / 3600;
  return Number(parts[1]) < 0 || /^[SW]$/i.test(parts[4] || reference || '') ? -result : result;
}
const signature = bytes => String.fromCharCode(...bytes);
const parseExif = bytes => exifr.parse(signature(bytes.subarray(0, 6)) === 'Exif\0\0' ? bytes.subarray(6) : bytes, { reviveValues: false }).catch(() => undefined);
async function compressedXmp(bytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 256 * 1024) { await reader.cancel(); return; }
      chunks.push(value);
    }
    const output = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return await exifr.sidecar(output, { reviveValues: false }, 'xmp');
  } catch { return; }
  finally { reader.releaseLock(); }
}

// Read before image conversion strips EXIF. A damaged metadata block must not reject a valid photo.
export async function extractPhotoMetadata(bytes, image = {}) {
  let tags = {}, extra = {};
  if (image.exif) {
    tags = await parseExif(image.exif) || {};
  }
  extra = await exifr.parse(bytes, { tiff: !image.exif, xmp: true, iptc: true, reviveValues: false }).catch(() => undefined) || {};
  // WebP's EXIF/XMP blocks are exposed by Sharp even when the container parser cannot read them.
  if (image.xmp) Object.assign(extra, await exifr.sidecar(image.xmp, { reviveValues: false }, 'xmp').catch(() => undefined));
  if (!image.xmp && bytes.length >= 8 && signature(bytes.subarray(0, 8)) === '\x89PNG\r\n\x1a\n') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset), end = offset + 8 + length;
      if (end + 4 > bytes.length) break;
      const kind = signature(bytes.subarray(offset + 4, offset + 8));
      if (kind === 'iTXt' || kind === 'zTXt') {
        const block = bytes.subarray(offset + 8, end), keywordEnd = block.indexOf(0);
        if (keywordEnd === 17 && signature(block.subarray(0, keywordEnd)) === 'XML:com.adobe.xmp') {
          if (kind === 'zTXt' && block[keywordEnd + 1] === 0) Object.assign(extra, await compressedXmp(block.subarray(keywordEnd + 2)));
          if (kind === 'iTXt' && block[keywordEnd + 2] === 0) {
            const languageEnd = block.indexOf(0, keywordEnd + 3), translatedEnd = block.indexOf(0, languageEnd + 1);
            if (languageEnd >= 0 && translatedEnd >= 0) {
              const xmp = block.subarray(translatedEnd + 1);
              Object.assign(extra, block[keywordEnd + 1] === 1 ? await compressedXmp(xmp) : await exifr.sidecar(xmp, { reviveValues: false }, 'xmp').catch(() => undefined));
            }
          }
        }
      }
      offset = end + 4;
    }
  }
  if (!image.exif && bytes.length >= 12 && signature(bytes.subarray(0, 4)) === 'RIFF' && signature(bytes.subarray(8, 12)) === 'WEBP') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = signature(bytes.subarray(offset, offset + 4));
      const length = view.getUint32(offset + 4, true), end = offset + 8 + length;
      if (end > bytes.length) break;
      const block = bytes.subarray(offset + 8, end);
      if (kind === 'EXIF') tags = await parseExif(block) || {};
      if (kind === 'XMP ') Object.assign(extra, await exifr.sidecar(block, { reviveValues: false }, 'xmp').catch(() => undefined));
      offset = end + length % 2;
    }
  }
  return photoMetadata(tags, extra);
}

export function suppliedPhotoMetadata(value) {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'string' || value.length > 16384) throw new Error('Invalid photo metadata');
  const metadata = JSON.parse(value);
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object' || Object.keys(metadata).length > 100 ||
    Object.entries(metadata).some(([key, item]) => !/^[a-z0-9_]{1,80}$/.test(key) ||
      !(typeof item === 'string' && item.length <= 240 || typeof item === 'number' && Number.isFinite(item)))) throw new Error('Invalid photo metadata');
  return metadata;
}

export function photoMetadata(tags = {}, extra = {}) {
  const places = extra.Iptc4xmpExt || {};
  const sources = [tags, extra, extra.exif, extra.tiff, extra.exifEX, extra.photoshop, extra.Iptc4xmpCore, extra.iptc,
    ...[places.LocationCreated, places.LocationShown].map(value => Array.isArray(value) ? value[0] : value)].filter(Boolean);
  const get = (...keys) => {
    for (const key of keys) for (const source of sources) {
      const value = source[key];
      if (value !== undefined && value !== null && value !== '') return Array.isArray(value) ? value[0] : value;
    }
  };
  const metadata = {};
  for (const [key, names] of Object.entries({
    camera: ['Model'], camera_make: ['Make'], lens: ['LensModel', 'Lens'], lens_make: ['LensMake'],
    exposure_program: ['ExposureProgram'], exposure_mode: ['ExposureMode'], metering_mode: ['MeteringMode'],
    flash: ['Flash'], white_balance: ['WhiteBalance'], light_source: ['LightSource'],
    scene_capture_type: ['SceneCaptureType'], sensing_method: ['SensingMethod'], color_space: ['ColorSpace'],
    contrast: ['Contrast'], saturation: ['Saturation'], sharpness: ['Sharpness'], gain_control: ['GainControl'],
    subject_distance_range: ['SubjectDistanceRange'], time_zone: ['OffsetTimeOriginal', 'OffsetTimeDigitized'],
  })) {
    const value = get(...names);
    if (text(value)) metadata[key] = text(value);
    else if (number(value) !== undefined) metadata[key] = number(value);
  }
  for (const [key, names] of Object.entries({
    iso: ['ISO', 'ISOSpeedRatings', 'PhotographicSensitivity', 'ISOSpeed'],
    exposure_compensation: ['ExposureCompensation', 'ExposureBiasValue'],
    focal_length_35mm: ['FocalLengthIn35mmFormat', 'FocalLengthIn35mmFilm'],
    digital_zoom: ['DigitalZoomRatio'], subject_distance: ['SubjectDistance'],
    brightness: ['BrightnessValue'], max_aperture: ['MaxApertureValue'],
    exposure_index: ['ExposureIndex'], recommended_exposure_index: ['RecommendedExposureIndex'],
  })) {
    const value = number(get(...names)); if (value !== undefined) metadata[key] = value;
  }
  const exposure = number(get('ExposureTime')) ?? (number(get('ShutterSpeedValue')) === undefined ? undefined : 2 ** -number(get('ShutterSpeedValue')));
  if (exposure > 0) metadata.shutter_speed = exposure <= 0.5 ? `1/${rounded(1 / exposure)} s` : `${rounded(exposure)} s`;
  const aperture = number(get('FNumber')) ?? (number(get('ApertureValue')) === undefined ? undefined : 2 ** (number(get('ApertureValue')) / 2));
  if (aperture > 0) metadata.aperture = `f/${rounded(aperture)}`;
  const focalLength = number(get('FocalLength'));
  if (focalLength > 0) metadata.focal_length = `${rounded(focalLength)} mm`;

  for (const key of ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'DateCreated']) {
    const value = text(get(key));
    const match = /^(\d{4})[:-]?(\d{2})[:-]?(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(value);
    if (!match) continue;
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) continue;
    metadata.date = date;
    if (match[4] && Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6]) < 60) metadata.captured_at = `${date}T${match[4]}:${match[5]}:${match[6]}`;
    break;
  }
  const place = [...new Set([
    text(get('SubLocation', 'Sublocation', 'Location')), text(get('City')),
    text(get('ProvinceState', 'State', 'Province-State')), text(get('CountryName', 'Country', 'Country-PrimaryLocationName', 'CountryCode')),
  ].filter(Boolean))].join(', ');
  if (place) metadata.location = place.slice(0, 200);
  const latitude = coordinate(get('latitude', 'GPSLatitude'), get('GPSLatitudeRef'));
  const longitude = coordinate(get('longitude', 'GPSLongitude'), get('GPSLongitudeRef'));
  if (latitude !== undefined && longitude !== undefined && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
    metadata.latitude = latitude; metadata.longitude = longitude;
    if (!metadata.location) metadata.location = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  }
  const altitude = number(get('GPSAltitude'));
  if (altitude !== undefined) metadata.gps_altitude = get('GPSAltitudeRef') === 1 || get('GPSAltitudeRef') === 'Below sea level' ? -altitude : altitude;
  return metadata;
}
