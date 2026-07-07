import { StreamLanguage, type StreamParser } from '@codemirror/language';

interface DbmlState {
  inSettings: boolean;
  inBlockComment: boolean;
  inTripleString: boolean;
  afterBlockKeyword: boolean;
}

const BLOCK_KEYWORDS = /^(Table|Ref|Enum|TableGroup|Project|Note|indexes)\b/i;
const INLINE_KEYWORDS = /^(as|note)\b/i;

export const dbmlTokenizer: StreamParser<DbmlState> = {
  startState: () => ({
    inSettings: false,
    inBlockComment: false,
    inTripleString: false,
    afterBlockKeyword: false,
  }),
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.match(/^.*?\*\//)) state.inBlockComment = false;
      else stream.skipToEnd();
      return 'comment';
    }
    if (state.inTripleString) {
      if (stream.match(/^.*?'''/)) state.inTripleString = false;
      else stream.skipToEnd();
      return 'string';
    }
    if (stream.eatSpace()) return null;
    // Every branch below that consumes a non-identifier token clears
    // afterBlockKeyword; only the def branch consumes it meaningfully.
    // Otherwise the flag leaks (e.g. across lines after `note: 'x'`) and
    // falsely tags a later bare word as a definition.
    if (stream.match('//')) { state.afterBlockKeyword = false; stream.skipToEnd(); return 'comment'; }
    if (stream.match('/*')) { state.afterBlockKeyword = false; state.inBlockComment = true; return 'comment'; }
    if (stream.match("'''")) { state.afterBlockKeyword = false; state.inTripleString = true; return 'string'; }
    if (stream.match(/^'(?:[^'\\]|\\.)*'/) || stream.match(/^"(?:[^"\\]|\\.)*"/)) { state.afterBlockKeyword = false; return 'string'; }
    if (stream.match(/^`[^`]*`/)) { state.afterBlockKeyword = false; return 'string'; }
    if (stream.match(/^\d+(\.\d+)?/)) { state.afterBlockKeyword = false; return 'number'; }
    if (stream.match('[')) { state.afterBlockKeyword = false; state.inSettings = true; return 'bracket'; }
    if (stream.match(']')) { state.afterBlockKeyword = false; state.inSettings = false; return 'bracket'; }
    if (state.afterBlockKeyword && stream.match(/^[\w.]+/)) {
      state.afterBlockKeyword = false;
      return 'def';
    }
    if (!state.inSettings && stream.match(BLOCK_KEYWORDS)) {
      state.afterBlockKeyword = true;
      return 'keyword';
    }
    if (!state.inSettings && stream.match(INLINE_KEYWORDS)) return 'keyword';
    if (state.inSettings && stream.match(/^[\w]+/)) return 'attribute';
    if (stream.match(/^[\w]+/)) return null;
    stream.next();
    state.afterBlockKeyword = false;
    return null;
  },
};

export const dbmlLanguage = StreamLanguage.define(dbmlTokenizer);
