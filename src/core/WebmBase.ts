import { Transform, TransformCallback, TransformOptions } from 'stream';

interface Tag {
  offset: number;
  _skipUntil?: number;
}

interface Track {
  number: number;
  type: number;
}

/**
 * Base class for `WebmOpusDemuxer` and `WebmVorbisDemuxer`.
 * **You shouldn't directly instantiate this class, use the `opus.WebmDemuxer` and `vorbis.WebmDemuxer`
 * implementations instead!**
 */
export class WebmBaseDemuxer extends Transform {
  /**
   * A symbol that is returned by some functions that indicates the buffer it has been provided is not large enough
   * to facilitate a request.
   */
  public static readonly TOO_SHORT = Symbol('TOO_SHORT');

  /**
   * A map that takes a value of an EBML ID in hex string form, with the value being a boolean that indicates whether
   * this tag has children.
   */
  public static readonly TAGS = {
    // value is true if the element has children
    '1a45dfa3': true, // EBML
    '18538067': true, // Segment
    '1f43b675': true, // Cluster
    '1654ae6b': true, // Tracks
    ae: true, // TrackEntry
    d7: false, // TrackNumber
    '83': false, // TrackType
    a3: false, // SimpleBlock
    '63a2': false,
  };

  private _remainder?: Buffer;
  private _length = 0;
  private _count = 0;
  private _skipUntil?: number;
  private _track?: Track;
  private _incompleteTrack: Partial<Track> = {};
  private _ebmlFound = false;

  /**
   * Creates a new Webm demuxer.
   * @param [options] options that you would pass to a regular Transform stream.
   */
  public constructor(options: TransformOptions = {}) {
    super({ readableObjectMode: true, ...options });
  }

