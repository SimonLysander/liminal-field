import { Readable } from 'node:stream';

import { InlineAssistController } from './inline-assist.controller';
import type { InlineAssistService } from './inline-assist.service';

describe('InlineAssistController', () => {
  it('bridges the AI SDK Web Response into a Fastify-compatible stream', async () => {
    const response = new Response('first chunk', {
      headers: {
        'cache-control': 'no-cache',
        'content-type': 'text/plain; charset=utf-8',
      },
      status: 201,
    });
    const inlineAssistService = {
      assistStream: jest.fn().mockResolvedValue(response),
    } as unknown as InlineAssistService;
    const reply = {
      code: jest.fn().mockReturnThis(),
      header: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    const controller = new InlineAssistController(inlineAssistService);

    await controller.assistStream({ beforeText: '上下文' }, reply as never);

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(reply.header).toHaveBeenCalledWith(
      'content-type',
      'text/plain; charset=utf-8',
    );
    const body = reply.send.mock.calls[0]?.[0];
    expect(body).toBeInstanceOf(Readable);
    await expect(readStream(body as Readable)).resolves.toBe('first chunk');
  });
});

async function readStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
