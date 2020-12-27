import { QueueDriver, InternalMessage } from "@squareboat/nest-queue-strategy";
import { RedisJob } from "./job";
import * as redis from "redis";
import { promisify } from "util";
import { schema } from "./schema";
import { validateSchema } from "@squareboat/nest-queue-strategy";

export class RedisQueueDriver implements QueueDriver {
  private client: redis.RedisClient;

  constructor(private options: Record<string, any>) {
    validateSchema(this.options, schema);
    this.client = redis.createClient(options);
  }

  async push(message: string, rawPayload: InternalMessage): Promise<void> {
    const rpush: Function = promisify(this.client.rpush).bind(this.client);
    await rpush(rawPayload.queue, message);
    return;
  }

  async pull(options: Record<string, any>): Promise<RedisJob | null> {
    const lpop = promisify(this.client.lpop).bind(this.client);
    const data = await lpop(options.queue);
    return data ? new RedisJob({ message: data }) : null;
  }

  async remove(): Promise<void> {
    return;
  }

  async purge(options: Record<string, any>): Promise<void> {
    const del: Function = promisify(this.client.del).bind(this.client);
    await del(options.queue);
    return;
  }

  async count(options: Record<string, any>): Promise<number> {
    const llen = promisify(this.client.llen).bind(this.client);
    const data = await llen(options.queue);
    return data;
  }
}
