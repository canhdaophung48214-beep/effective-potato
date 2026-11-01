'use strict';
const fs = require('fs'); const path = require('path');
const PROJ = "C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目";
const files = ['tools/verify_data.js','tools/check_id_admission.js','tools/verify_provenance.js','tools/verify_multiselect.js','tools/test_records_spec.js','tools/import_data.js','tools/check_eol.js','tools/check_doc_refs.js','tools/regression.js','tools/test_pages.js'];
for (const f of files) {
  const p = path.join(PROJ, f);
  if (!fs.existsSync(p)) { console.log(f + ' :: MISSING'); continue; }
  const t = fs.readFileSync(p, 'utf8');
  const lines = t.split(/\r?\n/);
  const exp = lines.map((l,i)=>[i+1,l]).filter(([i,l])=>l.indexOf('module.exports')>=0 || /^if \(require\.main/.test(l) || l.indexOf('require.main === module')>=0).slice(0,4).map(([i,l])=>i+':'+l.trim().slice(0,120));
  console.log('=== ' + f + ' (' + lines.length + ' lines, ' + t.length + 'B)');
  console.log(exp.join('\n'));
}
