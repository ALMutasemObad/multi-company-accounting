const randomBytes = () => {
  const bytes = new Uint8Array(16);
  const cryptoSource = globalThis.crypto;
  if (typeof cryptoSource?.getRandomValues === "function") {
    cryptoSource.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytes;
};

export function inventoryClientId() {
  const cryptoSource = globalThis.crypto;
  if (typeof cryptoSource?.randomUUID === "function") return cryptoSource.randomUUID();
  const hex = [...randomBytes()].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export const inventoryRequestKey = (operation: string) => `${operation}-${inventoryClientId()}`;
