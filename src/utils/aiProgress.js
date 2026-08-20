import { redactDeep } from './secrets.js';

export function wantsProgressStream(req) {
  const accept = String(req.headers.accept || '');
  return accept.includes('text/event-stream') || req.headers['x-ai-progress'] === '1';
}

export function createProgressWriter(req, res) {
  const stream = wantsProgressStream(req);
  let started = false;
  let lastPercent = 0;

  const start = () => {
    if (!stream || started || res.headersSent) return;
    started = true;
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
  };

  const writeEvent = (event, data) => {
    if (!stream || res.writableEnded || res.destroyed) return;
    start();
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // The browser canceled the import stream.
    }
  };

  return {
    stream,
    stage(stepOrEvent, percent) {
      const event = typeof stepOrEvent === 'object' ? stepOrEvent : { step: stepOrEvent, percent };
      const rawPercent = event.percent ?? percent;
      const nextPercent =
        rawPercent == null
          ? lastPercent
          : Math.max(0, Math.min(100, Math.round(Number(rawPercent) || 0)));
      lastPercent = nextPercent;
      writeEvent('stage', {
        ...event,
        step: event.step,
        percent: nextPercent,
        remainingMs:
          event.remainingMs == null
            ? undefined
            : Math.max(0, Math.round(Number(event.remainingMs) || 0)),
        elapsedMs:
          event.elapsedMs == null ? undefined : Math.max(0, Math.round(Number(event.elapsedMs) || 0)),
      });
    },
    done(payload, status = 200) {
      if (stream) {
        writeEvent('done', payload);
        res.end();
        return;
      }
      return res.status(status).json(payload);
    },
    fail(status, payload) {
      const safe = redactDeep(payload || {});
      if (safe.error && !safe.message) {
        safe.message = safe.error;
      }
      if (stream) {
        if (!res.writableEnded && !res.destroyed) {
          writeEvent('error', { ...safe, status });
          try {
            res.end();
          } catch {
            // The browser canceled the import stream.
          }
        }
        return;
      }
      if (res.headersSent || res.writableEnded || res.destroyed) return;
      return res.status(status).json(safe);
    },
  };
}

export function extractStreamParts(payload) {
  const delta = payload?.choices?.[0]?.delta || {};
  let content = '';
  const openAi = delta.content;
  if (typeof openAi === 'string' && openAi) {
    content = openAi;
  } else if (Array.isArray(openAi)) {
    content = openAi
      .map((part) => {
        const type = String(part?.type || '').toLowerCase();
        if (type.includes('reason') || type.includes('think')) return '';
        return part?.text || part?.content || '';
      })
      .join('');
  }

  if (!content && payload?.type === 'content_block_delta' && typeof payload.delta?.text === 'string') {
    content = payload.delta.text;
  }
  if (!content && payload?.delta?.type === 'text_delta' && typeof payload.delta?.text === 'string') {
    content = payload.delta.text;
  }

  const reasoning =
    (typeof delta.reasoning_content === 'string' && delta.reasoning_content) ||
    (typeof delta.reasoning === 'string' && delta.reasoning) ||
    (typeof delta.reasoning?.content === 'string' && delta.reasoning.content) ||
    (typeof delta.thinking === 'string' && delta.thinking) ||
    (typeof payload?.message?.thinking === 'string' && payload.message.thinking) ||
    '';

  return { content, reasoning };
}

export function extractStreamDelta(payload) {
  const { content } = extractStreamParts(payload);
  return content;
}

export async function readProviderSse(response, onEvent) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('AI provider did not return a readable stream.');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const data = part
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');

      if (!data || data === '[DONE]') continue;

      try {
        onEvent(JSON.parse(data));
      } catch {
        // Ignore keep-alives and partial provider frames.
      }
    }
  }
}
