# PDF.js browser renderer

Vendored browser-only distribution: **pdfjs-dist 6.4.299**, Apache-2.0.
Source: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz

Included: legacy/build/pdf.mjs, legacy/build/pdf.worker.mjs, cmaps/, standard_fonts/, wasm/, LICENSE.
The Node >=22 engine requirement applies to running PDF.js under Node. This application serves the browser bundles as static files; it does not run PDF.js in its Node 20 gateway. Browser rendering was exercised in Chromium, not assumed from a Node import.

The renderer does not execute PDF scripting or evaluation (`isEvalSupported:false`, render-only API). Workbook files are fetched through the student-authenticated bounded PDF endpoint. Keep renderer security updates reviewed and pinned. No CDN dependency is required for workbook rendering.
