import { request } from 'undici';

export class Transport {
  constructor(server, room) {
    this.topicUrl = `${server.replace(/\/$/, '')}/${room}`;
    this.sseUrl = `${this.topicUrl}/sse`;
    this.jsonUrl = `${this.topicUrl}/json?poll=1`;
    this.onMessage = () => {};
  }

  async publish(message) {
    const response = await fetch(this.topicUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(message)
    });
    if (!response.ok) {
      const error = new Error(`server returned ${response.status}`);
      error.status = response.status;
      throw error;
    }
  }

  async publishAll(messages) {
    for (const message of messages) await this.publish(message);
  }

  async recent(sinceMs) {
    const since = Math.floor(sinceMs / 1000);
    const response = await fetch(`${this.jsonUrl}&since=${since}`);
    if (!response.ok) {
      const error = new Error(`history unavailable (${response.status})`);
      error.status = response.status;
      throw error;
    }

    const text = await response.text();
    const entries = [];

    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch {}
    }

    return entries
      .filter((entry) => entry.event === 'message' && (entry.time ?? 0) >= since)
      .map((entry) => {
        try {
          return JSON.parse(entry.message);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  async subscribe() {
    const { body } = await request(this.sseUrl, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' }
    });

    const decoder = new TextDecoder();

    for await (const chunk of body) {
      let text = decoder.decode(chunk);

      for (const block of text.split('\n\n')) {
        const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
        if (!dataLine) continue;

        try {
          const outer = JSON.parse(dataLine.slice(5).trim());
          if (typeof outer.message !== 'string') continue;
          this.onMessage(JSON.parse(outer.message));
        } catch {}
      }
    }
  }
}