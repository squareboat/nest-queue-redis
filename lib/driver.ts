import {
  QueueDriver,
  InternalMessage,
  validateSchema,
} from "@squareboat/nest-queue-strategy";
import { v4 } from "uuid";
import * as redis from "redis";
import { RedisJob } from "./job";
import { promisify } from "util";
import { schema } from "./schema";

export class RedisQueueDriver implements QueueDriver {
  private client: redis.RedisClient;
  private queuePrefix: string;

  constructor(private options: Record<string, any>) {
    validateSchema(this.options, schema);
    this.queuePrefix = "sqbnestqueue";
    this.client = redis.createClient(options);
  }

  async push(message: string, rawPayload: InternalMessage): Promise<void> {
    if ((rawPayload.delay || 0) > 0) {
      await this.pushToDelayedQueue(message, rawPayload);
      return;
    }

    const rpush: Function = promisify(this.client.rpush).bind(this.client);
    await rpush(
      this.getQueue(`${rawPayload.queue}`),
      this.getProcessedMessage(message)
    );
    return;
  }

  async pull(options: Record<string, any>): Promise<RedisJob | null> {
    const lpop: Function = promisify(this.client.lpop).bind(this.client);
    const data = await lpop(this.getQueue(options.queue));
    return data ? new RedisJob({ message: data }) : null;
  }

  async remove(): Promise<void> {
    return;
  }

  async purge(options: Record<string, any>): Promise<void> {
    const del: Function = promisify(this.client.del).bind(this.client);
    await del(this.getQueue(options.queue));
    await del(this.getDelayedQueue(options.queue));
    return;
  }

  async count(options: Record<string, any>): Promise<number> {
    const llen: Function = promisify(this.client.llen).bind(this.client);
    const data = await llen(this.getQueue(options.queue));
    return data;
  }

  async pushToDelayedQueue(
    message: string,
    rawPayload: InternalMessage
  ): Promise<void> {
    const zadd: Function = promisify(this.client.zadd).bind(this.client);
    const date = new Date();
    date.setSeconds(date.getSeconds() + (rawPayload.delay || 0));
    await zadd(
      this.getDelayedQueue(`${rawPayload.queue}`),
      date.getTime(),
      this.getProcessedMessage(message)
    );
    return;
  }

  getProcessedMessage(message: string): string {
    const data = JSON.parse(message);
    data.id = v4();
    return JSON.stringify(data);
  }

  async scheduledTask(options: Record<string, any>): Promise<void> {
    const zrange: Function = promisify(this.client.zrevrange).bind(this.client);
    const [message, delay] = await zrange(
      this.getDelayedQueue(options.queue),
      0,
      0,
      "withscores"
    );

    if (!message || !delay) return;
    const time = new Date().getTime();
    if (+delay <= time) {
      const rawPayload = JSON.parse(message);
      rawPayload.delay = 0;
      this.push(message, rawPayload);
      const zrem: Function = promisify(this.client.zrem).bind(this.client);
      await zrem(this.getDelayedQueue(options.queue), message);
    }
  }

  getDelayedQueue(queue: string): string {
    return `${this.queuePrefix}::${queue}::delayed`;
  }

  getQueue(queue: string): string {
    return `${this.queuePrefix}::${queue}`;
  }
}
