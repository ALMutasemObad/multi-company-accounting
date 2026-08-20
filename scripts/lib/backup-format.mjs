import { createHash, createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { createReadStream } from "node:fs";
import { Transform } from "node:stream";

const MAGIC = Buffer.from("MCAP-BACKUP-1\n", "ascii");
const SALT_BYTES = 16;
const NONCE_PREFIX_BYTES = 8;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + NONCE_PREFIX_BYTES;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

const deriveKey = (passphrase, salt) =>
  scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export const validateBackupPassphrase = (value) => {
  if (typeof value !== "string" || value.length < 32) {
    throw new Error("BACKUP_ENCRYPTION_PASSPHRASE must contain at least 32 characters");
  }
  return value;
};
const frameNonce = (prefix, counter) => {
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce, 0);
  nonce.writeUInt32BE(counter, NONCE_PREFIX_BYTES);
  return nonce;
};

const frameAad = (header, counter) => {
  const encodedCounter = Buffer.alloc(4);
  encodedCounter.writeUInt32BE(counter);
  return Buffer.concat([header, encodedCounter]);
};

export class BackupEncryptTransform extends Transform {
  constructor(passphrase) {
    super();
    validateBackupPassphrase(passphrase);
    const salt = randomBytes(SALT_BYTES);
    this.noncePrefix = randomBytes(NONCE_PREFIX_BYTES);
    this.header = Buffer.concat([MAGIC, salt, this.noncePrefix]);
    this.key = deriveKey(passphrase, salt);
    this.counter = 0;
    this.headerWritten = false;
  }

  writeHeader() {
    if (!this.headerWritten) {
      this.push(this.header);
      this.headerWritten = true;
    }
  }

  _transform(chunk, _encoding, callback) {
    try {
      this.writeHeader();
      if (chunk.length === 0) {
        callback();
        return;
      }
      if (chunk.length > MAX_FRAME_BYTES) {
        throw new Error("Backup encryption frame is too large");
      }
      if (this.counter > 0xffffffff) {
        throw new Error("Backup contains too many encryption frames");
      }

      const cipher = createCipheriv("aes-256-gcm", this.key, frameNonce(this.noncePrefix, this.counter));
      cipher.setAAD(frameAad(this.header, this.counter));
      const ciphertext = Buffer.concat([cipher.update(chunk), cipher.final()]);
      const frameHeader = Buffer.alloc(4 + TAG_BYTES);
      frameHeader.writeUInt32BE(ciphertext.length);
      cipher.getAuthTag().copy(frameHeader, 4);
      this.push(frameHeader);
      this.push(ciphertext);
      this.counter += 1;
      callback();
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback) {
    try {
      this.writeHeader();
      this.push(Buffer.alloc(4));
      this.key.fill(0);
      callback();
    } catch (error) {
      callback(error);
    }
  }
}

export class BackupDecryptTransform extends Transform {
  constructor(passphrase) {
    super();
    validateBackupPassphrase(passphrase);
    this.passphrase = passphrase;
    this.buffer = Buffer.alloc(0);
    this.header = null;
    this.noncePrefix = null;
    this.key = null;
    this.counter = 0;
    this.done = false;
  }

  _transform(chunk, _encoding, callback) {
    try {
      if (this.done && chunk.length > 0) {
        throw new Error("Encrypted backup contains data after its final frame");
      }
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processFrames();
      callback();
    } catch (error) {
      callback(error);
    }
  }

  processFrames() {
    if (!this.header) {
      if (this.buffer.length < HEADER_BYTES) return;
      this.header = this.buffer.subarray(0, HEADER_BYTES);
      if (!this.header.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error("Unsupported or corrupt backup format");
      }
      const salt = this.header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
      this.noncePrefix = this.header.subarray(MAGIC.length + SALT_BYTES, HEADER_BYTES);
      this.key = deriveKey(this.passphrase, salt);
      this.passphrase = null;
      this.buffer = this.buffer.subarray(HEADER_BYTES);
    }

    while (!this.done) {
      if (this.buffer.length < 4) return;
      const length = this.buffer.readUInt32BE(0);
      if (length === 0) {
        this.done = true;
        this.buffer = this.buffer.subarray(4);
        if (this.buffer.length > 0) throw new Error("Encrypted backup contains trailing data");
        this.key.fill(0);
        return;
      }
      if (length > MAX_FRAME_BYTES) throw new Error("Encrypted backup frame is invalid");
      if (this.buffer.length < 4 + TAG_BYTES + length) return;

      const tag = this.buffer.subarray(4, 4 + TAG_BYTES);
      const ciphertext = this.buffer.subarray(4 + TAG_BYTES, 4 + TAG_BYTES + length);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        frameNonce(this.noncePrefix, this.counter),
      );
      decipher.setAAD(frameAad(this.header, this.counter));
      decipher.setAuthTag(tag);
      this.push(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
      this.buffer = this.buffer.subarray(4 + TAG_BYTES + length);
      this.counter += 1;
    }
  }

  _flush(callback) {
    try {
      this.processFrames();
      if (!this.done || this.buffer.length !== 0) {
        throw new Error("Encrypted backup is truncated");
      }
      callback();
    } catch (error) {
      if (this.key) this.key.fill(0);
      callback(error);
    }
  }
}

export const sha256File = async (filePath) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
};
