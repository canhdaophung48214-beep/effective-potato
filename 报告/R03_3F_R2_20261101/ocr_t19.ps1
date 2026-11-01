Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
function Await($op,$type) { $m=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'} | Select-Object -First 1; $t=$m.MakeGenericMethod($type).Invoke($null,@($op)); $t.Wait(); return $t.Result }
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$inputs=Get-Content (Join-Path $PSScriptRoot 't19_ocr_inputs.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$out=@()
foreach($r in $inputs){try{
$imagePath=if([System.IO.Path]::IsPathRooted($r.path)){$r.path}else{Join-Path $PSScriptRoot $r.path}
$file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
$stream=Await ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
$decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$ocr=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$out+=@{name=$r.name;path=$r.path;text=$ocr.Text;lines=@($ocr.Lines | ForEach-Object {$_.Text});status='OCR_COMPLETED'};$stream.Dispose()
}catch{$out+=@{name=$r.name;path=$r.path;status='OCR_FAILED';error=$_.Exception.Message}}}
$out | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $PSScriptRoot 't19_ocr_actual.json') -Encoding UTF8
