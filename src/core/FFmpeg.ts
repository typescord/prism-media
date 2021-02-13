import { spawnSync, ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { Duplex, Readable, Writable } from 'stream';

const VERSION_REGEX = /version (.+) Copyright/im;

declare module 'stream' {
  interface Writable {
    _writableState?: unknown;
  }

  interface Readable {
    _readableState?: unknown;
  }
}

type ExtractMethods<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [P in keyof T]: T[P] extends (...args: any[]) => unknown ? P : never;
}[keyof T][];

interface FFMPEG {
  command?: string;
  output?: string;
  version?: string;
}

const FFMPEG: FFMPEG = {
  command: undefined,
  output: undefined,
  get version() {
    return this.output ? VERSION_REGEX.exec(this.output)?.[1] : undefined;
  },
};

interface FFmpegOptions {
  /**
   * Arguments to pass to FFmpeg
   */
  args: string[];
}

/**
 * An FFmpeg transform stream that provides an interface to FFmpeg.
 */
export class FFmpeg extends Duplex {
  private process?: ChildProcessWithoutNullStreams;
  public readonly _readableState: unknown;
  public readonly _writableState: unknown;

  /**
   * Creates a new FFmpeg transform stream
   *
   * @param options Options you would pass to a regular Transform stream, plus an `args` option
   * @example
   * // By default, if you don't specify an input (`-i ...`) prism will assume you're piping a stream into it.
   * const transcoder = new prism.FFmpeg({
   *  args: [
   *    '-analyzeduration', '0',
   *    '-loglevel', '0',
   *    '-f', 's16le',
   *    '-ar', '48000',
   *    '-ac', '2',
   *  ]
   * });
   * const s16le = mp3File.pipe(transcoder);
   * const opus = s16le.pipe(new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 }));
   */
  public constructor(options: FFmpegOptions = { args: [] }) {
    super();

    this.process = FFmpeg.create(options);

    this._readableState = this.reader?._readableState;
    this._writableState = this.writer?._writableState;

    if (this.writer && this.reader) {
      this.copy(['write', 'end'], this.writer);
      this.copy(['read', 'setEncoding', 'pipe', 'unpipe'], this.reader);
    }

    const EVENTS = {
      readable: this.reader,
      data: this.reader,
      end: this.reader,
      unpipe: this.reader,
      finish: this.writer,
      drain: this.writer,
    };

    for (const method of ['on', 'once', 'removeListener'] as const) {
      Object.defineProperty(this, method, {
        value: (event: string | symbol, callback: (...args: unknown[]) => void): this => {
          if (event in EVENTS) {
            EVENTS[event as keyof typeof EVENTS]?.[method](event, callback);
          } else {
            super[method](event, callback);
          }

          return this;
        },
      });
    }

    const processError = (error: Error) => this.emit('error', error);

    this.reader?.on('error', processError);
    this.writer?.on('error', processError);
  }

  private get reader(): Readable | undefined {
    return this.process?.stdout;
  }

  private get writer(): Writable | undefined {
    return this.process?.stdin;
  }

  private copy(methods: ExtractMethods<Writable>, target: Writable): void;
  private copy(methods: ExtractMethods<Readable>, target: Readable): void;
  private copy(methods: ExtractMethods<Writable | Readable>, target: Writable | Readable): void {
    for (const method of methods) {
      Object.defineProperty(this, method, {
        value: target[method].bind(target),
      });
    }
  }

  public _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.cleanup();
    callback(error);
  }

  public _final(callback: () => void): void {
    this.cleanup();
    callback();
  }

  private cleanup(): void {
    if (this.process) {
      this.once('error', () => undefined);
      this.process.kill('SIGKILL');
      this.process = undefined;
    }
  }

  /**
   * The available FFmpeg information
   *
   * @property command The command used to launch FFmpeg
   * @property output The output from running `ffmpeg -h`
   * @property version The version of FFmpeg being used, determined from `output`.
   */

  /**
   * Finds a suitable FFmpeg command and obtains the debug information from it.
   *
   * @param [force=false] If true, will ignore any cached results and search for the command again
   * @throws Will throw an error if FFmpeg cannot be found.
   * @example
   * const ffmpeg = prism.FFmpeg.getInfo();
   *
   * console.log(`Using FFmpeg version ${ffmpeg.version}`);
   *
   * if (ffmpeg.output.includes('--enable-libopus')) {
   *   console.log('libopus is available!');
   * } else {
   *   console.log('libopus is unavailable!');
   * }
   */
  public static getInfo(force = false): Required<FFMPEG> | undefined {
    if (FFMPEG.command && !force) {
      return FFMPEG as Required<FFMPEG>;
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sources = [() => require('ffmpeg-static') as string, 'ffmpeg', 'avconv', './ffmpeg', './avconv'];

    for (const source of sources) {
      try {
        const command = typeof source === 'function' ? source() : source;
        const result = spawnSync(command, ['-h'], { windowsHide: true });

        if (result.error) {
          throw result.error;
        }

        const output = result.output.filter(Boolean).map((item) => Buffer.from(item));

        Object.assign(FFMPEG, {
          command,
          output: Buffer.concat(output).toString(),
        });

        return FFMPEG as Required<FFMPEG>;
      } catch {
        // do nothing
      }

      throw new Error('FFmpeg/avconv not found!');
    }
  }

  /**
   * Creates a new FFmpeg instance. If you do not include `-i ...` it will be assumed that `-i -` should be prepended
   * to the options and that you'll be piping data into the process.
   *
   * @param [args=[]] Arguments to pass to FFmpeg
   * @throws Will throw an error if FFmpeg cannot be found.
   */
  private static create({ args }: FFmpegOptions = { args: [] }): ChildProcessWithoutNullStreams {
    if (!args.includes('-i')) {
      args.unshift('-i', '-');
    }

    return spawn(FFmpeg.getInfo()?.command ?? '', args.concat(['pipe:1']), { windowsHide: true });
  }
}
