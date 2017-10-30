import { ChildProcess } from 'child_process';
import { Duplex } from 'stream';

export interface FFmpegOptions {}

export default class FFmpegTransform extends Duplex {
  public process: ChildProcess;

  constructor(options: FFmpegOptions);
  public copy(methods: string[], target: any): void;
}
