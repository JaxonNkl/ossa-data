export async function boundedText(response, limit) {
  if (!response.body) throw Error("Empty response");
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error("Payload too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  if (!size) throw Error("Empty response");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}
