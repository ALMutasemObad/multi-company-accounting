import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import test from "node:test";
import { BackupDecryptTransform, BackupEncryptTransform } from "../lib/backup-format.mjs";
import { parseMysqlUrl } from "../lib/mysql-tools.mjs";

const passphrase = "test-only-passphrase-with-more-than-32-characters";

const collect = async (...streams) => {
  const chunks = [];
  await pipeline(
    ...streams,
    new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } }),
  );
  return Buffer.concat(chunks);
};

test("encrypted backup frames round-trip fragmented binary data", async () => {
  const input = Buffer.concat([
    Buffer.from("النظام المحاسبي متعدد الشركات\n", "utf8"),
    Buffer.alloc(256 * 1024, 0xa5),
    Buffer.from([0, 1, 2, 255]),
  ]);
  const encrypted = await collect(Readable.from([input.subarray(0, 17), input.subarray(17)]), new BackupEncryptTransform(passphrase));
  const fragments = [];
  for (let offset = 0; offset < encrypted.length; offset += 37) fragments.push(encrypted.subarray(offset, offset + 37));
  const decrypted = await collect(Readable.from(fragments), new BackupDecryptTransform(passphrase));
  assert.deepEqual(decrypted, input);
});
test("encrypted backup rejects a wrong passphrase and truncation", async () => {
  const encrypted = await collect(Readable.from([Buffer.from("protected")]), new BackupEncryptTransform(passphrase));
  await assert.rejects(
    collect(Readable.from([encrypted]), new BackupDecryptTransform("different-passphrase-with-more-than-32-characters")),
  );
  await assert.rejects(
    collect(Readable.from([encrypted.subarray(0, -7)]), new BackupDecryptTransform(passphrase)),
    /truncated/,
  );
});

test("MySQL URL parsing decodes credentials without accepting unsafe database names", () => {
  assert.deepEqual(parseMysqlUrl("mysql://user:p%40ss@127.0.0.1:3307/mcap_test"), {
    host: "127.0.0.1",
    port: "3307",
    user: "user",
    password: "p@ss",
    database: "mcap_test",
  });
  assert.throws(() => parseMysqlUrl("mysql://user:pass@localhost/unsafe-name"), /safe database name/);
});
