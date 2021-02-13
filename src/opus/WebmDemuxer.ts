import { WebmBaseDemuxer } from '../core/WebmBase';

const OPUS_HEAD = Buffer.from('OpusHead');

/**
 * Demuxes a Webm stream (containing Opus audio) to output an Opus stream.
 * @example
 * const fs = require('fs');
 * const file = fs.createReadStream('./audio.webm');
 * const demuxer = new prism.opus.WebmDemuxer();
 * const opus = file.pipe(demuxer);
 * // opus is now a ReadableStream in object mode outputting Opus packets
 */
export class WebmDemuxer extends WebmBaseDemuxer {
  protected _checkHead(data: Buffer): void {
    if (!data.slice(0, 8).equals(OPUS_HEAD)) {
      throw Error('Audio codec is not Opus!');
    }
  }
}
