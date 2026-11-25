/** Shared passive-raster policy for preview media and deterministic inlining. */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024
export const MAX_DETERMINISTIC_MEDIA_BYTES = 8 * 1024 * 1024
export const MAX_DETERMINISTIC_FILE_BYTES = 2 * 1024 * 1024
export const RASTER_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** Sniff one passive raster signature. */
export function sniffRaster(buffer: Buffer): string | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString('ascii')
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif'
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp'
  return undefined
}

/** Build a data URI only after signature validation. */
export function rasterDataUri(buffer: Buffer): string | undefined {
  const type = sniffRaster(buffer)
  return type === undefined ? undefined : 'data:' + type + ';base64,' + buffer.toString('base64')
}
