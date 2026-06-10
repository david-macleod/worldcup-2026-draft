// Short ids for the share URLs (worldcup.macleod.in/l/:id/m/:token):
// 8 chars of base62 for both league id and manager token. Internal
// pick/wishlist ids stay UUIDs since they never appear in a URL. Volume is
// tiny, so we don't guard against the astronomically unlikely collision.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export function newId(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}
