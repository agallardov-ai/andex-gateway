/**
 * Pure Node.js self-signed certificate generator.
 * NO external dependencies (no openssl binary, no npm packages).
 * Works on Windows, macOS, and Linux.
 *
 * Uses crypto.generateKeyPairSync + manual ASN.1/DER construction
 * to create an X.509 v3 self-signed certificate with SAN extension.
 */

import crypto from 'crypto';

// ───── ASN.1 DER helpers ─────

function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let tmp = len;
  while (tmp > 0) {
    bytes.unshift(tmp & 0xff);
    tmp >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derSequence(...items: Buffer[]): Buffer {
  const body = Buffer.concat(items);
  return Buffer.concat([Buffer.from([0x30]), encodeLength(body.length), body]);
}

function derSet(...items: Buffer[]): Buffer {
  const body = Buffer.concat(items);
  return Buffer.concat([Buffer.from([0x31]), encodeLength(body.length), body]);
}

function derOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const encoded: number[] = [40 * parts[0] + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i];
    if (val < 128) {
      encoded.push(val);
    } else {
      const localBytes: number[] = [];
      localBytes.push(val & 0x7f);
      val >>= 7;
      while (val > 0) {
        localBytes.push(0x80 | (val & 0x7f));
        val >>= 7;
      }
      localBytes.reverse();
      encoded.push(...localBytes);
    }
  }
  const body = Buffer.from(encoded);
  return Buffer.concat([Buffer.from([0x06]), encodeLength(body.length), body]);
}

function derInteger(value: Buffer | number): Buffer {
  let buf: Buffer;
  if (typeof value === 'number') {
    if (value === 0) {
      buf = Buffer.from([0]);
    } else {
      const bytes: number[] = [];
      let v = value;
      while (v > 0) {
        bytes.unshift(v & 0xff);
        v >>= 8;
      }
      if (bytes[0] & 0x80) bytes.unshift(0);
      buf = Buffer.from(bytes);
    }
  } else {
    buf = value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value;
  }
  return Buffer.concat([Buffer.from([0x02]), encodeLength(buf.length), buf]);
}

function derBitString(data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from([0x00]), data]);
  return Buffer.concat([Buffer.from([0x03]), encodeLength(body.length), body]);
}

function derOctetString(data: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x04]), encodeLength(data.length), data]);
}

function derUtf8String(str: string): Buffer {
  const buf = Buffer.from(str, 'utf-8');
  return Buffer.concat([Buffer.from([0x0c]), encodeLength(buf.length), buf]);
}

function derUtcTime(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = date.getUTCFullYear() % 100;
  const mo = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const h = date.getUTCHours();
  const mi = date.getUTCMinutes();
  const s = date.getUTCSeconds();
  const str = pad(y) + pad(mo) + pad(d) + pad(h) + pad(mi) + pad(s) + 'Z';
  const buf = Buffer.from(str, 'ascii');
  return Buffer.concat([Buffer.from([0x17]), encodeLength(buf.length), buf]);
}

function derExplicit(tag: number, data: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0xa0 | tag]), encodeLength(data.length), data]);
}

// ───── Certificate construction ─────

const OID_CN = '2.5.4.3';
const OID_ORG = '2.5.4.10';
const OID_SHA256_RSA = '1.2.840.113549.1.1.11';
const OID_SAN = '2.5.29.17';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';

function buildRdnSequence(cn: string, org: string): Buffer {
  return derSequence(
    derSet(derSequence(derOid(OID_CN), derUtf8String(cn))),
    derSet(derSequence(derOid(OID_ORG), derUtf8String(org)))
  );
}

function buildSanExtension(dnsNames: string[], ips: string[]): Buffer {
  const entries: Buffer[] = [];

  for (const dns of dnsNames) {
    const buf = Buffer.from(dns, 'ascii');
    entries.push(Buffer.concat([Buffer.from([0x82]), encodeLength(buf.length), buf]));
  }

  for (const ip of ips) {
    if (ip.includes(':')) {
      // IPv6
      const bytes = Buffer.alloc(16);
      if (ip === '::1') {
        bytes[15] = 1;
      }
      entries.push(Buffer.concat([Buffer.from([0x87]), encodeLength(bytes.length), bytes]));
    } else {
      // IPv4
      const parts = ip.split('.').map(Number);
      const buf = Buffer.from(parts);
      entries.push(Buffer.concat([Buffer.from([0x87]), encodeLength(buf.length), buf]));
    }
  }

  const sanValue = derSequence(...entries);
  return derSequence(
    derOid(OID_SAN),
    derOctetString(sanValue)
  );
}

function extractPublicKeyDer(publicKeyPem: string): Buffer {
  const b64 = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');
  return Buffer.from(b64, 'base64');
}

export interface CertResult {
  key: string;
  cert: string;
}

/**
 * Generate a self-signed certificate using only Node.js built-in crypto.
 * No openssl binary or npm packages required.
 */
export function generateSelfSignedCertNative(opts?: {
  cn?: string;
  org?: string;
  days?: number;
  dnsNames?: string[];
  ips?: string[];
}): CertResult {
  const cn = opts?.cn ?? 'localhost';
  const org = opts?.org ?? 'Andex Gateway';
  const days = opts?.days ?? 825;
  const dnsNames = opts?.dnsNames ?? ['localhost'];
  const ips = opts?.ips ?? ['127.0.0.1', '::1'];

  // 1. Generate RSA key pair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // 2. Build TBS (To Be Signed) Certificate
  const serialNumber = crypto.randomBytes(16);
  serialNumber[0] &= 0x7f; // ensure positive

  const now = new Date();
  const notAfter = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const signatureAlgorithm = derSequence(
    derOid(OID_SHA256_RSA),
    Buffer.from([0x05, 0x00]) // NULL
  );

  const issuer = buildRdnSequence(cn, org);
  const subject = buildRdnSequence(cn, org); // self-signed
  const validity = derSequence(derUtcTime(now), derUtcTime(notAfter));
  const publicKeyDer = extractPublicKeyDer(publicKey);

  // Extensions
  const sanExt = buildSanExtension(dnsNames, ips);
  const basicConstraintsExt = derSequence(
    derOid(OID_BASIC_CONSTRAINTS),
    derOctetString(derSequence()) // CA: FALSE
  );
  const extensions = derExplicit(3, derSequence(sanExt, basicConstraintsExt));

  // subjectPublicKeyInfo is the raw SPKI DER (already a SEQUENCE)
  const tbsCertificate = derSequence(
    derExplicit(0, derInteger(2)),   // version: v3
    derInteger(serialNumber),         // serial number
    signatureAlgorithm,               // signature algorithm
    issuer,                           // issuer
    validity,                         // validity
    subject,                          // subject
    publicKeyDer,                     // subjectPublicKeyInfo (raw SPKI)
    extensions                        // extensions
  );

  // 3. Sign the TBS certificate
  const signer = crypto.createSign('SHA256');
  signer.update(tbsCertificate);
  const signature = signer.sign(privateKey);

  // 4. Build final certificate
  const certificate = derSequence(
    tbsCertificate,
    signatureAlgorithm,
    derBitString(signature)
  );

  // 5. Encode as PEM
  const b64Lines = certificate.toString('base64').match(/.{1,64}/g) || [];
  const certPem = '-----BEGIN CERTIFICATE-----\n' +
    b64Lines.join('\n') +
    '\n-----END CERTIFICATE-----\n';

  return { key: privateKey, cert: certPem };
}
