import { WebmBaseDemuxer } from '../core/WebmBase';

const VORBIS_HEAD = Buffer.from('vorbis');

/**
 * Demuxes a Webm stream (containing Vorbis audio) to output a Vorbis stream.
 */
export class WebmDemuxer extends WebmBaseDemuxer {
  protected _checkHead(data: Buffer): void {
    if (data.readUInt8(0) !== 2 || !data.slice(4, 10).equals(VORBIS_HEAD)) {
      throw Error('Audio codec is not Vorbis!');
    }

    this.push(data.slice(3, 3 + data.readUInt8(1)));
    this.push(data.slice(3 + data.readUInt8(1), 3 + data.readUInt8(1) + data.readUInt8(2)));
    this.push(data.slice(3 + data.readUInt8(1) + data.readUInt8(2)));
  }
}
