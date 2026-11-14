export async function checksum(contents: string) {
  const bytes = new TextEncoder().encode(contents);
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