  public _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
    this._length += chunk.length;
    if (this._remainder) {
      chunk = Buffer.concat([this._remainder, chunk]);
      this._remainder = undefined;
    }
    let offset = 0;
    if (this._skipUntil && this._length > this._skipUntil) {
      offset = this._skipUntil - this._count;
      this._skipUntil = undefined;
    } else if (this._skipUntil) {
      this._count += chunk.length;
      return done();
    }
    let result: Tag | typeof WebmBaseDemuxer.TOO_SHORT | undefined;
    while (result !== WebmBaseDemuxer.TOO_SHORT) {
      result = this._readTag(chunk, offset);
      if (result === WebmBaseDemuxer.TOO_SHORT) {
        break;
      }
      if (result._skipUntil) {
        this._skipUntil = result._skipUntil;
        break;
      }
      if (result.offset) {
        offset = result.offset;
      } else {
        break;
      }
    }
    this._count += offset;
    this._remainder = chunk.slice(offset);
    return done();
  }

  /**
   * Reads an EBML ID from a buffer.
   * @param chunk the buffer to read from.
   * @param offset the offset in the buffer.
   * @returns contains an `id` property (buffer) and the new `offset` (number).
   * Returns the WebmBaseDemuxer.TOO_SHORT symbol if the data wasn't big enough to facilitate the request.
   */
  private _readEBMLId(
    chunk: Buffer,
    offset: number,
  ): { id: Buffer; offset: number } | typeof WebmBaseDemuxer.TOO_SHORT {
    const idLength = vintLength(chunk, offset);
    if (idLength === WebmBaseDemuxer.TOO_SHORT) {
      return WebmBaseDemuxer.TOO_SHORT;
    }
    return {
      id: chunk.slice(offset, offset + idLength),
      offset: offset + idLength,
    };
  }

  /**
   * Reads a size variable-integer to calculate the length of the data of a tag.
   * @param chunk the buffer to read from.
   * @param offset the offset in the buffer.
   * @returns contains property `offset` (number), `dataLength` (number) and `sizeLength` (number).
   * Returns the WebmBaseDemuxer.TOO_SHORT symbol if the data wasn't big enough to facilitate the request.
   */
  private _readTagDataSize(
    chunk: Buffer,
    offset: number,
  ): { offset: number; dataLength: number; sizeLength: number } | typeof WebmBaseDemuxer.TOO_SHORT {
    const sizeLength = vintLength(chunk, offset);
    if (sizeLength === WebmBaseDemuxer.TOO_SHORT) {
      return WebmBaseDemuxer.TOO_SHORT;
    }
    const dataLength = expandVint(chunk, offset, offset + sizeLength);
    if (dataLength === WebmBaseDemuxer.TOO_SHORT) {
      return WebmBaseDemuxer.TOO_SHORT;
    }
    return { offset: offset + sizeLength, dataLength, sizeLength };
  }

  /**
   * Takes a buffer and attempts to read and process a tag.
   * @private
   * @param chunk the buffer to read from.
   * @param offset the offset in the buffer.
   * @returns contains the new `offset` (number) and optionally the `_skipUntil` property,
   * indicating that the stream should ignore any data until a certain length is reached.
   * Returns the WebmBaseDemuxer.TOO_SHORT symbol if the data wasn't big enough to facilitate the request.
   */
  public _readTag(chunk: Buffer, offset: number): Tag | typeof WebmBaseDemuxer.TOO_SHORT {
    const idData = this._readEBMLId(chunk, offset);
    if (idData === WebmBaseDemuxer.TOO_SHORT) {
      return WebmBaseDemuxer.TOO_SHORT;
    }
    const ebmlID = idData.id.toString('hex') as keyof typeof WebmBaseDemuxer.TAGS;
    if (!this._ebmlFound) {
      if (ebmlID === '1a45dfa3') {
        this._ebmlFound = true;
      } else {
        throw Error('Did not find the EBML tag at the start of the stream');
      }
    }
    offset = idData.offset;
    const sizeData = this._readTagDataSize(chunk, offset);
    if (sizeData === WebmBaseDemuxer.TOO_SHORT) {
      return WebmBaseDemuxer.TOO_SHORT;
    }
    const { dataLength } = sizeData;
    offset = sizeData.offset;
    // If this tag isn't useful, tell the stream to stop processing data until the tag ends
    if (!(ebmlID in WebmBaseDemuxer.TAGS)) {
      if (chunk.length > offset + dataLength) {
        return { offset: offset + dataLength };
      }
      return { offset, _skipUntil: this._count + offset + dataLength };
    }

    const tagHasChildren = WebmBaseDemuxer.TAGS[ebmlID];
    if (tagHasChildren) {
      return { offset };
    }

    if (offset + dataLength > chunk.length) {
      return WebmBaseDemuxer.TOO_SHORT;
    }
    const data = chunk.slice(offset, offset + dataLength);
    if (!this._track) {
      if (ebmlID === 'ae') {
        this._incompleteTrack = {};
      }
      if (ebmlID === 'd7') {
        this._incompleteTrack.number = data[0];
      }
      if (ebmlID === '83') {
        this._incompleteTrack.type = data[0];
      }
      if (this._incompleteTrack.type === 2 && typeof this._incompleteTrack.number !== 'undefined') {
        this._track = this._incompleteTrack as Track;
      }
    }
    if (ebmlID === '63a2') {
      this._checkHead(data);
    } else if (ebmlID === 'a3') {
      if (typeof this._track === 'undefined') {
        throw Error('No audio track in this webm!');
      }
      if ((data[0] & 0xf) === this._track.number) {
        this.push(data.slice(4));
      }
    }
    return { offset: offset + dataLength };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected _checkHead(data: Buffer): void {
    throw new Error('Method not implemented.');
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
    this._incompleteTrack = {};
  }
}

function vintLength(buffer: Buffer, index: number): number | typeof WebmBaseDemuxer.TOO_SHORT {
  let i = 0;

  for (; i < 8; i++) {
    if ((1 << (7 - i)) & buffer[index]) {
      break;
    }
  }

  if (index + ++i > buffer.length) {
    return WebmBaseDemuxer.TOO_SHORT;
  }

  return i;
}

function expandVint(buffer: Buffer, start: number, end: number): number | typeof WebmBaseDemuxer.TOO_SHORT {
  const length = vintLength(buffer, start);

  if (end > buffer.length || length === WebmBaseDemuxer.TOO_SHORT) {
    return WebmBaseDemuxer.TOO_SHORT;
  }

  const mask = (1 << (8 - length)) - 1;
  let value = buffer[start] & mask;

  for (let i = start + 1; i < end; i++) {
    value = (value << 8) + buffer[i];
  }

  return value;
}
