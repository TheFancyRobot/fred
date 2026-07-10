import { HttpServerResponse } from '@effect/platform';
import { Stream } from 'effect';
import { withSessionHeader } from './session';

export interface OpenAIChatChunk {
  readonly object: 'chat.completion.chunk';
}

const encoder = new TextEncoder();

export const encodeSseData = (data: string): Uint8Array =>
  encoder.encode(`data: ${data}\n\n`);

export const encodeOpenAiSse = <A extends OpenAIChatChunk, E, R>(
  chunks: Stream.Stream<A, E, R>,
): Stream.Stream<Uint8Array, E, R> =>
  chunks.pipe(
    Stream.map((chunk) => encodeSseData(JSON.stringify(chunk))),
    Stream.concat(Stream.succeed(encodeSseData('[DONE]'))),
  );

export const openAiSseResponse = <E>(
  stream: Stream.Stream<Uint8Array, E>,
  sessionId: string,
): HttpServerResponse.HttpServerResponse =>
  withSessionHeader(
    HttpServerResponse.stream(stream, {
      contentType: 'text/event-stream; charset=utf-8',
      headers: {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    }),
    sessionId,
  );
