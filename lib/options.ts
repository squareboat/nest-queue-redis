import { RedisOptions } from "ioredis";

/**
 * Turn the connection options of this driver (written for the old `redis` v3
 * client) into ioredis options, so existing configs keep working unchanged.
 *
 * - `url`: like v3, the url only replaces what it contains. Host, port, db
 *   (path), username and password from the url win; options the url does not
 *   have (e.g. `port` with `redis://host`) are still used.
 * - v3 names are mapped: user -> username, prefix -> keyPrefix,
 *   connect_timeout -> connectTimeout, and as in v3 `auth_pass` wins over
 *   `password` and `auth_user` over `user` (also over credentials in the url).
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
    auth_user,
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
  alias(user, "username");
  alias(prefix, "keyPrefix");
  alias(connect_timeout, "connectTimeout");
  // redis v3: `auth_pass || password` and `auth_user || user`
  if (auth_pass) options.password = auth_pass;
  if (auth_user) options.username = auth_user;

  if (typeof url !== "string" || !url) return { options };

  // ioredis already gives the url precedence and fills the rest from the
  // options. Only auth_pass / auth_user must beat credentials in the url, so
  // move those out of the url in that case.
  if ((auth_pass || auth_user) && /^rediss?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) {
        if (!auth_pass && parsed.password) {
          options.password = decodeURIComponent(parsed.password);
        }
        if (!auth_user && parsed.username) {
          options.username = decodeURIComponent(parsed.username);
        }
        parsed.username = "";
        parsed.password = "";
        return { url: parsed.toString(), options };
      }
    } catch {
      // leave invalid urls to ioredis to report
    }
  }
  return { url, options };
}
