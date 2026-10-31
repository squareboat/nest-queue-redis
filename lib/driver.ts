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

export class RedisQueueDriver implements QueueDriver {
  private client: Redis;
  private queuePrefix: string;

  constructor(private options: Record<string, any>) {
    validateSchema(this.options, schema);
    this.queuePrefix = "sqbnestqueue";
    const { url, options: clientOptions } = toClientOptions(options);
    this.client = url
      ? new Redis(url, clientOptions)
      : new Redis(clientOptions as RedisOptions);
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

  async scheduledTask(options: Record<string, any>): Promise<void> {
    const reply = await this.client.zrange(
      this.getDelayedQueue(options.queue),
      0,
      "0",
      "WITHSCORES"
    );
    // RESP2 replies [member, score]; RESP3 replies [[member, score]]
    const [message, delay] = (reply as unknown[]).flat() as [string, string];

    if (!message || !delay) return;
    const time = new Date().getTime();
    if (+delay <= time) {
      const rawPayload = JSON.parse(message);
      rawPayload.delay = 0;
      this.push(message, rawPayload);
      await this.client.zrem(this.getDelayedQueue(options.queue), message);
    }
  }

  getDelayedQueue(queue: string): string {
    return `${this.queuePrefix}::${queue}::delayed`;
  }

  getQueue(queue: string): string {
    return `${this.queuePrefix}::${queue}`;
  }
}
