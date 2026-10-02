'use strict';
/**
 * Reads the text in screenshots of emails, on this computer, with the text recognition built into Windows 10 and 11
 * (Windows.Media.Ocr). No image leaves the computer and none is kept: each is written to a private temporary folder,
 * read, and deleted. The page cuts tall screenshots into slices first, because the recogniser has a maximum size.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MAX_IMAGES = 12;
const MAX_BYTES = 8 * 1024 * 1024;

// PowerShell 5.1 reaches WinRT through System.Runtime.WindowsRuntime; AsTask turns each async call into a Task.
// The files to read arrive in SENTINEL_OCR_FILES, one per line; the text of each comes back after a marker line.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Wait-Op($op, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $null = $task.Wait(-1); $task.Result }
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { Write-Output 'SENTINEL-OCR-NO-ENGINE'; exit 3 }
foreach ($p in ($env:SENTINEL_OCR_FILES -split "\`n")) {
  if (-not $p) { continue }
  $file = Wait-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($p)) ([Windows.Storage.StorageFile])
  $stream = Wait-Op ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Wait-Op ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Wait-Op ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Wait-Op ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  Write-Output 'SENTINEL-OCR-IMAGE'
  foreach ($line in $result.Lines) { Write-Output $line.Text }
  $stream.Dispose()
}
`;

/** Text of each image (PNG or JPEG bytes), in order. */
async function read(images) {
  if (process.platform !== 'win32') throw new Error('Reading screenshots needs Windows 10 or 11.');
  if (!Array.isArray(images) || !images.length || images.length > MAX_IMAGES) throw new Error('Choose one screenshot at a time.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-ocr-'));
  try {
    const files = images.map((img, i) => {
      const buf = Buffer.from(img);
      if (!buf.length || buf.length > MAX_BYTES) throw new Error('That screenshot is too large.');
      const png = buf[0] === 0x89 && buf[1] === 0x50;
      const jpg = buf[0] === 0xff && buf[1] === 0xd8;
      if (!png && !jpg) throw new Error('Screenshots must be PNG or JPEG images.');
      const file = path.join(dir, `${i}.${png ? 'png' : 'jpg'}`);
      fs.writeFileSync(file, buf);
      return file;
    });
    const out = await new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
        windowsHide: true, env: { ...process.env, SENTINEL_OCR_FILES: files.join('\n') }
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => { ps.kill(); reject(new Error('Reading the screenshot took too long.')); }, 60000);
      ps.stdout.on('data', (d) => { stdout += d; });
      ps.stderr.on('data', (d) => { stderr += d; });
      ps.on('error', (err) => { clearTimeout(timer); reject(err); });
      ps.on('close', (code) => {
        clearTimeout(timer);
        if (stdout.includes('SENTINEL-OCR-NO-ENGINE')) reject(new Error('Windows has no text recognition for your language installed.'));
        else if (code !== 0) reject(new Error(`The screenshot could not be read (${stderr.trim().split(/\r?\n/)[0] || code})`));
        else resolve(stdout);
      });
      ps.stdin.end(SCRIPT);
    });
    return out.split(/\r?\n/).join('\n').split('SENTINEL-OCR-IMAGE\n').slice(1).map((t) => t.trim());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { read, MAX_IMAGES, MAX_BYTES };
