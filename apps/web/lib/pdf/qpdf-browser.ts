import { createQpdfRunner } from 'qpdf-run';
import { PDFArray, PDFDict, PDFName } from 'pdf-lib';
import { classifyPdfError, PdfToolError } from './errors.ts';

type QpdfRunner = Awaited<ReturnType<typeof createQpdfRunner>>;

let pooledRunner: QpdfRunner | null = null;
let qpdfMutex: Promise<unknown> = Promise.resolve();

async function getQpdfRunner(): Promise<QpdfRunner> {
  if (typeof window === 'undefined') {
    throw new Error('QPDF WASM can only run in the browser.');
  }
  if (!pooledRunner) {
    const origin = window.location.origin;
    pooledRunner = await createQpdfRunner({
      workerUrl: `${origin}/vendor/qpdf/worker.js`,
      qpdfJsUrl: `${origin}/vendor/qpdf/qpdf.js`,
      wasmUrl: `${origin}/vendor/qpdf/qpdf.wasm`,
      timeoutMs: 120_000,
    });
  }
  return pooledRunner;
}

async function resetQpdfRunner(): Promise<void> {
  if (pooledRunner) {
    await pooledRunner.destroy().catch(() => {});
    pooledRunner = null;
  }
}

async function runQpdfCommand(input: Uint8Array, args: string[]): Promise<Uint8Array> {
  const exec = async () => {
    try {
      const runner = await getQpdfRunner();
      return await runner.runOne({
        input,
        inputName: 'input.pdf',
        outputName: 'output.pdf',
        args,
      });
    } catch (err) {
      await resetQpdfRunner();
      throw err;
    }
  };

  const next = qpdfMutex.then(exec, exec);
  qpdfMutex = next.catch(() => {});
  return next;
}

export interface ProtectPdfOptions {
  userPassword: string;
  ownerPassword?: string;
  keyBits?: 128 | 256;
  allowPrint?: boolean;
  printQuality?: 'full' | 'low' | 'none';
  allowCopy?: boolean;
  allowModify?: boolean;
  allowAnnotate?: boolean;
  allowForm?: boolean;
  allowAssemble?: boolean;
}

export async function protectPdfWithQpdf(
  input: Uint8Array,
  options: ProtectPdfOptions
): Promise<Uint8Array> {
  const userPw = options.userPassword ?? '';
  const ownerPwRaw = options.ownerPassword?.trim() || '';

  if (userPw.length > 0 && userPw.length < 4) {
    throw new PdfToolError('Open password must be at least 4 characters (or leave empty for permissions-only lock).', 'validation');
  }
  if (!userPw && ownerPwRaw.length < 4) {
    throw new PdfToolError('Enter either an Open password or a Permissions (Owner) password (min 4 chars).', 'validation');
  }

  const ownerPw = ownerPwRaw || userPw;
  const bits = String(options.keyBits ?? 256);

  const args: string[] = [
    '--encrypt',
    userPw,
    ownerPw,
    bits,
  ];
  if (bits === '128') {
    args.push('--use-aes=y');
  }

  const printFlag =
    options.printQuality ||
    (options.allowPrint === false ? 'none' : 'full');

  let modifyFlag = 'none';
  if (options.allowModify) {
    modifyFlag = 'all';
  } else if (options.allowAnnotate && options.allowForm && options.allowAssemble) {
    modifyFlag = 'all';
  } else if (options.allowAnnotate) {
    modifyFlag = 'annotate';
  } else if (options.allowForm) {
    modifyFlag = 'form';
  } else if (options.allowAssemble) {
    modifyFlag = 'assembly';
  }

  args.push(
    `--print=${printFlag}`,
    `--modify=${modifyFlag}`,
    `--extract=${options.allowCopy ? 'y' : 'n'}`,
    ...(options.allowAnnotate !== undefined ? [`--annotate=${options.allowAnnotate ? 'y' : 'n'}`] : []),
    ...(options.allowForm !== undefined ? [`--form=${options.allowForm ? 'y' : 'n'}`] : []),
    ...(options.allowAssemble !== undefined ? [`--assemble=${options.allowAssemble ? 'y' : 'n'}`] : []),
    '--',
    'input.pdf',
    'output.pdf'
  );

  try {
    return await runQpdfCommand(input, args);
  } catch (err) {
    throw classifyPdfError(err);
  }
}

export async function unlockPdfWithQpdf(
  input: Uint8Array,
  password: string,
  options?: { stripSignatureLocks?: boolean }
): Promise<Uint8Array> {
  const args: string[] = [
    ...(password ? [`--password=${password}`] : []),
    '--decrypt',
    '--',
    'input.pdf',
    'output.pdf',
  ];

  let decrypted: Uint8Array;
  try {
    decrypted = await runQpdfCommand(input, args);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err || '');
    if (/timeout|init|worker|wasm|fetch|network/i.test(raw)) {
      throw classifyPdfError(err);
    }
    throw new PdfToolError(
      'Incorrect password or unsupported encryption algorithm.',
      'locked'
    );
  }

  if (options?.stripSignatureLocks) {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(decrypted, { updateMetadata: false });
    doc.catalog.delete(PDFName.of('Perms'));
    const acro = doc.catalog.lookup(PDFName.of('AcroForm'));
    if (acro instanceof PDFDict) {
      acro.delete(PDFName.of('SigFlags'));
      const fields = acro.lookup(PDFName.of('Fields'));
      if (fields instanceof PDFArray) {
        const kept: unknown[] = [];
        for (let i = 0; i < fields.size(); i += 1) {
          const ref = fields.get(i);
          const fDict = doc.context.lookup(ref);
          if (fDict instanceof PDFDict && fDict.lookup(PDFName.of('FT')) === PDFName.of('Sig')) {
            doc.context.delete(ref as never);
            continue;
          }
          kept.push(ref);
        }
        acro.set(PDFName.of('Fields'), doc.context.obj(kept as never[]));
      }
    }
    for (const page of doc.getPages()) {
      const annots = page.node.lookup(PDFName.of('Annots'));
      if (annots instanceof PDFArray) {
        const keptAnnots: unknown[] = [];
        for (let i = 0; i < annots.size(); i += 1) {
          const ref = annots.get(i);
          const dict = doc.context.lookup(ref);
          if (dict instanceof PDFDict && dict.lookup(PDFName.of('FT')) === PDFName.of('Sig')) {
            doc.context.delete(ref as never);
            continue;
          }
          keptAnnots.push(ref);
        }
        if (keptAnnots.length === 0) page.node.delete(PDFName.of('Annots'));
        else page.node.set(PDFName.of('Annots'), doc.context.obj(keptAnnots as never[]));
      }
    }
    return await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  }

  return decrypted;
}

export async function compressLosslessWithQpdf(input: Uint8Array): Promise<Uint8Array> {
  return runQpdfCommand(input, [
    '--stream-data=compress',
    '--recompress-flate',
    '--object-streams=generate',
    '--compression-level=9',
    '--',
    'input.pdf',
    'output.pdf',
  ]);
}

export async function purgeOrphanObjectsWithQpdf(input: Uint8Array): Promise<Uint8Array> {
  if (typeof window === 'undefined') return input;
  try {
    return await runQpdfCommand(input, [
      '--object-streams=generate',
      '--',
      'input.pdf',
      'output.pdf',
    ]);
  } catch {
    return input;
  }
}

export async function repairWithQpdf(input: Uint8Array): Promise<Uint8Array> {
  return runQpdfCommand(input, [
    '--object-streams=preserve',
    '--',
    'input.pdf',
    'output.pdf',
  ]);
}
