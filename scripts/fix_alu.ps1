$f = 'c:\Users\Nihad\OneDrive\Desktop\Aplikacije\ERP V4\components\ui\AluDoorModal.tsx'
$lines = Get-Content $f
$newLines = $lines[0..538]
$newLines += '        </Modal>'
$newLines += '    );'
$newLines += '}'
$newLines += ''
$newLines | Set-Content $f -Encoding UTF8
Write-Host "Done - file now has $($newLines.Count) lines"
