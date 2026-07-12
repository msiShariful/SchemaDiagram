// This file *is* elkjs's own worker entry point — not a wrapper around ELK.
//
// elkjs's fake-worker fallback (bundled inside elk.bundled.js's ELK class)
// detects "no document + has self" to decide whether it IS a dedicated
// worker's top-level script; nesting `new ELK()` inside our own dedicated
// worker tripped that same detection, so it self-hijacked `self.onmessage`
// instead of exporting a usable Worker class, and `new ELK()` threw
// "_Worker is not a constructor" (see elkjs/lib/elk-worker.js, bottom).
//
// Importing elk-worker.js directly here *is* that hijack, and it's exactly
// correct in this file: this worker only ever speaks elkjs's own {cmd,id}
// protocol, driven from the main thread by elk-api.js's ELK class (see
// elkLayout.ts), so no other onmessage handler is needed.
import 'elkjs/lib/elk-worker.min.js';
