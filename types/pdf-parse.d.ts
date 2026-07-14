// @types/pdf-parse only declares the package root; the KB route imports the inner
// module ("pdf-parse/lib/pdf-parse.js") to skip pdf-parse's debug harness, which
// tries to read a bundled test PDF and throws in a serverless build.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdf(dataBuffer: Buffer | Uint8Array): Promise<PdfParseResult>;
  export default pdf;
}
