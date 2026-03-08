const fs = require('fs');
const f = 'c:\\Users\\Nihad\\OneDrive\\Desktop\\Aplikacije\\ERP V4\\app\\globals.css';
let content = fs.readFileSync(f, 'utf8');
const marker = '/* ═════════════════════════════════════════';
const idx = content.indexOf(marker);
if (idx > 0) {
    content = content.substring(0, idx).trimEnd() + '\n';
    fs.writeFileSync(f, content, 'utf8');
    console.log('Removed appended ALU CSS from globals.css');
} else {
    console.log('No appended ALU CSS found');
}
