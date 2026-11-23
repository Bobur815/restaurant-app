/**
 * Server-Sent Events over XMLHttpRequest: React Native's fetch does not stream a response body,
 * but XHR reports the text received so far (`onprogress`). The till sends `data: <json>` frames
 * separated by a blank line, and `: ping` comments every 20 s.
 */

export interface SseHandle {
  close(): void;
}

export interface SseOptions {
  url: string;
  headers: Record<string, string>;
  /** The stream is open (status 200). */
  onOpen(): void;
  onData(json: string): void;
  /** Ended or failed; `status` 0 = no answer. Not called after `close()`. */
  onEnd(status: number): void;
  /** No frame (data or ping) for this long: the line is taken as dead. */
  idleMs?: number;
}

/** A frame larger than this is not the till's: the stream is dropped. */
const MAX_FRAME = 256 * 1024;
/**
 * XHR keeps everything it received in `responseText`: past this the stream is ended on purpose
 * (status 200) and the caller opens a fresh one, so a phone left on all day does not grow.
 */
const MAX_STREAM_TEXT = 2 * 1024 * 1024;
/** An error answer larger than this is cut off. */
const MAX_ERROR_TEXT = 64 * 1024;

/** Splits the text received so far into complete frames; returns the frames and the rest. */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;
  let cut: number;
  while ((cut = rest.indexOf('\n\n')) >= 0) {
    frames.push(rest.slice(0, cut));
    rest = rest.slice(cut + 2);
  }
  return { frames, rest };
}

/** The `data:` payloads of one frame (comments and other fields are skipped). */
export function dataOf(frame: string): string[] {
  return frame
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6));
}

export function openSse(o: SseOptions): SseHandle {
  const xhr = new XMLHttpRequest();
  let seen = 0;
  let buffer = '';
  let closed = false;
  let opened = false;
  let idle: ReturnType<typeof setTimeout> | null = null;
  const idleMs = o.idleMs ?? 60_000;

  const finish = (status: number) => {
    if (closed) return;
    closed = true;
    if (idle) clearTimeout(idle);
    xhr.abort();
    o.onEnd(status);
  };
  const touch = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => finish(0), idleMs);
  };

  xhr.open('GET', o.url);
  for (const [k, v] of Object.entries(o.headers)) xhr.setRequestHeader(k, v);
  xhr.setRequestHeader('accept', 'text/event-stream');
  xhr.onreadystatechange = () => {
    if (xhr.readyState === XMLHttpRequest.HEADERS_RECEIVED && xhr.status === 200 && !opened) {
      opened = true;
      touch();
      o.onOpen();
    }
    if (xhr.readyState === XMLHttpRequest.DONE) finish(xhr.status);
  };
  xhr.onprogress = () => {
    if (closed) return;
    if (xhr.status !== 200) {
      // Not a stream (an error page): nothing to read, and no reason to keep receiving it.
      if (xhr.responseText.length > MAX_ERROR_TEXT) finish(xhr.status);
      return;
    }
    const text = xhr.responseText;
    buffer += text.slice(seen);
    seen = text.length;
    touch();
    const { frames, rest } = splitFrames(buffer);
    buffer = rest;
    if (buffer.length > MAX_FRAME) return finish(0);
    for (const frame of frames) for (const data of dataOf(frame)) o.onData(data);
    if (seen > MAX_STREAM_TEXT) finish(200);
  };
  xhr.onerror = () => finish(0);
  xhr.send();
  touch();

  return {
    close: () => {
      if (closed) return;
      closed = true;
      if (idle) clearTimeout(idle);
      xhr.abort();
    },
  };
}
