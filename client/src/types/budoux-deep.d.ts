declare module 'budoux/parser' {
  export class Parser {
    constructor(model: Record<string, Record<string, number>>)
    parse(sentence: string): string[]
    parseBoundaries(sentence: string): number[]
  }
}

declare module 'budoux/model-zh-hans' {
  export const model: Record<string, Record<string, number>>
}

declare module 'budoux/model-zh-hant' {
  export const model: Record<string, Record<string, number>>
}
