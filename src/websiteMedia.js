const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MEDIA_DIR = path.join(__dirname, '..', 'data', 'website-media');
const MAX_IMAGES_PER_MESSAGE = 3;

function maxImageBytes() {
  return Math.max(256 * 1024, Number(process.env.WEBSITE_IMAGE_MAX_BYTES || 5 * 1024 * 1024));
}

function visitorHash(visitorId) {
  return crypto.createHash('sha256').update(String(visitorId || '')).digest('hex');
}

function detectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) return { mime: 'image/png', extension: 'png' };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) return { mime: 'image/webp', extension: 'webp' };
  return null;
}

function metadataPath(id) {
  return path.join(MEDIA_DIR, `${id}.json`);
}

function publicMediaUrl(id, token) {
  return `/webhooks/website-chat/media/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`;
}

function readMetadata(id) {
  const safeId = String(id || '');
  if (!/^[a-f0-9-]{36}$/i.test(safeId)) return null;
  const file = metadataPath(safeId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function safeTokenEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function saveWebsiteImage(buffer, visitorId) {
  const idOwner = String(visitorId || '').trim();
  if (!idOwner) throw new Error('visitor_id_required');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('image_required');
  if (buffer.length > maxImageBytes()) throw new Error('image_too_large');

  const image = detectImage(buffer);
  if (!image) throw new Error('unsupported_image_type');

  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString('base64url');
  const filename = `${id}.${image.extension}`;
  const metadata = {
    id,
    token,
    filename,
    mime: image.mime,
    bytes: buffer.length,
    visitorHash: visitorHash(idOwner),
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer, { flag: 'wx' });
  fs.writeFileSync(metadataPath(id), JSON.stringify(metadata), { flag: 'wx' });
  return {
    id,
    token,
    mime: image.mime,
    bytes: buffer.length,
    url: publicMediaUrl(id, token)
  };
}

function resolveWebsiteImage(id, token, visitorId = '') {
  const metadata = readMetadata(id);
  if (!metadata || !safeTokenEqual(metadata.token, token)) return null;
  if (visitorId && metadata.visitorHash !== visitorHash(visitorId)) return null;
  const filePath = path.join(MEDIA_DIR, metadata.filename);
  if (!fs.existsSync(filePath)) return null;
  return {
    ...metadata,
    filePath,
    url: publicMediaUrl(metadata.id, metadata.token)
  };
}

function resolveWebsiteAttachments(attachments = [], visitorId = '') {
  return (Array.isArray(attachments) ? attachments : [])
    .slice(0, MAX_IMAGES_PER_MESSAGE)
    .map(item => resolveWebsiteImage(item?.id, item?.token, visitorId))
    .filter(Boolean)
    .map(image => {
      const buffer = fs.readFileSync(image.filePath);
      return {
        id: image.id,
        token: image.token,
        mime: image.mime,
        bytes: image.bytes,
        url: image.url,
        visionInput: `data:${image.mime};base64,${buffer.toString('base64')}`
      };
    });
}

module.exports = {
  MEDIA_DIR,
  MAX_IMAGES_PER_MESSAGE,
  detectImage,
  maxImageBytes,
  publicMediaUrl,
  readMetadata,
  resolveWebsiteAttachments,
  resolveWebsiteImage,
  saveWebsiteImage
};
