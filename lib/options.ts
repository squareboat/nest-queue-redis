import { RedisOptions } from "ioredis";

/**
 * Turn the connection options of this driver (written for the old `redis` v3
 * client) into ioredis options, so existing configs keep working unchanged.
 *
 * - `url` wins over host/port/db/password, as it did in redis v3.
 * - v3 names are mapped: auth_pass -> password, user -> username,
 *   prefix -> keyPrefix, connect_timeout -> connectTimeout.
 * - `database` is not sent to the client: redis v3 never used it (only `db`),
 *   so jobs keep landing in the same Redis database as before.
 * - Defaults: RESP2 protocol (what v3 spoke), and `maxRetriesPerRequest: null`,
 *   so while Redis is down commands (push, pull, Dispatch()) wait until it is
 *   back, without a time limit. This is NOT what v3 did: v3 crashed the
 *   process on ECONNREFUSED. Pass `maxRetriesPerRequest` (a number) or
 *   `commandTimeout` (ms) to make them fail instead, or
 *   `enableOfflineQueue: false` to fail at once.
 * - Any other key is passed through, so ioredis options also work.
 */
export function toClientOptions(input: Record<string, any>): {
  url?: string;
  options: RedisOptions;
} {
  const {
    driver,
    queue,
    database,
    url,
    auth_pass,
    user,
    prefix,
    connect_timeout,
    ...rest
  } = input;

  const options: Record<string, any> = {
    protocol: 2,
    maxRetriesPerRequest: null,
  };
  for (const [key, value] of Object.entries(rest)) {
    if (value !== null && value !== undefined) options[key] = value;
  }

  const alias = (from: any, to: string) => {
    if (from !== null && from !== undefined && options[to] === undefined) {
      options[to] = from;
    }
  };
  alias(auth_pass, "password");
  alias(user, "username");
  alias(prefix, "keyPrefix");
  alias(connect_timeout, "connectTimeout");

  if (typeof url !== "string" || !url) return { options };

  // redis v3 let the url override these options
  delete options.host;
  delete options.port;
  try {
    const parsed = new URL(url);
    if (parsed.pathname && parsed.pathname !== "/") delete options.db;
    if (parsed.password) delete options.password;
    if (parsed.username) delete options.username;
  } catch {
    // leave invalid urls to ioredis to report
  }
  return { url, options };
}
