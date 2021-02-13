// This example will demux an Opus-containing OGG file, decode the Opus packets to PCM and then write it to a file.

import { createReadStream, createWriteStream } from 'fs';
import { opus } from '@typescord/prism-media';

createReadStream('./audio.ogg')
  .pipe(new opus.OggDemuxer())
  .pipe(new opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 }))
  .pipe(createWriteStream('./audio.pcm'));
