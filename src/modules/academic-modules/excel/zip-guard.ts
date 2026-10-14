import { IMPORT_LIMITS } from './import-issue';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const MAX_ZIP_COMMENT = 0xffff;
const ZIP64_MARKER = 0xffffffff;

export function hasZipSignature(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === LOCAL_FILE_HEADER;
}

/**
 * Reads the ZIP central directory (an .xlsx is a ZIP archive) and rejects
 * archives whose declared uncompressed size or entry count is abnormal, so a
 * small upload cannot expand into a huge amount of memory ("zip bomb").
 * Returns a reason when the archive must be rejected, or null when it is fine.
 */
export function inspectZipArchive(buffer: Buffer): string | null {
  if (!hasZipSignature(buffer) || buffer.length < EOCD_MIN_SIZE) {
    return 'not-zip';
  }

  const searchStart = Math.max(
    0,
    buffer.length - EOCD_MIN_SIZE - MAX_ZIP_COMMENT,
  );
  let eocd = -1;
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= searchStart; i -= 1) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return 'not-zip';

  const entries = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (directoryOffset === ZIP64_MARKER || entries === 0xffff) return 'zip64';
  if (entries === 0 || entries > IMPORT_LIMITS.maxZipEntries) {
    return 'entries';
  }
  if (directoryOffset + directorySize > eocd) return 'not-zip';

  let offset = directoryOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < entries; i += 1) {
    if (
      offset + 46 > eocd ||
      buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER
    ) {
      return 'not-zip';
    }
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    if (uncompressedSize === ZIP64_MARKER) return 'zip64';
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > IMPORT_LIMITS.maxUncompressedBytes) return 'size';

    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}
