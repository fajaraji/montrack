/**
 * Buat pasangan kunci VAPID untuk notifikasi Web Push.
 *   npm run vapid
 * Lalu simpan sebagai secret Worker:
 *   npx wrangler secret put VAPID_PUBLIC_KEY
 *   npx wrangler secret put VAPID_PRIVATE_KEY
 */
import { webcrypto } from "node:crypto";

const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey));
const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
console.log(`VAPID_PUBLIC_KEY=${b64u(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
