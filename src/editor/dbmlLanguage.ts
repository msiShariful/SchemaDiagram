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
    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match('/*')) { state.inBlockComment = true; return 'comment'; }
    if (stream.match("'''")) { state.inTripleString = true; return 'string'; }
    if (stream.match(/^'(?:[^'\\]|\\.)*'/) || stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/^`[^`]*`/)) return 'string';
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    if (stream.match('[')) { state.inSettings = true; return 'bracket'; }
    if (stream.match(']')) { state.inSettings = false; return 'bracket'; }
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
    return null;
  },
};

export const dbmlLanguage = StreamLanguage.define(dbmlTokenizer);
