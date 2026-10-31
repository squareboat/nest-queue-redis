import {
  QueueDriver,
  InternalMessage,
  validateSchema,
} from "@squareboat/nest-queue-strategy";
import { randomUUID } from "crypto";
import { Redis, RedisOptions } from "ioredis";
import { RedisJob } from "./job";
import { schema } from "./schema";
import { toClientOptions } from "./options";

/** How long disconnect() waits for QUIT before it closes the socket */
const QUIT_TIMEOUT = 1500;

/** Delayed jobs moved per script call; a tick repeats until none are due */
const RELEASE_BATCH = 100;

/**
 * Move up to ARGV[2] due jobs (score <= ARGV[1]) from the delayed sorted set
 * KEYS[1] to the end of the queue list KEYS[2], oldest first, in one atomic
 * step: a job is never pushed twice, even with several workers.
 */
const RELEASE_DUE_SCRIPT = `
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
if #due == 0 then return 0 end
redis.call('ZREM', KEYS[1], unpack(due))
redis.call('RPUSH', KEYS[2], unpack(due))
return #due
`;

type ReleasingRedis = Redis & {
  sqbQueueReleaseDue(
    delayedKey: string,
    queueKey: string,
    now: number,
    limit: number
  ): Promise<number>;
};

export class RedisQueueDriver implements QueueDriver {
  private client: ReleasingRedis;
  private queuePrefix: string;
  private releasing = false;
  private closing = false;
  private connectionLost = false;

  constructor(private options: Record<string, any>) {
    validateSchema(this.options, schema);
    this.queuePrefix = "sqbnestqueue";
    const { url, options: clientOptions } = toClientOptions(options);
    const client = url
      ? new Redis(url, clientOptions)
      : new Redis(clientOptions as RedisOptions);
    client.defineCommand("sqbQueueReleaseDue", {
      numberOfKeys: 2,
      lua: RELEASE_DUE_SCRIPT,
    });
    // Without an 'error' listener ioredis prints "[ioredis] Unhandled error
    // event" on every reconnect attempt. Log once per outage instead.
    client.on("error", (error: Error) => {
      if (this.connectionLost || this.closing) return;
      this.connectionLost = true;
      console.error(
        `[nest-queue-redis] Redis connection error: ${error.message}. ` +
          "Reconnecting (logged once until the connection is back)."
      );
    });
    client.on("ready", () => {
      if (!this.connectionLost) return;
      this.connectionLost = false;
      console.error("[nest-queue-redis] Redis connection restored.");
    });
    this.client = client as ReleasingRedis;
  }

  async push(message: string, rawPayload: InternalMessage): Promise<void> {
    if ((rawPayload.delay || 0) > 0) {
      await this.pushToDelayedQueue(message, rawPayload);
      return;
    }

    await this.client.rpush(
      this.getQueue(`${rawPayload.queue}`),
      this.getProcessedMessage(message)
    );
    return;
  }

  async pull(options: Record<string, any>): Promise<RedisJob | null> {
    const data = await this.client.lpop(this.getQueue(options.queue));
    return data ? new RedisJob({ message: data }) : null;
  }

  async remove(): Promise<void> {
    return;
  }

  async purge(options: Record<string, any>): Promise<void> {
    await this.client.del(this.getQueue(options.queue));
    await this.client.del(this.getDelayedQueue(options.queue));
    return;
  }

  async count(options: Record<string, any>): Promise<number> {
    const data = await this.client.llen(this.getQueue(options.queue));
    return data;
  }

  async pushToDelayedQueue(
    message: string,
    rawPayload: InternalMessage
  ): Promise<void> {
    const date = new Date();
    date.setSeconds(date.getSeconds() + (rawPayload.delay || 0));
    await this.client.zadd(
      this.getDelayedQueue(`${rawPayload.queue}`),
      date.getTime(),
      this.getProcessedMessage(message)
    );
    return;
  }

  getProcessedMessage(message: string): string {
    const data = JSON.parse(message);
    data.id = randomUUID();
    return JSON.stringify(data);
  }

  /**
   * Move the delayed jobs that are due to the queue. Called by the nest-queue
   * worker every `schedulerInterval` ms. Overlapping calls on one driver are
   * skipped; jobs are claimed atomically, so several workers never push the
   * same job twice.
   */
  async scheduledTask(options: Record<string, any>): Promise<void> {
    if (this.releasing || this.closing) return;
    this.releasing = true;
    try {
      const delayedKey = this.getDelayedQueue(options.queue);
      const queueKey = this.getQueue(options.queue);
      let moved: number;
      do {
        moved = await this.client.sqbQueueReleaseDue(
          delayedKey,
          queueKey,
          Date.now(),
          RELEASE_BATCH
        );
      } while (moved >= RELEASE_BATCH && !this.closing);
    } finally {
      this.releasing = false;
    }
  }

  /**
   * Close the Redis connection. Called by nest-queue on `app.close()`.
   * Sends QUIT (pending replies are still delivered) and closes the socket if
   * Redis does not answer within 1.5 s (e.g. while it is down). Commands that
   * were waiting for Redis to come back are then rejected with
   * "Connection is closed.".
   */
  async disconnect(): Promise<void> {
    this.closing = true;
    const client = this.client;
    // a function, so TypeScript does not narrow the status across the awaits
    const ended = (): boolean => client.status === "end";
    if (ended()) return;
    if (client.status === "ready") {
      await settleWithin(client.quit(), QUIT_TIMEOUT);
      if (ended()) return;
    }
    client.disconnect();
    if (ended()) return;

    // A client that is waiting to reconnect stays "reconnecting" after
    // disconnect(), and ioredis never settles the commands queued meanwhile.
    // One last connection attempt (now marked as a manual close) ends it: the
    // queued commands are rejected, or sent if Redis is back, then closed.
    await settleWithin(
      new Promise<void>((resolve) => {
        client.once("end", resolve);
        client.once("ready", () => client.disconnect());
        client.connect().catch(() => {});
      }),
      QUIT_TIMEOUT
    );
    if (!ended()) client.disconnect();
  }

  getDelayedQueue(queue: string): string {
    return `${this.queuePrefix}::${queue}::delayed`;
  }

  getQueue(queue: string): string {
    return `${this.queuePrefix}::${queue}`;
  }
}

/** Wait for `promise` (ignoring its result or error), at most `ms` */
async function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise.catch(() => {}),
      new Promise((resolve) => (timer = setTimeout(resolve, ms))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
