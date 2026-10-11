import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { extractPhotoMetadata, photoMetadata, suppliedPhotoMetadata } from '../../cms/photo-metadata.mjs';

const exif = {
  IFD0: { Make: 'SONY', Model: 'ILCE-7M3' },
  IFD2: { DateTimeOriginal: '2026:02:23 23:58:30', OffsetTimeOriginal: '-06:00',
    ExposureTime: '1/200', FNumber: '28/10', ISOSpeedRatings: '400', FocalLength: '70/1', FocalLengthIn35mmFilm: '70',
    LensModel: '24-70mm F2.8', ExposureProgram: '1', WhiteBalance: '0', ExposureBiasValue: '-1/3' },
  IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 53/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '87/1 38/1 0/1' },
};
const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:City="Kyoto" photoshop:State="Kyoto Prefecture" photoshop:Country="Japan" /></rdf:RDF></x:xmpmeta>';
const image = () => sharp({ create: { width: 24, height: 16, channels: 3, background: '#887766' } });

test('JPEG, PNG and WebP retain camera settings, capture date and GPS before conversion', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const bytes = await image().withExif(exif)[format]().toBuffer();
    for (const decoded of [undefined, await sharp(bytes).metadata()]) {
      const metadata = await extractPhotoMetadata(bytes, decoded);
      assert.equal(metadata.camera, 'ILCE-7M3', format);
      assert.equal(metadata.camera_make, 'SONY'); assert.equal(metadata.lens, '24-70mm F2.8');
      assert.equal(metadata.iso, 400); assert.equal(metadata.shutter_speed, '1/200 s');
      assert.equal(metadata.aperture, 'f/2.8'); assert.equal(metadata.focal_length, '70 mm');
      assert.equal(metadata.focal_length_35mm, 70);
      assert.deepEqual(suppliedPhotoMetadata(JSON.stringify(metadata)), metadata, `${format} metadata must survive browser-to-server transport`);
      assert.equal(metadata.exposure_program, 'Manual'); assert.equal(metadata.white_balance, 'Auto');
      assert.ok(Math.abs(metadata.exposure_compensation + 1 / 3) < 0.00001);
      assert.equal(metadata.date, '2026-02-23'); assert.equal(metadata.captured_at, '2026-02-23T23:58:30');
      assert.equal(metadata.time_zone, '-06:00'); assert.equal(metadata.location, '41.883333, -87.633333');
      assert.ok(metadata.latitude > 41 && metadata.longitude < -87);
    }
  }
});

test('embedded place names take precedence over GPS coordinates across supported image formats', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const bytes = await image().withExif(exif).withXmp(xmp)[format]().toBuffer();
    const metadata = await extractPhotoMetadata(bytes);
    assert.equal(metadata.location, 'Kyoto, Kyoto Prefecture, Japan', format);
    assert.ok(metadata.latitude); assert.ok(metadata.longitude);
  }
});

test('IPTC place names and capture dates are extracted from JPEG uploads', async () => {
  const datasets = [[90, 'Chicago'], [95, 'Illinois'], [101, 'USA'], [55, '20260223']].map(([key, value]) => {
    const bytes = Buffer.from(value), header = Buffer.from([0x1c, 2, key, 0, bytes.length]);
    return Buffer.concat([header, bytes]);
  });
  const data = Buffer.concat(datasets), size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const payload = Buffer.concat([Buffer.from('Photoshop 3.0\0'), Buffer.from('8BIM'), Buffer.from([4, 4, 0, 0]), size, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  const header = Buffer.from([0xff, 0xed, 0, 0]); header.writeUInt16BE(payload.length + 2, 2);
  const jpeg = await image().jpeg().toBuffer();
  const metadata = await extractPhotoMetadata(Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]));
  assert.equal(metadata.location, 'Chicago, Illinois, USA'); assert.equal(metadata.date, '2026-02-23');
});

test('missing or malformed metadata does not invent dates, locations, or settings', async () => {
  const bytes = await image().png().toBuffer();
  assert.deepEqual(await extractPhotoMetadata(bytes), {});
  assert.deepEqual(await extractPhotoMetadata(bytes, { exif: Buffer.from('broken EXIF') }), {});
  assert.deepEqual(photoMetadata({ DateTimeOriginal: '2026:02:30 12:00:00', latitude: 91, longitude: 0, ExposureTime: NaN }), {});
  assert.equal(photoMetadata({ latitude: 0, longitude: 0 }).location, '0.000000, 0.000000');
  assert.equal(photoMetadata({ DateTimeOriginal: 'bad date', CreateDate: '2024:02:29 00:00:01' }).date, '2024-02-29');
  assert.equal(photoMetadata({}, { exif: { GPSLatitude: '41,53N', GPSLongitude: '87,38W' } }).location, '41.883333, -87.633333');
});

test('browser-preserved metadata is bounded and accepts only flat descriptive values', () => {
  assert.deepEqual(suppliedPhotoMetadata('{"camera":"Sony","iso":400}'), { camera: 'Sony', iso: 400 });
  for (const invalid of ['null', '[]', '{"camera":{"nested":"value"}}', '{"camera":true}', '{"camera-model":"Sony"}', '{"camera":"' + 'a'.repeat(241) + '"}', 'bad JSON', '{"__proto__":{"bad":1}}']) assert.throws(() => suppliedPhotoMetadata(invalid));
});
