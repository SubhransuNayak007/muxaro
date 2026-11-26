import {
  PDFDocument,
  PDFDict,
  PDFHexString,
  PDFString,
  PDFName,
  PDFArray,
  PDFNumber,
} from 'pdf-lib';
import { assertValidPdfFile } from './errors.ts';
import type { PdfSignatureInfo } from './types.ts';

function decodePdfString(val: unknown): string {
  if (!val) return '';
  if (typeof (val as { decodeText?: () => string }).decodeText === 'function') {
    return (val as { decodeText: () => string }).decodeText();
  }
  return String(val).replace(/^\(|\)$/g, '').trim();
}

function hexToBytes(hexStr: string): Uint8Array {
  const clean = hexStr.replace(/^<|>$/g, '').replace(/\s+/g, '');
  const len = Math.floor(clean.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ============================================================================
 * Minimal Strict ASN.1 DER / BER TLV Parser for CMS SignedData & X.509 Certs
 * ============================================================================ */

interface Asn1Node {
  tag: number;
  tagClass: number;
  constructed: boolean;
  headerStart: number;
  contentStart: number;
  contentEnd: number;
  raw: Uint8Array;
  children: Asn1Node[];
}

function parseAsn1(buf: Uint8Array, offset = 0, limit = buf.length): Asn1Node | null {
  if (offset >= limit) return null;
  const headerStart = offset;
  const first = buf[offset++];
  const tagClass = (first >> 6) & 0x03;
  const constructed = (first & 0x20) !== 0;
  let tag = first & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    while (offset < limit) {
      const b = buf[offset++];
      tag = (tag << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
  }
  if (offset >= limit) return null;

  const lenByte = buf[offset++];
  let length = 0;
  let indefinite = false;
  if (lenByte === 0x80) {
    indefinite = true;
  } else if ((lenByte & 0x80) === 0) {
    length = lenByte;
  } else {
    const numOctets = lenByte & 0x7f;
    if (numOctets === 0 || numOctets > 4 || offset + numOctets > limit) return null;
    for (let i = 0; i < numOctets; i += 1) {
      length = (length << 8) | buf[offset++];
    }
  }

  const contentStart = offset;
  let contentEnd = indefinite ? limit : Math.min(limit, contentStart + length);
  const children: Asn1Node[] = [];

  if (constructed || indefinite) {
    let cur = contentStart;
    while (cur < contentEnd) {
      if (indefinite && cur + 1 < limit && buf[cur] === 0x00 && buf[cur + 1] === 0x00) {
        contentEnd = cur + 2;
        break;
      }
      const child = parseAsn1(buf, cur, contentEnd);
      if (!child || child.contentEnd <= cur) break;
      children.push(child);
      cur = child.contentEnd;
    }
  }

  const nodeEnd = indefinite ? contentEnd : Math.min(limit, contentStart + length);
  return {
    tag: first,
    tagClass,
    constructed,
    headerStart,
    contentStart,
    contentEnd: nodeEnd,
    raw: buf.subarray(headerStart, nodeEnd),
    children,
  };
}

function nodeValueBytes(node: Asn1Node): Uint8Array {
  if (!node.constructed) {
    return node.raw.subarray(node.contentStart - node.headerStart, node.contentEnd - node.headerStart);
  }
  const chunks: Uint8Array[] = [];
  for (const ch of node.children) {
    chunks.push(nodeValueBytes(ch));
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

function decodeOid(node: Asn1Node): string {
  const bytes = nodeValueBytes(node);
  if (bytes.length === 0) return '';
  const parts: number[] = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let val = 0;
  for (let i = 1; i < bytes.length; i += 1) {
    const b = bytes[i];
    val = (val << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) {
      parts.push(val);
      val = 0;
    }
  }
  return parts.join('.');
}

function decodeAsn1Text(node: Asn1Node): string {
  const bytes = nodeValueBytes(node);
  if (node.tag === 0x1e) {
    // BMPString UTF-16BE
    let s = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return s;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
}

function decodeAsn1Time(node: Asn1Node): string | undefined {
  const raw = decodeAsn1Text(node);
  if (!raw) return undefined;
  // UTCTime: YYMMDDHHMMSSZ
  if (/^\d{12}Z$/.test(raw)) {
    const yy = Number.parseInt(raw.slice(0, 2), 10);
    const yyyy = yy >= 50 ? 1900 + yy : 2000 + yy;
    return `${yyyy}-${raw.slice(2, 4)}-${raw.slice(4, 6)} ${raw.slice(6, 8)}:${raw.slice(8, 10)}:${raw.slice(10, 12)} UTC`;
  }
  // GeneralizedTime: YYYYMMDDHHMMSSZ
  if (/^\d{14}Z$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)} UTC`;
  }
  return raw;
}

function parseDnName(nameSeq: Asn1Node): { cn?: string; o?: string; dn: string } {
  const parts: string[] = [];
  let cn: string | undefined;
  let o: string | undefined;
  for (const rdn of nameSeq.children) {
    for (const atv of rdn.children) {
      if (atv.children.length < 2) continue;
      const oid = decodeOid(atv.children[0]);
      const val = decodeAsn1Text(atv.children[1]);
      if (!val) continue;
      if (oid === '2.5.4.3') {
        cn = val;
        parts.push(`CN=${val}`);
      } else if (oid === '2.5.4.10') {
        o = val;
        parts.push(`O=${val}`);
      } else if (oid === '2.5.4.6') {
        parts.push(`C=${val}`);
      }
    }
  }
  return { cn, o, dn: parts.join(', ') };
}

interface ParsedX509Cert {
  subject: string;
  subjectCn?: string;
  subjectOrg?: string;
  issuer: string;
  issuerCn?: string;
  serialNumber: string;
  validFrom?: string;
  validTo?: string;
  spkiDer: Uint8Array;
  spkiAlgOid: string;
  isSelfSigned: boolean;
}

function parseX509Cert(certNode: Asn1Node): ParsedX509Cert | null {
  if (certNode.children.length < 3) return null;
  const tbs = certNode.children[0];
  let idx = 0;
  // Optional [0] EXPLICIT version
  if (tbs.children[idx]?.tag === 0xa0) idx += 1;
  const serialNode = tbs.children[idx++];
  idx += 1; // signature alg
  const issuerNode = tbs.children[idx++];
  const validityNode = tbs.children[idx++];
  const subjectNode = tbs.children[idx++];
  const spkiNode = tbs.children[idx++];
  if (!serialNode || !issuerNode || !validityNode || !subjectNode || !spkiNode) return null;

  const issuerParsed = parseDnName(issuerNode);
  const subjectParsed = parseDnName(subjectNode);
  const validFrom = validityNode.children[0] ? decodeAsn1Time(validityNode.children[0]) : undefined;
  const validTo = validityNode.children[1] ? decodeAsn1Time(validityNode.children[1]) : undefined;
  const spkiAlgOid = spkiNode.children[0]?.children[0] ? decodeOid(spkiNode.children[0].children[0]) : '';

  return {
    subject: subjectParsed.dn || subjectParsed.cn || 'Embedded X.509 Signer',
    subjectCn: subjectParsed.cn,
    subjectOrg: subjectParsed.o,
    issuer: issuerParsed.dn || issuerParsed.cn || 'Unknown Issuer',
    issuerCn: issuerParsed.cn,
    serialNumber: bytesToHex(nodeValueBytes(serialNode)).toUpperCase(),
    validFrom,
    validTo,
    spkiDer: certNode.raw.length > 0 ? spkiNode.raw : new Uint8Array(0),
    spkiAlgOid,
    isSelfSigned:
      Boolean(subjectParsed.dn && issuerParsed.dn && subjectParsed.dn === issuerParsed.dn),
  };
}

function digestOidToWebCrypto(oid: string): 'SHA-256' | 'SHA-384' | 'SHA-512' | 'SHA-1' {
  switch (oid) {
    case '2.16.840.1.101.3.4.2.2':
      return 'SHA-384';
    case '2.16.840.1.101.3.4.2.3':
      return 'SHA-512';
    case '1.3.14.3.2.26':
      return 'SHA-1';
    case '2.16.840.1.101.3.4.2.1':
    default:
      return 'SHA-256';
  }
}

function encodeDerLength(len: number): Uint8Array {
  if (len < 128) return new Uint8Array([len]);
  const bytes: number[] = [];
  let v = len;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function retagSignedAttrsAsSet(signedAttrsNode: Asn1Node): Uint8Array {
  // Replace implicit [0] (0xa0) with ASN.1 SET OF (0x31) over concatenated attribute DER children
  const childParts = signedAttrsNode.children.map((c) => c.raw);
  const totalLen = childParts.reduce((s, p) => s + p.length, 0);
  const lenBytes = encodeDerLength(totalLen);
  const out = new Uint8Array(1 + lenBytes.length + totalLen);
  out[0] = 0x31;
  out.set(lenBytes, 1);
  let p = 1 + lenBytes.length;
  for (const part of childParts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

interface CmsInspection {
  digestAlgorithm: 'SHA-256' | 'SHA-384' | 'SHA-512' | 'SHA-1';
  embeddedMessageDigest: Uint8Array | null;
  signedAttrsSetDer: Uint8Array | null;
  signatureBytes: Uint8Array | null;
  signatureAlgOid: string;
  signingTime?: string;
  hasTimestamp: boolean;
  cert: ParsedX509Cert | null;
}

function inspectCmsSignedData(cmsBytes: Uint8Array): CmsInspection | null {
  // Trim trailing zero padding typical in /Contents
  let end = cmsBytes.length;
  while (end > 0 && cmsBytes[end - 1] === 0) end -= 1;
  if (end < 16) return null;

  const root = parseAsn1(cmsBytes, 0, end);
  if (!root || root.children.length < 2) return null;

  // ContentInfo -> [0] EXPLICIT SignedData
  const contentWrapper = root.children[1];
  const signedData = contentWrapper.tag === 0xa0 ? contentWrapper.children[0] : contentWrapper;
  if (!signedData || signedData.children.length < 4) return null;

  const certs: ParsedX509Cert[] = [];
  let signerInfosNode: Asn1Node | null = null;
  let topDigestAlg: 'SHA-256' | 'SHA-384' | 'SHA-512' | 'SHA-1' = 'SHA-256';

  for (const child of signedData.children) {
    if (child.tag === 0xa0) {
      // certificates [0] IMPLICIT CertificateSet
      for (const certNode of child.children) {
        const parsed = parseX509Cert(certNode);
        if (parsed) certs.push(parsed);
      }
    } else if (child.tag === 0x31 && child.children.length > 0) {
      // Distinguish digestAlgorithms SET vs signerInfos SET
      const first = child.children[0];
      if (first.tag === 0x30 && first.children[0]?.tag === 0x06) {
        topDigestAlg = digestOidToWebCrypto(decodeOid(first.children[0]));
      } else if (first.tag === 0x30 && first.children[0]?.tag === 0x02) {
        signerInfosNode = child;
      }
    }
  }

  const signerInfo = signerInfosNode?.children[0];
  if (!signerInfo || signerInfo.children.length < 5) {
    return {
      digestAlgorithm: topDigestAlg,
      embeddedMessageDigest: null,
      signedAttrsSetDer: null,
      signatureBytes: null,
      signatureAlgOid: '',
      hasTimestamp: false,
      cert: certs[0] || null,
    };
  }

  let sIdx = 1; // skip version
  const sidNode = signerInfo.children[sIdx++]; // IssuerAndSerialNumber or SubjectKeyIdentifier
  const digestAlgNode = signerInfo.children[sIdx++];
  const digestAlg = digestAlgNode?.children[0]
    ? digestOidToWebCrypto(decodeOid(digestAlgNode.children[0]))
    : topDigestAlg;

  let signedAttrsNode: Asn1Node | null = null;
  if (signerInfo.children[sIdx]?.tag === 0xa0) {
    signedAttrsNode = signerInfo.children[sIdx++];
  }

  const sigAlgNode = signerInfo.children[sIdx++];
  const signatureAlgOid = sigAlgNode?.children[0] ? decodeOid(sigAlgNode.children[0]) : '';
  const sigOctetNode = signerInfo.children[sIdx++];
  const signatureBytes = sigOctetNode ? nodeValueBytes(sigOctetNode) : null;

  let hasTimestamp = false;
  if (signerInfo.children[sIdx]?.tag === 0xa1) {
    const unsignedAttrs = signerInfo.children[sIdx];
    for (const attr of unsignedAttrs.children) {
      const oid = attr.children[0] ? decodeOid(attr.children[0]) : '';
      if (oid === '1.2.840.113549.1.9.16.2.14') hasTimestamp = true;
    }
  }

  let embeddedMessageDigest: Uint8Array | null = null;
  let signingTime: string | undefined;
  let signedAttrsSetDer: Uint8Array | null = null;

  if (signedAttrsNode) {
    signedAttrsSetDer = retagSignedAttrsAsSet(signedAttrsNode);
    for (const attr of signedAttrsNode.children) {
      if (attr.children.length < 2) continue;
      const oid = decodeOid(attr.children[0]);
      const valSet = attr.children[1];
      if (oid === '1.2.840.113549.1.9.4' && valSet.children[0]) {
        embeddedMessageDigest = nodeValueBytes(valSet.children[0]);
      } else if (oid === '1.2.840.113549.1.9.5' && valSet.children[0]) {
        signingTime = decodeAsn1Time(valSet.children[0]);
      }
    }
  }

  // Match signer certificate by serial number when possible
  let matchedCert: ParsedX509Cert | null = certs[0] || null;
  if (sidNode && sidNode.tag === 0x30 && sidNode.children.length >= 2) {
    const targetSerial = bytesToHex(nodeValueBytes(sidNode.children[1])).toUpperCase();
    const found = certs.find((c) => c.serialNumber === targetSerial);
    if (found) matchedCert = found;
  }

  return {
    digestAlgorithm: digestAlg,
    embeddedMessageDigest,
    signedAttrsSetDer,
    signatureBytes,
    signatureAlgOid,
    signingTime,
    hasTimestamp,
    cert: matchedCert,
  };
}

async function verifyCmsCryptographicSignature(
  cms: CmsInspection,
  signedPayload: Uint8Array
): Promise<boolean | null> {
  if (
    typeof crypto === 'undefined' ||
    !crypto.subtle ||
    !cms.cert ||
    cms.cert.spkiDer.length === 0 ||
    !cms.signatureBytes
  ) {
    return null;
  }

  const hashAlg = cms.digestAlgorithm;
  if (hashAlg === 'SHA-1') {
    // WebCrypto deprecates SHA-1 verification in many runtimes; fall back gracefully
    return null;
  }

  const dataToVerify = cms.signedAttrsSetDer ?? signedPayload;
  const spkiCopy = new Uint8Array(cms.cert.spkiDer);
  const sigCopy = new Uint8Array(cms.signatureBytes);
  const dataCopy = new Uint8Array(dataToVerify);

  try {
    // RSA PKCS#1 v1.5
    if (
      cms.cert.spkiAlgOid === '1.2.840.113549.1.1.1' ||
      cms.signatureAlgOid.startsWith('1.2.840.113549.1.1.')
    ) {
      const key = await crypto.subtle.importKey(
        'spki',
        spkiCopy,
        { name: 'RSASSA-PKCS1-v1_5', hash: hashAlg },
        false,
        ['verify']
      );
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sigCopy, dataCopy);
    }

    // ECDSA (ANSI X9.62 / P-256 / P-384 / P-521)
    if (
      cms.cert.spkiAlgOid === '1.2.840.10045.2.1' ||
      cms.signatureAlgOid.startsWith('1.2.840.10045.4.')
    ) {
      const namedCurve = hashAlg === 'SHA-384' ? 'P-384' : hashAlg === 'SHA-512' ? 'P-521' : 'P-256';
      const key = await crypto.subtle.importKey(
        'spki',
        spkiCopy,
        { name: 'ECDSA', namedCurve },
        false,
        ['verify']
      );
      // Convert ASN.1 DER ECDSA signature (SEQUENCE { r INTEGER, s INTEGER }) to IEEE P1363 raw (r || s)
      const seq = parseAsn1(sigCopy, 0, sigCopy.length);
      if (seq && seq.children.length === 2) {
        const coordSize = namedCurve === 'P-256' ? 32 : namedCurve === 'P-384' ? 48 : 66;
        const padCoord = (raw: Uint8Array) => {
          const trimmed = raw[0] === 0 && raw.length > coordSize ? raw.subarray(raw.length - coordSize) : raw;
          const out = new Uint8Array(coordSize);
          out.set(trimmed.subarray(Math.max(0, trimmed.length - coordSize)), Math.max(0, coordSize - trimmed.length));
          return out;
        };
        const rawSig = new Uint8Array(coordSize * 2);
        rawSig.set(padCoord(nodeValueBytes(seq.children[0])), 0);
        rawSig.set(padCoord(nodeValueBytes(seq.children[1])), coordSize);
        return await crypto.subtle.verify({ name: 'ECDSA', hash: hashAlg }, key, rawSig, dataCopy);
      }
    }
  } catch {
    return null;
  }

  return null;
}

function collectSignatureFields(doc: PDFDocument): Array<{ fieldName: string; vDict: PDFDict }> {
  const found: Array<{ fieldName: string; vDict: PDFDict }> = [];
  const seenVDicts = new Set<PDFDict>();

  const inspectFieldDict = (dict: PDFDict) => {
    const ft = dict.lookup(PDFName.of('FT'));
    if (ft === PDFName.of('Sig')) {
      const vDict = dict.lookup(PDFName.of('V'));
      if (vDict instanceof PDFDict && !seenVDicts.has(vDict)) {
        seenVDicts.add(vDict);
        const fieldName = decodePdfString(dict.lookup(PDFName.of('T'))) || `Signature ${found.length + 1}`;
        found.push({ fieldName, vDict });
      }
    }
    const kids = dict.lookup(PDFName.of('Kids'));
    if (kids instanceof PDFArray) {
      for (let i = 0; i < kids.size(); i += 1) {
        const kid = kids.lookup(i);
        if (kid instanceof PDFDict) inspectFieldDict(kid);
      }
    }
  };

  const acroForm = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (acroForm instanceof PDFDict) {
    const fields = acroForm.lookup(PDFName.of('Fields'));
    if (fields instanceof PDFArray) {
      for (let i = 0; i < fields.size(); i += 1) {
        const f = fields.lookup(i);
        if (f instanceof PDFDict) inspectFieldDict(f);
      }
    }
  }

  // Also scan page /Annots for detached Widget signature annotations
  try {
    for (const page of doc.getPages()) {
      const annots = page.node.lookup(PDFName.of('Annots'));
      if (annots instanceof PDFArray) {
        for (let i = 0; i < annots.size(); i += 1) {
          const annot = annots.lookup(i);
          if (annot instanceof PDFDict) inspectFieldDict(annot);
        }
      }
    }
  } catch {
    // Fallback gracefully on synthetic/malformed docs lacking /Pages tree
  }

  return found;
}

/**
 * Pure-browser WebCrypto + ASN.1 DER CMS/PKCS#7 PDF Signature Inspector & Cryptographic Verifier.
 */
export async function verifyPdfSignaturesInBrowser(file: File): Promise<PdfSignatureInfo[]> {
  await assertValidPdfFile(file);
  const rawBytes = new Uint8Array(await file.arrayBuffer());
  const doc = await PDFDocument.load(rawBytes, { ignoreEncryption: true });

  const sigFields = collectSignatureFields(doc);
  const results: PdfSignatureInfo[] = [];

  for (const { fieldName, vDict } of sigFields) {
    const subFilter = vDict.lookup(PDFName.of('SubFilter'))?.toString().replace(/^\//, '') || 'Unknown';
    const reason = decodePdfString(vDict.lookup(PDFName.of('Reason'))) || undefined;
    const location = decodePdfString(vDict.lookup(PDFName.of('Location'))) || undefined;
    const signingTimeDict = decodePdfString(vDict.lookup(PDFName.of('M'))) || undefined;
    const nameHint = decodePdfString(vDict.lookup(PDFName.of('Name')));

    const brArr = vDict.lookup(PDFName.of('ByteRange'));
    let byteRange: [number, number, number, number] | null = null;
    if (brArr instanceof PDFArray && brArr.size() === 4) {
      const nums = [0, 1, 2, 3].map((idx) => {
        const n = brArr.lookup(idx);
        return n instanceof PDFNumber ? n.asNumber() : -1;
      });
      if (nums.every((n) => n >= 0)) {
        byteRange = [nums[0], nums[1], nums[2], nums[3]];
      }
    }

    const contentsVal = vDict.lookup(PDFName.of('Contents'));
    let contentsBytes: Uint8Array = new Uint8Array(0);
    if (contentsVal instanceof PDFHexString) {
      contentsBytes = hexToBytes(contentsVal.asString());
    } else if (contentsVal instanceof PDFString) {
      const rawStr = contentsVal.asString();
      contentsBytes = new Uint8Array(rawStr.length);
      for (let k = 0; k < rawStr.length; k += 1) {
        contentsBytes[k] = rawStr.charCodeAt(k) & 0xff;
      }
    }

    const cms = contentsBytes.length > 0 ? inspectCmsSignedData(contentsBytes) : null;
    const cert = cms?.cert ?? null;

    const validByteRange =
      byteRange !== null &&
      byteRange[0] === 0 &&
      byteRange[0] + byteRange[1] < byteRange[2] &&
      byteRange[2] + byteRange[3] <= rawBytes.length;

    const byteRangeCoversWholeFile =
      validByteRange && byteRange !== null && byteRange[2] + byteRange[3] === rawBytes.length;
    const hasLaterRevisions =
      validByteRange && byteRange !== null && byteRange[2] + byteRange[3] < rawBytes.length;

    let digestValid: boolean | null = null;
    let cryptographicValid: boolean | null = null;
    let notes = 'PKCS#7 / CMS signature dictionary inspected.';

    if (byteRange && validByteRange && typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const part1 = rawBytes.slice(byteRange[0], byteRange[0] + byteRange[1]);
        const part2 = rawBytes.slice(byteRange[2], byteRange[2] + byteRange[3]);
        const signedPayload = new Uint8Array(part1.length + part2.length);
        signedPayload.set(part1, 0);
        signedPayload.set(part2, part1.length);

        const webCryptoAlg = cms?.digestAlgorithm || 'SHA-256';
        const computedDigest = new Uint8Array(await crypto.subtle.digest(webCryptoAlg, signedPayload));

        if (cms?.embeddedMessageDigest) {
          digestValid = bytesToHex(computedDigest) === bytesToHex(cms.embeddedMessageDigest);
        } else if (subFilter.includes('RFC3161')) {
          digestValid = null;
          notes = 'RFC 3161 document timestamp token detected.';
        } else {
          digestValid = false;
          notes = 'CMS SignedAttributes missing messageDigest (1.2.840.113549.1.9.4).';
        }

        if (digestValid === true && cms) {
          cryptographicValid = await verifyCmsCryptographicSignature(cms, signedPayload);
          if (cryptographicValid === false) {
            digestValid = false;
            notes = 'Document digest matched SignedAttributes, but asymmetric cryptographic signature verification FAILED.';
          } else if (cryptographicValid === true) {
            notes = hasLaterRevisions
              ? `Cryptographic ${webCryptoAlg} signature valid for its signed revision; subsequent incremental updates were appended.`
              : `Cryptographic ${webCryptoAlg} signature verified over full ByteRange.${cert?.isSelfSigned ? ' (Self-signed certificate — identity not CA-verified.)' : ''}`;
          } else {
            notes = hasLaterRevisions
              ? `${webCryptoAlg} revision digest matches SignedAttributes; subsequent incremental updates appended.`
              : `${webCryptoAlg} digest matches CMS SignedAttributes over full ByteRange.`;
          }
        } else if (digestValid === false && !notes.includes('FAILED')) {
          notes = `${webCryptoAlg} ByteRange hash mismatch — signed content was altered after signing.`;
        }
      } catch {
        digestValid = null;
      }
    } else if (byteRange && !validByteRange) {
      digestValid = false;
      notes = 'Invalid /ByteRange bounds exceed file length or overlap /Contents.';
    }

    results.push({
      fieldName,
      signerName: nameHint || cert?.subjectCn || cert?.subjectOrg || 'Embedded X.509 Signer',
      issuer: cert?.issuerCn || cert?.issuer || (cert?.isSelfSigned ? 'Self-signed certificate' : 'Unknown Issuer'),
      reason,
      location,
      signingTime: signingTimeDict || cms?.signingTime,
      subFilter,
      digestAlgorithm: cms?.digestAlgorithm || 'SHA-256',
      byteRange,
      byteRangeCoversWholeFile,
      hasLaterRevisions,
      digestValid,
      cryptographicValid,
      isSelfSigned: cert?.isSelfSigned,
      serialNumber: cert?.serialNumber,
      validFrom: cert?.validFrom,
      validTo: cert?.validTo,
      hasTimestamp: cms?.hasTimestamp,
      status:
        digestValid === true && cryptographicValid !== false
          ? 'valid-integrity'
          : digestValid === false || cryptographicValid === false
          ? 'tampered'
          : 'unverifiable',
      notes,
    });
  }

  return results;
}
