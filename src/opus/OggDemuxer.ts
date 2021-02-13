import { Transform, TransformCallback, TransformOptions } from 'stream';

const OGG_PAGE_HEADER_SIZE = 26;
const STREAM_STRUCTURE_VERSION = 0;

const OGGS_HEADER = Buffer.from('OggS');
const OPUS_HEAD = Buffer.from('OpusHead');
const OPUS_TAGS = Buffer.from('OpusTag');

/**
 * Demuxes an Ogg stream (containing Opus audio) to output an Opus stream.
 */
export class OggDemuxer extends Transform {
  private _remainder?: Buffer;
  private _head?: Buffer;
  private _bitstream?: number;
  /**
   * Creates a new OggOpus demuxer.
   * @param [options] options that you would pass to a regular Transform stream.
   */
  public constructor(options: TransformOptions = {}) {
    super({ readableObjectMode: true, ...options });
  }

  public _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
    if (this._remainder) {
      chunk = Buffer.concat([this._remainder, chunk]);
      this._remainder = undefined;
    }

    while (chunk) {
      const result = this._readPage(chunk);
      if (!result) {
        break;
      }
      chunk = result;
    }
    this._remainder = chunk;
    done();
  }

  /**
   * Reads a page from a buffer
   * @param chunk the chunk containing the page
   * @returns if a buffer, it will be a slice of the excess data of the original, otherwise it will be
   * false and would indicate that there is not enough data to go ahead with reading this page.
   */
  private _readPage(chunk: Buffer): Buffer | false {
    if (chunk.length < OGG_PAGE_HEADER_SIZE) {
      return false;
    }
    if (!chunk.slice(0, 4).equals(OGGS_HEADER)) {
      throw Error(`capture_pattern is not ${OGGS_HEADER}.`);
    }
    if (chunk.readUInt8(4) !== STREAM_STRUCTURE_VERSION) {
      throw Error(`stream_structure_version is not ${STREAM_STRUCTURE_VERSION}.`);
    }

    if (chunk.length < 27) {
      return false;
    }
    const pageSegments = chunk.readUInt8(26);
    if (chunk.length < 27 + pageSegments) {
      return false;
    }
    const table = chunk.slice(27, 27 + pageSegments);
    const bitstream = chunk.readUInt32BE(14);

    const sizes = [];
    let totalSize = 0;

    for (let i = 0; i < pageSegments; ) {
      let size = 0;
      let x = 255;
      while (x === 255) {
        if (i >= table.length) {
          return false;
        }
        size += x = table.readUInt8(i);
        i++;
      }
      sizes.push(size);
      totalSize += size;
    }

    if (chunk.length < 27 + pageSegments + totalSize) {
      return false;
    }

    let start = 27 + pageSegments;
    for (const size of sizes) {
      const segment = chunk.slice(start, start + size);
      const header = segment.slice(0, 8);
      if (this._head) {
        if (header.equals(OPUS_TAGS)) {
          this.emit('tags', segment);
        } else if (this._bitstream === bitstream) {
          this.push(segment);
        }
      } else if (header.equals(OPUS_HEAD)) {
        this.emit('head', segment);
        this._head = segment;
        this._bitstream = bitstream;
      } else {
        this.emit('unknownSegment', segment);
      }
      start += size;
    }
    return chunk.slice(start);
  }

  public _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.cleanup();
    callback(error);
  }

  public _final(callback: () => void): void {
    this.cleanup();
    callback();
  }

  /**
   * Cleans up the demuxer when it is no longer required.
   */
  private cleanup() {
    this._remainder = undefined;
    this._head = undefined;
    this._bitstream = undefined;
  }
}
