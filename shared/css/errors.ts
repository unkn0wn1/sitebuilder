/** A custom-CSS rejection. The message is safe to show: it never includes the source. */
export class CssRejected extends Error {
  readonly line: number
  readonly column: number

  constructor(line: number, column: number, message: string) {
    super(message)
    this.name = 'CssRejected'
    this.line = line > 0 ? line : 1
    this.column = column > 0 ? column : 1
  }
}

/** The line and column a person sees next to the editor. */
export function cssIssueMessage(error: CssRejected): string {
  return `Line ${error.line}, column ${error.column}: ${error.message}`
}
