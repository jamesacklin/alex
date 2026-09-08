#!/usr/bin/env node
//
// Build the hostile EPUB fixture used by e2e/specs/epub-security.spec.ts.
//
// The book is a valid EPUB whose single chapter tries every way a document
// can execute script or reach its parent: inline <script>, an event handler,
// a javascript: link, an <iframe srcdoc>, an <object>, an <embed>, an SVG
// <script>, an <img onerror>, a form that posts to a privileged route, and a
// <base> tag. Each one that runs writes a flag onto the parent window and
// posts a message, so the test can tell "nothing executed" from "something
// executed but happened not to reach the parent".
//
// Generated rather than committed as a binary so the payloads stay readable
// and reviewable in the repository.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUTPUT = path.join(__dirname, 'fixtures', 'hostile.epub');

const CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Hostile Chapter</title>
  <base href="https://attacker.example/" />
  <script type="text/javascript"><![CDATA[
    // 1. Inline script executing at all.
    try { window.__alexEpubEscape = (window.__alexEpubEscape || []).concat('inline-script'); } catch (e) {}
    // 2. Reaching the parent application's window across the frame boundary.
    try {
      parent.__alexEpubEscape = (parent.__alexEpubEscape || []).concat('parent-access');
      parent.postMessage({ alexEpubEscape: 'parent-access' }, '*');
    } catch (e) {}
    // 3. Reading the parent's cookies and storage.
    try {
      parent.__alexEpubStolenCookie = parent.document.cookie;
      parent.__alexEpubStolenStorage = JSON.stringify(Object.keys(parent.localStorage));
    } catch (e) {}
    // 4. Reaching the desktop bridge, if one is exposed.
    try {
      if (parent.electronAPI) {
        parent.__alexEpubElectron = Object.keys(parent.electronAPI);
        parent.electronAPI.getS3Config().then(function (config) {
          parent.__alexEpubS3Config = JSON.stringify(config);
        });
      }
    } catch (e) {}
    // 5. Issuing an authenticated mutation with the reader's own cookies.
    try {
      fetch('/api/electron/clear-books', { method: 'POST', credentials: 'include' })
        .then(function (response) { parent.__alexEpubWipeStatus = response.status; })
        .catch(function () {});
      fetch('/api/users', { credentials: 'include' })
        .then(function (response) { parent.__alexEpubUsersStatus = response.status; })
        .catch(function () {});
    } catch (e) {}
    // 6. Navigating the top-level window away.
    try { top.location.href = 'https://attacker.example/phish'; } catch (e) {}
    // 7. Opening a popup.
    try { window.open('https://attacker.example/popup', '_blank'); } catch (e) {}
  ]]></script>
</head>
<body onload="try { parent.__alexEpubEscape = (parent.__alexEpubEscape || []).concat('body-onload'); } catch (e) {}">
  <h1>Hostile Chapter</h1>
  <p id="marker">This book is a test fixture. Its text must still render.</p>

  <p><a id="js-link" href="javascript:void((parent.__alexEpubEscape = (parent.__alexEpubEscape || []).concat('javascript-url')))">a javascript: link</a></p>

  <img id="broken-image" src="does-not-exist.png"
       onerror="try { parent.__alexEpubEscape = (parent.__alexEpubEscape || []).concat('img-onerror'); } catch (e) {}"
       alt="" />

  <iframe id="nested" srcdoc="&lt;script&gt;try { top.__alexEpubEscape = (top.__alexEpubEscape || []).concat('nested-iframe'); } catch (e) {}&lt;/script&gt;"></iframe>

  <object id="obj" type="text/html" data="data:text/html,&lt;script&gt;try { top.__alexEpubEscape = (top.__alexEpubEscape || []).concat('object'); } catch (e) {}&lt;/script&gt;"></object>

  <embed id="emb" type="text/html" src="data:text/html,&lt;script&gt;try { top.__alexEpubEscape = (top.__alexEpubEscape || []).concat('embed'); } catch (e) {}&lt;/script&gt;" />

  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
    <script type="text/javascript"><![CDATA[
      try { parent.__alexEpubEscape = (parent.__alexEpubEscape || []).concat('svg-script'); } catch (e) {}
    ]]></script>
  </svg>

  <form id="wipe-form" method="post" action="/api/electron/clear-books">
    <button type="submit">submit</button>
  </form>
</body>
</html>
`;

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:alex-hostile-fixture</dc:identifier>
    <dc:title>Hostile Test Book</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Alex Security Fixture</dc:creator>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>
`;

const NAV = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <ol><li><a href="chapter1.xhtml">Hostile Chapter</a></li></ol>
  </nav>
</body>
</html>
`;

// --- Minimal ZIP writer -----------------------------------------------------
// EPUB requires `mimetype` first and stored (uncompressed); everything else
// may be deflated. Writing the archive by hand keeps the fixture free of any
// build-time dependency.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function writeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.content, 'utf8');
    const stored = entry.store === true;
    const data = stored ? raw : zlib.deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

const archive = writeZip([
  { name: 'mimetype', content: 'application/epub+zip', store: true },
  { name: 'META-INF/container.xml', content: CONTAINER },
  { name: 'OEBPS/content.opf', content: OPF },
  { name: 'OEBPS/nav.xhtml', content: NAV },
  { name: 'OEBPS/chapter1.xhtml', content: CHAPTER },
]);

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, archive);
console.log(`wrote ${OUTPUT} (${archive.length} bytes)`);
