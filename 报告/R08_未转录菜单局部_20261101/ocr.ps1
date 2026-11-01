Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
function Await($op,$type) { $m=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'} | Select-Object -First 1; $t=$m.MakeGenericMethod($type).Invoke($null,@($op)); $t.Wait(); return $t.Result }
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$root=(Get-Location).Path
$rows=Get-ChildItem '项目/tools/pilot/c03_offsite_batch2/img' -Filter *.jpg | ForEach-Object { [pscustomobject]@{archive_path=$_.FullName} }
$result=@()
foreach($r in $rows | Sort-Object archive_path -Unique) {
 $p=$r.archive_path
 try {
 $file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($p)) ([Windows.Storage.StorageFile])
 $stream=Await ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
 $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
 $bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
 $ocr=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
 $result+= [pscustomobject]@{path=$r.archive_path;status='OCR_COMPLETED';text=$ocr.Text;lines=@($ocr.Lines | ForEach-Object {$_.Text});error=''}
 $stream.Dispose()
 } catch {$result+=[pscustomobject]@{path=$r.archive_path;status='OCR_FAILED';text='';lines=@();error=$_.Exception.Message}}
}
$result | ConvertTo-Json -Depth 8 | Set-Content '报告/R08_未转录菜单局部_20261101/ocr_raw.json' -Encoding UTF8
$result | Group-Object status | Select-Object Name,Count

