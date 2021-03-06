import { Stream } from 'stream';

// The output is slightly different on travis because of ffmpeg version, should account for it
export function roughlyEquals(x: Buffer, y: Buffer): boolean {
  if (x.length !== y.length) {
    return false;
  }

  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i] - y[i]) > 1) {
      return false;
    }
  }

  return true;
}

export function streamToBuffer(stream: Stream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', () => reject());
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
