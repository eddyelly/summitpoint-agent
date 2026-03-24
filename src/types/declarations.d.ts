declare module '@sealsystems/ipp' {
  interface PrinterOptions {
    'operation-attributes-tag': Record<string, string>;
    data?: Buffer;
  }

  interface PrinterInstance {
    execute(
      operation: string,
      msg: PrinterOptions | null,
      callback: (err: any, res: any) => void,
    ): void;
  }

  function Printer(url: string): PrinterInstance;

  export { Printer };
  export default { Printer };
}

declare module 'better-queue-sqlite' {
  interface SqliteStoreOptions {
    path: string;
  }

  class SqliteStore {
    constructor(options: SqliteStoreOptions);
  }

  export = SqliteStore;
}

declare module '@pdf-lib/fontkit' {
  const fontkit: any;
  export default fontkit;
}
