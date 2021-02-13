// Partly based on https://github.com/Rantanen/node-opus/blob/master/lib/Encoder.js

import { Opus } from '@typescord/opus';
import { Transform, TransformCallback, TransformOptions } from 'stream';

const CTL = {
  BITRATE: 4002,
  FEC: 4012,
  PLP: 4014,
};

const OPUS_HEAD = Buffer.from('OpusHead');
const OPUS_TAGS = Buffer.from('OpusTags');

// frame size = (channels * rate * frame_duration) / 1000

interface OpusStreamOptions extends TransformOptions {
  /**
   * the frame size in bytes to use (e.g. 960 for stereo audio at 48KHz with a frame
   * duration of 20ms)
   */
  frameSize: number;
  /**
   * the number of channels to use
   */
  channels: number;
  /**
   * the sampling rate in Hz
   */
  rate: number;
}

/**
 * Takes a stream of Opus data and outputs a stream of PCM data, or the inverse.
 * **You shouldn't directly instantiate this class, see `opus.Encoder` and `opus.Decoder` instead!**
 */
class OpusStream extends Transform {
  public encoder?: Opus;
  protected readonly rate: number;
  protected readonly frameSize: number;
  protected readonly channels: number;
  protected readonly required: number;

  /**
   * Creates a new Opus transformer.
   * @param options options that you would pass to a regular Transform stream
   */
  public constructor({ frameSize, rate, channels, ...options }: OpusStreamOptions) {
    super({ readableObjectMode: true, ...options });

    this.encoder = new Opus(rate, channels);
    this.channels = channels;
    this.rate = rate;
    this.frameSize = frameSize;
    this.required = frameSize * channels * 2;
  }

  protected _encode(buffer: Buffer): Buffer | undefined {
    return this.encoder?.encode(buffer);
  }

  protected _decode(buffer: Buffer): Buffer | undefined {
    return this.encoder?.decode(buffer);
  }

  /**
   * Sets the bitrate of the stream.
   * @param bitrate the bitrate to use use, e.g. 48000
   */
  public setBitrate(bitrate: number): void {
    this.encoder?.applyEncoderCTL.apply(this.encoder, [CTL.BITRATE, Math.min(128e3, Math.max(16e3, bitrate))]);
  }

  /**
   * Enables or disables forward error correction.
   * @param enabled whether or not to enable FEC.
   */
  public setFEC(enabled: boolean): void {
    this.encoder?.applyEncoderCTL.apply(this.encoder, [CTL.FEC, +enabled]);
  }

  /**
   * Sets the expected packet loss over network transmission.
   * @param [percentage] a percentage (represented between 0 and 1)
   */
  public setPLP(percentage: number): void {
    this.encoder?.applyEncoderCTL.apply(this.encoder, [CTL.PLP, Math.min(100, Math.max(0, percentage * 100))]);
  }

  public _final(callback: () => void): void {
    this.cleanup();
    callback();
  }

  public _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.cleanup();
    callback(error);
  }

  /**
   * Cleans up the Opus stream when it is no longer needed
   */
  private cleanup(): void {
    this.encoder = undefined;
  }
}

/**
 * An Opus encoder stream.
 *
 * Outputs opus packets in [object mode](https://nodejs.org/api/stream.html#stream_object_mode).
 * @example
 * const encoder = new prism.opus.Encoder({ frameSize: 960, channels: 2, rate: 48000 });
 * pcmAudio.pipe(encoder);
 * // encoder will now output Opus-encoded audio packets
 */
export class Encoder extends OpusStream {
  private buffer?: Buffer = Buffer.alloc(0);

  /**
   * Creates a new Opus encoder stream.
   * @param options options that you would pass to a regular OpusStream, plus a few more:
   */
  public constructor(options: OpusStreamOptions) {
    super(options);
  }

  public async _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): Promise<void> {
    this.buffer = this.buffer ? Buffer.concat([this.buffer, chunk]) : chunk;

    let n = 0;

    while (this.buffer.length >= this.required * (n + 1)) {
      const buffer = this._encode(this.buffer.slice(n * this.required, ++n * this.required));

      this.push(buffer);
    }

    if (n > 0) {
      this.buffer = this.buffer.slice(n * this.required);
    }

    return done();
  }

  public _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    super._destroy(error, callback);

    this.buffer = undefined;
  }
}

/**
 * An Opus decoder stream.
 *
 * Note that any stream you pipe into this must be in
 * [object mode](https://nodejs.org/api/stream.html#stream_object_mode) and should output Opus packets.
 * @example
 * const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
 * input.pipe(decoder);
 * // decoder will now output PCM audio
 */
export class Decoder extends OpusStream {
  public _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
    const signature = chunk.slice(0, 8);

    if (signature.equals(OPUS_HEAD)) {
      this.emit('format', {
        channels: this.channels,
        sampleRate: this.rate,
        bitDepth: 16,
        float: false,
        signed: true,
        version: chunk.readUInt8(8),
        preSkip: chunk.readUInt16LE(10),
        gain: chunk.readUInt16LE(16),
      });

      return done();
    }

    if (signature.equals(OPUS_TAGS)) {
      this.emit('tags', chunk);

      return done();
    }

    try {
      this.push(this._decode(chunk));
    } catch (e) {
      return done(e);
    }

    return done();
  }
}
