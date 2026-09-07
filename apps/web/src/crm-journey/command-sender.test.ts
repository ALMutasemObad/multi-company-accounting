import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api";
import { createCrmCommandSender } from "./command-sender";

vi.mock("../api", () => ({ api: vi.fn(), idempotencyKey: () => `crm-command-${crypto.randomUUID()}` }));
beforeEach(() => { vi.mocked(api).mockReset(); });
const command = (body = JSON.stringify({ displayName: "عميل عربي" })) => ({ method: "POST" as const, signal: new AbortController().signal, body });

it("reuses an unchanged failed command's key without placing Arabic text in the header", async () => {
  const send = createCrmCommandSender();
  vi.mocked(api).mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce({});
  await expect(send("/crm/leads", command())).rejects.toThrow("network");
  await send("/crm/leads", command());
  const keys = vi.mocked(api).mock.calls.map(([, options]) => options?.idempotencyKey);
  expect(keys[0]).toBe(keys[1]);
  expect(() => new Headers({ "Idempotency-Key": keys[0]! })).not.toThrow();
});

it("uses a new key for edited input and for a new company workspace", async () => {
  const send = createCrmCommandSender();
  vi.mocked(api).mockRejectedValue(new TypeError("network"));
  await send("/crm/leads", command()).catch(() => {});
  await send("/crm/leads", command('{"displayName":"changed"}')).catch(() => {});
  await createCrmCommandSender()("/crm/leads", command()).catch(() => {});
  expect(new Set(vi.mocked(api).mock.calls.map(([, options]) => options?.idempotencyKey)).size).toBe(3);
});

it("releases the key after confirmed success so a later deliberate command is new", async () => {
  const send = createCrmCommandSender();
  vi.mocked(api).mockResolvedValue({});
  await send("/crm/activities", command());
  await send("/crm/activities", command());
  const keys = vi.mocked(api).mock.calls.map(([, options]) => options?.idempotencyKey);
  expect(keys[0]).not.toBe(keys[1]);
});
