import { vorbis } from '../src';

test('vorbis.WebmDemuxer available', () => {
  expect(vorbis.WebmDemuxer).toBeTruthy();
  expect(vorbis.WebmDemuxer.TOO_SHORT).toBeTruthy();
  expect(vorbis.WebmDemuxer.TAGS).toBeTruthy();
});
