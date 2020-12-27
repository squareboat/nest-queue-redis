import { DriverJob } from "@squareboat/nest-queue-strategy";

export class RedisJob extends DriverJob {
  public getMessage(): string {
    return this.data.message;
  }
}
