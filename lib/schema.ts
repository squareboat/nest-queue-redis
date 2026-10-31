import type { SchemaObject } from "ajv";

export const schema: SchemaObject = {
  type: "object",
  properties: {
    host: { type: "string", nullable: true },
    port: { type: "number", nullable: true },
    database: { type: "number", nullable: true },
    queue: { type: "string", nullable: true },
    url: { type: "string", nullable: true },
  },
  required: ["host", "port", "database", "queue"],
  additionalProperties: true,
};
