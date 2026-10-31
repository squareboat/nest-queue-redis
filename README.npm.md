# Redis Strategy for Nest Queue Package

Package for Redis strategy package for [@squareboat/nest-queue](https://github.com/squareboat/nest-queue)

## Installation

```bash
npm i @squareboat/nest-queue @squareboat/nest-console @squareboat/nest-queue-redis
```

Uses [ioredis](https://github.com/redis/ioredis) 6, which supports Redis 6.2 and later. Requires Node.js 20 or later (`@squareboat/nest-queue` 0.2 needs 20.19+ or 22.12+).

## Configuration

```typescript
import { Module } from "@nestjs/common";
import { QueueModule } from "@squareboat/nest-queue";
import { RedisQueueDriver } from "@squareboat/nest-queue-redis";

@Module({
  imports: [
    QueueModule.register({
      isGlobal: true,
      default: "notifications",
      connections: {
        notifications: {
          driver: RedisQueueDriver,
          queue: "notifications",
          host: process.env.REDIS_HOST ?? "127.0.0.1",
          port: Number(process.env.REDIS_PORT ?? 6379), // a number, not "6379"
          database: 0, // required, but not used: set `db` to pick the database
          db: 0,
          password: process.env.REDIS_PASSWORD,
          prefix: "myapp:",
        },
      },
    }),
  ],
})
export class AppModule {}
```

Or with a URL (`host`, `port` and `database` must still be present, so set them to `null`):

```typescript
import { QueueOptions } from "@squareboat/nest-queue";
import { RedisQueueDriver } from "@squareboat/nest-queue-redis";

export const queueOptions: QueueOptions = {
  default: "notifications",
  connections: {
    notifications: {
      driver: RedisQueueDriver,
      queue: "notifications",
      url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0",
      host: null,
      port: null,
      database: null,
      maxRetriesPerRequest: 3, // fail commands after 3 reconnect attempts while Redis is down
    },
  },
};
```

| Option | Description |
|---|---|
| `queue` | Queue name. Jobs are kept in the list `sqbnestqueue::<queue>`, delayed jobs in the sorted set `sqbnestqueue::<queue>::delayed`. |
| `host`, `port` | Redis server. Required keys (can be `null` with `url`). `port` must be a number. |
| `database` | Required key, but **not used** (it never was, also not in 0.0.x). Set `db` to select a database. |
| `db` | Database number, default `0`. |
| `url` | `redis://[[username]:password@]host[:port][/db]` (`rediss://` for TLS). Replaces only what it contains: with `url: "redis://cache"` and `port: 6380`, port 6380 is used. |
| `password` (or `auth_pass`), `username` (or `user`, `auth_user`) | Credentials. As in 0.0.x, `auth_pass` wins over `password` and `auth_user` over `user`, also over credentials in `url`. |
| `prefix` (or `keyPrefix`) | Prefix for every key, e.g. `myapp:` gives `myapp:sqbnestqueue::<queue>`. |
| `protocol` | `2` (RESP2, default, what 0.0.x used) or `3`. |
| `maxRetriesPerRequest` | While Redis is down, commands wait until it is back (default `null`: no limit). A number makes them fail after that many reconnect attempts. |
| `commandTimeout` | Fail a command that has no reply after this many ms (also while Redis is down). |
| `enableOfflineQueue` | `false` fails commands at once while Redis is down. |
| other ioredis options | Passed through as they are (`tls`, `connectTimeout` or `connect_timeout`, `retryStrategy`, ...). |

### Delayed jobs

Jobs with a `delay` (nest-queue's default is 10 seconds) wait in the sorted set. The worker moves the ones that are due to the queue every `schedulerInterval` ms (default `10000`), so a delayed job can start up to that much later. All due jobs are moved on each run, in atomic batches of 100, so several workers on the same queue never run a delayed job twice.

### Redis outages

The process stays up while Redis is down. The driver logs the first connection error of an outage and `Redis connection restored.` when it is back, and ioredis keeps reconnecting. Until then `Dispatch()`, the worker's polling and the scheduler wait, without a time limit unless you set `maxRetriesPerRequest`, `commandTimeout` or `enableOfflineQueue: false`.

### Shutdown

With `@squareboat/nest-queue` 0.2, `app.close()` calls the driver's `disconnect()`: it sends `QUIT` and closes the socket if Redis does not answer within 1.5 s, so the process can exit. Commands still waiting for Redis (during an outage) are rejected with `Connection is closed.`.

## Upgrading from 0.0.x

- The `redis` v3 client was replaced by ioredis 6, which supports **Redis 6.2 and later**. Node.js 20 or later is required.
- Existing options keep working: `url`, `host`, `port`, `db`, `password`, `auth_pass`, `user`, `auth_user`, `prefix`, `connect_timeout`. `database` is still not used. The default protocol stays RESP2.
- **Redis outages behave differently.** 0.0.x crashed the process when Redis refused the connection (`ECONNREFUSED`). Now the process stays up, the error is logged once per outage, and `Dispatch()` (and the worker) wait until Redis is back, without a time limit by default. If a request should fail instead of waiting, set `maxRetriesPerRequest` (e.g. `3`), `commandTimeout` (ms) or `enableOfflineQueue: false`.
- Delayed jobs and retries are moved to the queue atomically and all due jobs per run. Before, one job was moved per run (every 10 s), and overlapping runs or several workers could run the same delayed job more than once.
- The driver has a `disconnect()` method, which nest-queue 0.2 calls on `app.close()`.
- The `uuid` dependency was dropped (job ids come from `crypto.randomUUID()`).

## Other Available Queues

- Sync (Added by default in [@squareboat/nest-queue](https://github.com/squareboat/nest-queue))
- AWS SQS ([@squareboat/nest-queue-sqs](https://github.com/squareboat/nest-queue-sqs))
- Redis ([@squareboat/nest-queue-redis](https://github.com/squareboat/nest-queue-redis))
- RabbitMQ (Coming Soon)

## Documentation

To read the complete documentation, [click here](https://squareboat.com/open-source/nest-queue).

## Contributing

To know about contributing to this package, read the guidelines [here](./CONTRIBUTING.md)

## About Us

We are a bunch of dreamers, designers, and futurists. We are high on collaboration, low on ego, and take our happy hours seriously. We'd love to hear more about your product. Let's talk and turn your great ideas into something even greater! We have something in store for everyone. [☎️ 📧 Connect with us!](https://squareboat.com/contact)

## License

The MIT License. Please see License File for more information. Copyright © 2020 SquareBoat.

Made with ❤️ by [Squareboat](https://squareboat.com)
