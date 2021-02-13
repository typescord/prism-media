import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import { FFmpeg } from '../src';
import { roughlyEquals, streamToBuffer } from './util';

test('FFmpeg transcoder available', () => {
  const info = FFmpeg.getInfo();

  if (!info) {
    return;
  }

  expect(FFmpeg).toBeTruthy();
  expect(info.command).toBeTruthy();
  expect(info.output).toBeTruthy();
  expect(info.version).toBeTruthy();
});

test('FFmpeg transcoder to PCM is sane', async (done) => {
  expect.assertions(1);

  const output = createReadStream('./test/audio/speech_orig.ogg').pipe(
    new FFmpeg({
      args: ['-analyzeduration', '0', '-loglevel', '0', '-f', 's16le', '-ar', '48000', '-ac', '2'],
    }),
  );
  const chunks = await streamToBuffer(output);
  const file = await readFile('./test/audio/speech_orig.pcm');

  expect(roughlyEquals(file, chunks)).toEqual(true);
  done();
});
