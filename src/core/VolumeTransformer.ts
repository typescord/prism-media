// Based on discord.js' old volume system

import { Transform, TransformCallback, TransformOptions } from 'stream';

const AMPLITUDE_RATIO = 1.660964047443681;

interface VolumeTransformerOptions extends TransformOptions {
  type?: string;
  volume?: number;
}

/**
 * Transforms a stream of PCM volume.
 */
export class VolumeTransformer extends Transform {
  private bits: number;
  private bytes: number;
  private extremum: number;
  private chunk?: Buffer = Buffer.alloc(0);
  private volume: number;

  /**
   * @param options Any optional TransformStream options plus some extra:
   * @param options.type The type of transformer: s16le (signed 16-bit little-endian), s16be, s32le, s32be
   * @param [options.volume=1] The output volume of the stream
   * @example
   * // Half the volume of a signed 16-bit little-endian PCM stream
   * input
   *  .pipe(new prism.VolumeTransformer({ type: 's16le', volume: 0.5 }))
   *  .pipe(writeStream);
   */
  public constructor(options: VolumeTransformerOptions = {}) {
    super(options);

    switch (options.type) {
      case 's16le':
        this._readInt = (buffer, index) => buffer.readInt16LE(index);
        this._writeInt = (buffer, int, index) => buffer.writeInt16LE(int, index);
        this.bits = 16;
        break;
      case 's16be':
        this._readInt = (buffer, index) => buffer.readInt16BE(index);
        this._writeInt = (buffer, int, index) => buffer.writeInt16BE(int, index);
        this.bits = 16;
        break;
      case 's32le':
        this._readInt = (buffer, index) => buffer.readInt32LE(index);
        this._writeInt = (buffer, int, index) => buffer.writeInt32LE(int, index);
        this.bits = 32;
        break;
      case 's32be':
        this._readInt = (buffer, index) => buffer.readInt32BE(index);
        this._writeInt = (buffer, int, index) => buffer.writeInt32BE(int, index);
        this.bits = 32;
        break;
      default:
        throw new Error('VolumeTransformer type should be one of s16le, s16be, s32le, s32be');
    }

    this.bytes = this.bits / 8;
    this.extremum = 2 ** (this.bits - 1);
    this.volume = typeof options.volume === 'undefined' ? 1 : options.volume;
  }

  private _readInt(buffer: Buffer, index: number): number {
    return index;
  }

  private _writeInt(buffer: Buffer, int: number, index: number): number {
    return index;
  }

  public _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
    // If the volume is 1, act like a passthrough stream
    if (this.volume === 1) {
      this.push(chunk);

      return done();
    }

    const { bytes: _bytes, extremum: _extremum } = this;
    const newChunk = (this.chunk = this.chunk ? Buffer.concat([this.chunk, chunk]) : chunk);

    if (newChunk.length < _bytes) {
      return done();
    }

    const transformed = Buffer.allocUnsafe(newChunk.length);
    const complete = Math.floor(newChunk.length / _bytes) * _bytes;

    for (let i = 0; i < complete; i += _bytes) {
      const int = Math.min(_extremum - 1, Math.max(-_extremum, Math.floor(this.volume * this._readInt(newChunk, i))));

      this._writeInt(transformed, int, i);
    }

    this.chunk = newChunk.slice(complete);
    this.push(transformed);

    return done();
  }

  public _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    super._destroy(error, callback);

    this.chunk = undefined;
  }

  /**
   * Sets the volume relative to the input stream - i.e. 1 is normal, 0.5 is half, 2 is double.
   *
   * @param volume The volume that you want to set
   */
  public setVolume(volume: number): void {
    this.volume = volume;
  }

  /**
   * Sets the volume in decibels.
   *
   * @param decibels The decibels
   */
  public setVolumeDecibels(decibels: number): void {
    this.setVolume(10 ** (decibels / 20));
  }

  /**
   * Sets the volume so that a perceived value of 0.5 is half the perceived volume etc.
   *
   * @param {value The value for the volume
   */
  public setVolumeLogarithmic(value: number): void {
    this.setVolume(value ** AMPLITUDE_RATIO);
  }

  /**
   * The current volume of the stream in decibels
   */
  public get volumeDecibels(): number {
    return Math.log10(this.volume) * 20;
  }

  /**
   * The current volume of the stream from a logarithmic scale
   */
  public get volumeLogarithmic(): number {
    return this.volume ** (1 / AMPLITUDE_RATIO);
  }
}
